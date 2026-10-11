import csv
import io
import time

import boto3


class Athena:
    """Bounded queries; failure never masquerades as an empty successful result."""

    def __init__(self, client, database, workgroup, output, timeout=1800):
        self.client, self.database = client, database
        self.workgroup, self.output, self.timeout = workgroup, output, timeout
        self.executions = []

    def execute(self, sql):
        qid = self.client.start_query_execution(
            QueryString=sql, QueryExecutionContext={"Database": self.database},
            WorkGroup=self.workgroup, ResultConfiguration={"OutputLocation": self.output}
        )["QueryExecutionId"]
        self.executions.append(qid)
        deadline = time.monotonic() + self.timeout
        while True:
            execution = self.client.get_query_execution(QueryExecutionId=qid)["QueryExecution"]
            status = execution["Status"]
            if status["State"] == "SUCCEEDED":
                return qid
            if status["State"] in {"FAILED", "CANCELLED"}:
                raise RuntimeError(f"Athena {qid}: {status.get('StateChangeReason', status['State'])}")
            if time.monotonic() >= deadline:
                self.client.stop_query_execution(QueryExecutionId=qid)
                raise TimeoutError(f"Athena {qid} timed out and was cancelled")
            time.sleep(2)

    def rows(self, sql):
        qid = self.execute(sql)
        execution = self.client.get_query_execution(QueryExecutionId=qid)["QueryExecution"]
        uri = execution["ResultConfiguration"]["OutputLocation"]
        if not uri.startswith("s3://"):
            raise ValueError("Athena did not provide an S3 result")
        bucket, key = uri[5:].split('/', 1)
        response = boto3.client('s3').get_object(Bucket=bucket, Key=key)
        with io.TextIOWrapper(response['Body'], encoding='utf-8', newline='') as stream:
            reader = csv.reader(stream)
            next(reader)  # Athena's column header
            return list(reader)
