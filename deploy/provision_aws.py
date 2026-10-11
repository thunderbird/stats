"""Idempotent operator setup. Run with administrative AWS credentials, never in Actions."""
import json

import boto3

REGION = "us-west-2"
REPO = "thunderbird/stats"


def policy(statements):
    return json.dumps({"Version": "2012-10-17", "Statement": statements})


def statement(actions, resources, **extra):
    return {"Effect": "Allow", "Action": actions, "Resource": resources, **extra}


def main():
    session = boto3.Session(region_name=REGION)
    account = session.client("sts").get_caller_identity()["Account"]
    bucket = f"thunderbird-stats-{account}"
    s3, iam = session.client("s3"), session.client("iam")
    try:
        s3.head_bucket(Bucket=bucket)
    except s3.exceptions.ClientError as error:
        if error.response["Error"]["Code"] != "404":
            raise
        s3.create_bucket(Bucket=bucket, CreateBucketConfiguration={"LocationConstraint": REGION})
    s3.put_public_access_block(Bucket=bucket, PublicAccessBlockConfiguration={
        "BlockPublicAcls": True, "IgnorePublicAcls": True,
        "BlockPublicPolicy": True, "RestrictPublicBuckets": True})
    s3.put_bucket_versioning(Bucket=bucket, VersioningConfiguration={"Status": "Enabled"})
    s3.put_bucket_encryption(Bucket=bucket, ServerSideEncryptionConfiguration={"Rules": [
        {"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]})
    s3.put_bucket_policy(Bucket=bucket, Policy=policy([{
        "Effect": "Deny", "Principal": "*", "Action": "s3:*",
        "Resource": [f"arn:aws:s3:::{bucket}", f"arn:aws:s3:::{bucket}/*"],
        "Condition": {"Bool": {"aws:SecureTransport": "false"}}}]))
    s3.put_bucket_lifecycle_configuration(Bucket=bucket, LifecycleConfiguration={"Rules": [
        {"ID": "scratch", "Filter": {"Prefix": "scratch/"}, "Status": "Enabled",
         "Expiration": {"Days": 2}, "NoncurrentVersionExpiration": {"NoncurrentDays": 2}},
        {"ID": "query-results", "Filter": {"Prefix": "query-results/"}, "Status": "Enabled",
         "Expiration": {"Days": 30}, "NoncurrentVersionExpiration": {"NoncurrentDays": 30}}
    ]})
    for region, output in [(REGION, f"s3://{bucket}/query-results/"),
                           ("us-east-1", "s3://thunderbird-telemetry1/stats-pipeline-results/")]:
        athena = session.client("athena", region_name=region)
        try:
            athena.get_work_group(WorkGroup="thunderbird-stats")
        except athena.exceptions.InvalidRequestException:
            athena.create_work_group(Name="thunderbird-stats", Configuration={
                "EnforceWorkGroupConfiguration": True, "PublishCloudWatchMetricsEnabled": True,
                "ResultConfiguration": {"OutputLocation": output},
                "BytesScannedCutoffPerQuery": 500*1024**3,
                "EngineVersion": {"SelectedEngineVersion": "Athena engine version 3"}})
    glue = session.client("glue")
    try:
        glue.get_database(Name="stats_pipeline")
    except glue.exceptions.EntityNotFoundException:
        glue.create_database(DatabaseInput={"Name": "stats_pipeline"})
    raw = ["versioncheck-logs", "aus-thunderbird-logs", "thunderbird-telemetry1"]
    processor = [
        statement(["s3:GetBucketLocation", "s3:ListBucket"], [f"arn:aws:s3:::{b}" for b in raw+[bucket]]),
        statement(["s3:GetObject"], [f"arn:aws:s3:::{b}/*" for b in raw]),
        statement(["s3:GetObject", "s3:PutObject"], [f"arn:aws:s3:::{bucket}/prod/*", f"arn:aws:s3:::{bucket}/shadow/*",
                   f"arn:aws:s3:::{bucket}/scratch/*", f"arn:aws:s3:::{bucket}/query-results/*",
                   "arn:aws:s3:::thunderbird-telemetry1/stats-pipeline-results/*"]),
        statement(["s3:DeleteObject"], [f"arn:aws:s3:::{bucket}/scratch/*"]),
        statement(["athena:StartQueryExecution", "athena:GetQueryExecution", "athena:GetQueryResults",
                   "athena:StopQueryExecution", "athena:GetWorkGroup"],
                  [f"arn:aws:athena:{r}:{account}:workgroup/thunderbird-stats" for r in [REGION, "us-east-1"]]),
        statement(["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions", "glue:GetPartition", "glue:BatchGetPartition"],
                  [f"arn:aws:glue:{r}:{account}:{p}" for r in [REGION, "us-east-1"]
                   for p in ["catalog", "database/default", "database/stats_pipeline", "table/default/telemetry_data", "table/stats_pipeline/*"]]),
        statement(["glue:CreateTable", "glue:UpdateTable", "glue:DeleteTable"],
                  [f"arn:aws:glue:{REGION}:{account}:{p}" for p in ["catalog", "database/stats_pipeline", "table/stats_pipeline/stats_*"]])]
    roles = {"stats-processing": ("StatsProcessing", processor)}
    for env, role in [("production", "StatsPublishProduction"), ("staging", "StatsPublishStaging")]:
        roles[env] = (role, [
            statement(["s3:GetBucketLocation"], [f"arn:aws:s3:::{bucket}"]),
            statement(["s3:GetObject"], [f"arn:aws:s3:::{bucket}/prod/current.json", f"arn:aws:s3:::{bucket}/prod/snapshots/*"]),
            statement(["s3:PutObject"], [f"arn:aws:s3:::{bucket}/prod/published/{env}.json"])])
    output = {"bucket": bucket, "region": REGION, "roles": {}}
    for env, (name, permissions) in roles.items():
        trust = policy([{"Effect": "Allow", "Principal": {"Federated": f"arn:aws:iam::{account}:oidc-provider/token.actions.githubusercontent.com"},
                         "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {
                             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                             "token.actions.githubusercontent.com:sub": f"repo:{REPO}:environment:{env}"}}}])
        try:
            iam.get_role(RoleName=name)
            iam.update_assume_role_policy(RoleName=name, PolicyDocument=trust)
        except iam.exceptions.NoSuchEntityException:
            iam.create_role(RoleName=name, AssumeRolePolicyDocument=trust, MaxSessionDuration=21600)
        iam.put_role_policy(RoleName=name, PolicyName="StatsPipeline", PolicyDocument=policy(permissions))
        output["roles"][env] = f"arn:aws:iam::{account}:role/{name}"
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
