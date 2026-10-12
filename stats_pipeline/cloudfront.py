"""Isolated CloudFront log aggregation; no shared tables or bucket-wide cleanup."""

import datetime as dt
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor

from . import aus_sql, cloudfront_sql
from .athena import Athena
from .artifacts import GROUPS, clean_rows, tsv
from .common import digest, json_bytes

SOURCES = {
    "atn": ("versioncheck-logs", "E1PQMC7BGJOP5E"),
    "aus": ("aus-thunderbird-logs", "EC3NSDIH119PP"),
}


def source_manifest(s3, kind, day):
    bucket, distribution = SOURCES[kind]
    objects = []
    for page in s3.get_paginator("list_objects_v2").paginate(
        Bucket=bucket, Prefix=f"{distribution}.{day}"
    ):
        objects.extend(
            {
                "key": x["Key"],
                "etag": x["ETag"],
                "size": x["Size"],
                "modified": x["LastModified"].isoformat(),
            }
            for x in page.get("Contents", [])
        )
    objects.sort(key=lambda x: x["key"])
    if not objects or sum(o["size"] for o in objects) == 0:
        raise ValueError(f"Missing {kind} source logs for {day}")
    hours = {o["key"].split(f"{day}-", 1)[-1][:2] for o in objects}
    if not set(f"{h:02}" for h in range(24)).issubset(hours):
        raise ValueError(f"Incomplete hourly {kind} logs for {day}")
    cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=15)
    if max(dt.datetime.fromisoformat(o["modified"]) for o in objects) > cutoff:
        raise ValueError(f"{kind} logs for {day} are still arriving; retry later")
    return {"bucket": bucket, "objects": objects, "sha256": digest(json_bytes(objects))}


def collect_source(s3, athena_client, config, day, kind, source, run_id, failures, groups=None):
    """Aggregate one source; failed ATN dimensions do not discard other dimensions."""
    suffix = uuid.uuid4().hex
    athena = Athena(
        athena_client, config.database, config.workgroup, f"s3://{config.bucket}/query-results/"
    )
    artifact_rows, artifacts = {}, {}
    prefix = f"scratch/{run_id}/{kind}/{day}/{suffix}/"
    table, view = f"stats_{kind}_{suffix}", f"stats_view_{suffix}"
    created_table = created_view = False
    try:

        def copy_source(item, destination=prefix, source_bucket=source["bucket"]):
            s3.copy_object(
                Bucket=config.bucket,
                Key=destination + item["key"],
                CopySource={"Bucket": source_bucket, "Key": item["key"]},
                CopySourceIfMatch=item["etag"],
            )

        with ThreadPoolExecutor(max_workers=12) as pool:
            list(pool.map(copy_source, source["objects"]))
        sql = cloudfront_sql if kind == "atn" else aus_sql
        athena.execute(sql.create_table(table, f"{config.bucket}/{prefix.rstrip('/')}"))
        created_table = True
        if kind == "atn":
            athena.execute(sql.create_view(table, view))
            created_view = True

            def query_group(qtype, group):
                rows = athena.rows(sql.by_type(view, qtype, day))
                cleaned = clean_rows(rows, day, 6 if group == "app" else 5)
                if len(cleaned) < len(rows):
                    failures.warnings.append(
                        {
                            "component": f"atn/{day}/{group}",
                            "discarded_rows": len(rows) - len(cleaned),
                        }
                    )
                return cleaned

            for qtype, group in GROUPS.items():
                if groups is not None and group not in groups:
                    continue
                rows = failures.attempt(f"atn/{day}/{group}", query_group, qtype, group)
                if rows is not None:
                    artifact_rows[group] = rows
        else:
            rows = athena.rows(sql.count_query(table))
            # AUS aggregates go straight to JSON. A mismatched date or count
            # invalidates this day's total; TSV field filtering does not apply.
            if not rows or any(len(row) != 3 or row[0] != day or int(row[2]) < 0 for row in rows):
                raise ValueError(f"Invalid AUS aggregate for {day}")
            # Match the legacy transform exactly, including repeated version rows.
            return {
                "count": sum(int(row[2]) for row in rows),
                "versions": {row[1]: int(row[2]) for row in rows},
            }
    finally:
        # Only resources this invocation created. Never delete the legacy scratch bucket.
        if created_view:
            failures.attempt(
                f"cleanup/{day}/{kind}/view", athena.execute, cloudfront_sql.drop_view(view)
            )
        if created_table:
            failures.attempt(
                f"cleanup/{day}/{kind}/table", athena.execute, cloudfront_sql.drop_table(table)
            )
        for offset in range(0, len(source["objects"]), 1000):
            keys = [{"Key": prefix + x["key"]} for x in source["objects"][offset : offset + 1000]]

            def delete(keys):
                result = s3.delete_objects(Bucket=config.bucket, Delete={"Objects": keys})
                if result.get("Errors"):
                    raise RuntimeError("Scratch cleanup failed; see S3 lifecycle fallback")

            failures.attempt(f"cleanup/{day}/{kind}/objects", delete, keys)
    if set(artifact_rows) == set(GROUPS.values()):

        def upload(group, rows):
            body = tsv(rows)
            key = f"{config.prefix}/atn/artifacts/{day}/{run_id}/update_counts_by_{group}.hive"
            s3.put_object(Bucket=config.bucket, Key=key, Body=body, IfNoneMatch="*")
            return {"key": key, "size": len(body), "sha256": digest(body)}

        for group, rows in artifact_rows.items():
            entry = failures.attempt(f"atn/{day}/upload/{group}", upload, group, rows)
            if entry is not None:
                artifacts[group] = entry
    logging.info("Aggregated %s (%s)", day, ", ".join(athena.executions))
    return {"rows": artifact_rows, "artifacts": artifacts}


THEME = "{972ce4c6-7e08-4474-a285-3208198ce6fd}"
SEAMONKEY = "{92650c4d-4b8e-4d2a-b7eb-24ecf4f6b63a}"


def adi_record(rows, aus, seamonkeys):
    versions, total = {}, 0
    for row in rows:
        if row[1] == THEME and row[2] not in seamonkeys:
            versions[row[2]] = versions.get(row[2], 0) + int(row[3])
            total += int(row[3])
    # Preserve the existing overlap/total behavior; migration does not change metrics.
    versions.update(aus["versions"])
    return {"count": total + aus["count"], "versions": versions}
