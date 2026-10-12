"""Local ATN consumer with durable, independent import/index/totals phases."""

import argparse
import datetime as dt
import fcntl
import io
import json
from pathlib import Path
import tarfile
import uuid

import boto3

from .artifacts import GROUPS, clean_artifact
from .common import Failures, atomic_json, dates, digest, utc_today


def verify_artifacts(s3, bucket, manifest):
    day = dt.date.fromisoformat(manifest["day"]).isoformat()
    revision = manifest["revision"]
    if set(manifest["artifacts"]) != set(GROUPS.values()):
        raise ValueError("ATN manifest must contain exactly five aggregation files")
    files = {}
    for group, entry in manifest["artifacts"].items():
        prefix = f"prod/atn/artifacts/{day}/{revision}/"
        if not entry["key"].startswith(prefix) or ".." in entry["key"].split("/"):
            raise ValueError("ATN artifact outside the declared revision")
        body = s3.get_object(Bucket=bucket, Key=entry["key"])["Body"].read()
        if len(body) != entry["size"] or digest(body) != entry["sha256"]:
            raise ValueError("ATN artifact checksum mismatch")
        files[f"update_counts_by_{group}.hive"] = clean_artifact(
            body, day, 6 if group == "app" else 5
        )
    return files


def container_script(day=None, folder=None, validate_only=False, operation="import"):
    source = """import datetime
import logging
from django.core.management import call_command
from django.db import transaction, connection
from django.conf import settings
from celery import current_app
from olympia.amo.decorators import use_primary_db
from olympia.stats.models import UpdateCount
from olympia.stats import tasks as stat_tasks
from olympia.addons.cron import update_addon_average_daily_users
logging.disable(logging.INFO)
settings.CELERY_TASK_ALWAYS_EAGER = True
settings.CELERY_TASK_EAGER_PROPAGATES = True
assert current_app.conf.task_always_eager and current_app.conf.task_eager_propagates

def write_totals(date, jobs):
    errors = []
    cursor = connection.cursor()
    for name, calculate in jobs.items():
        try:
            expected = int(calculate() or 0)
            cursor.execute('REPLACE INTO global_stats (name, count, date) VALUES (%s, %s, %s)',
                           [name, expected, date])
            cursor.execute('SELECT count FROM global_stats WHERE name=%s AND date=%s', [name, date])
            actual = cursor.fetchone()
            if actual is None or int(actual[0]) != expected:
                raise RuntimeError('Verification failed')
        except Exception as error:
            errors.append(name + ': ' + str(error))
    cursor.close()
    if errors:
        raise RuntimeError('; '.join(errors))

@use_primary_db
def run():
    cursor = connection.cursor()
    lock = 'stats_pipeline_catalog' if @@OPERATION@@ == 'catalog' else 'stats_pipeline_import'
    cursor.execute('SELECT GET_LOCK(%s, 0)', [lock])
    if cursor.fetchone()[0] != 1:
        raise RuntimeError('Another stats operation still owns ' + lock)
    cursor.close()
    if @@OPERATION@@ == 'catalog':
        date = datetime.date.today() - datetime.timedelta(days=1)
        write_totals(date, stat_tasks._get_daily_jobs(date))
        return
    if @@OPERATION@@ == 'average':
        # The legacy average explicitly chooses a replica. Read the primary
        # so the result includes the imports which have just committed.
        import multidb
        from django.db import router
        original = multidb.get_slave
        multidb.get_slave = lambda: router.db_for_write(UpdateCount)
        try:
            update_addon_average_daily_users()
        finally:
            multidb.get_slave = original
        return
    if @@OPERATION@@ == 'index':
        call_command('index_stats', date=@@DAY@@)
        return
    if @@OPERATION@@ == 'totals':
        date = datetime.datetime.strptime(@@DAY@@, '%Y-%m-%d').date()
        write_totals(date, stat_tasks._get_metrics_jobs(date))
        return
    cursor = connection.cursor()
    cursor.execute('SHOW TABLE STATUS LIKE %s', ['update_counts'])
    assert cursor.fetchone()[1].lower() == 'innodb', 'Atomic imports require InnoDB'
    cursor.close()
    with transaction.atomic():
        fields = ['addon_id', 'count', 'applications', 'locales', 'oses', 'statuses', 'versions']
        before = list(UpdateCount.objects.filter(date=@@DAY@@).order_by('addon_id').values(*fields)) if @@VALIDATE@@ else None
        previous = set(UpdateCount.objects.filter(date=@@DAY@@).values_list('addon_id', flat=True))
        call_command('update_counts_from_file', @@FOLDER@@, date=@@DAY@@, stats_source='file')
        current = set(UpdateCount.objects.filter(date=@@DAY@@).values_list('addon_id', flat=True))
        if not current or not previous.issubset(current):
            raise RuntimeError('Import removes existing addons; manual search reconciliation required')
        if @@VALIDATE@@:
            after = list(UpdateCount.objects.filter(date=@@DAY@@).order_by('addon_id').values(*fields))
            if before != after:
                raise RuntimeError('ATN parity mismatch; import rolled back')
            transaction.set_rollback(True)
            print('ATN import parity verified; transaction rolled back')
run()
"""
    for key, value in {
        "OPERATION": operation,
        "DAY": day,
        "FOLDER": folder,
        "VALIDATE": validate_only,
    }.items():
        source = source.replace("@@" + key + "@@", repr(value))
    # Django 1.11 executes shell commands inside a function; explicit globals
    # make imports visible to functions defined by the Python 2 exec.
    return f"scope = {{}}; exec(compile({source!r}, '<stats_pipeline>', 'exec'), scope, scope)"


def exec_checked(container, command):
    result = container.exec_run(command)
    output = result.output.decode(errors="replace")
    print(output, flush=True)
    if result.exit_code:
        raise RuntimeError(f"ATN command failed with exit {result.exit_code}")
    return output.strip()


def run_operation(container, operation, day=None):
    exec_checked(
        container,
        ["python", "manage.py", "shell", "-c", container_script(day, operation=operation)],
    )


def import_date(container, manifest, files, validate_only=False):
    folder = "stats-pipeline-" + uuid.uuid4().hex
    day = manifest["day"]
    tmp = exec_checked(
        container,
        [
            "python",
            "manage.py",
            "shell",
            "-c",
            "from django.conf import settings; print(settings.TMP_PATH)",
        ],
    ).splitlines()[-1]
    if not tmp.startswith("/") or "\n" in tmp:
        raise ValueError("Unexpected ATN temporary directory")
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for name, body in files.items():
            info = tarfile.TarInfo(f"{folder}/{day}/{name}")
            info.size, info.mode = len(body), 0o600
            archive.addfile(info, io.BytesIO(body))
    if not container.put_archive(tmp, buffer.getvalue()):
        raise RuntimeError("Could not stage ATN files")
    try:
        exec_checked(
            container,
            ["python", "manage.py", "shell", "-c", container_script(day, folder, validate_only)],
        )
    finally:
        # Cleanup must not make an already committed import look uncommitted.
        try:
            exec_checked(container, ["rm", "-rf", "--", f"{tmp}/{folder}"])
        except Exception as error:
            print(f"ATN temporary-file cleanup failed: {error}", flush=True)


def get_container(name):
    import docker

    return docker.from_env().containers.get(name)


def consume(bucket, state_path, first_day, container_name, dry_run=False, validate_only=False):
    state_path = Path(state_path)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    with (state_path.parent / "consumer.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads(state_path.read_bytes()) if state_path.exists() else {"completed": {}}
        progress = state.setdefault("progress", {})
        s3 = boto3.client("s3", region_name="us-west-2")
        ready = []
        for page in s3.get_paginator("list_objects_v2").paginate(
            Bucket=bucket, Prefix="prod/atn/ready/"
        ):
            ready.extend(o["Key"] for o in page.get("Contents", []))
        failures, targets = Failures(), {}
        container = None

        def docker_container():
            nonlocal container
            if container is None:
                container = get_container(container_name)
            return container

        for key in sorted(ready):
            day = failures.attempt(f"manifest/{key}", dt.date.fromisoformat, Path(key).stem)
            if day is None:
                continue
            if day < first_day:
                continue

            def load(key=key, day=day):
                manifest = json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
                if manifest["day"] != day.isoformat():
                    raise ValueError("Mismatched ready manifest date")
                revision = manifest["revision"]
                if not isinstance(revision, str) or not revision or "/" in revision:
                    raise ValueError("Invalid ready manifest revision")
                return manifest

            manifest = failures.attempt(f"manifest/{day}", load)
            targets[day.isoformat()] = manifest["revision"] if manifest else None
            if manifest is None or (
                not validate_only and state["completed"].get(str(day)) == manifest["revision"]
            ):
                continue
            phase = progress.get(str(day), {})
            if phase.get("revision") != manifest["revision"]:
                phase = {"revision": manifest["revision"]}
            if dry_run:
                failures.attempt(f"verify/{day}", verify_artifacts, s3, bucket, manifest)
                continue
            if validate_only or not phase.get("imported"):

                def do_import(manifest=manifest):
                    files = verify_artifacts(s3, bucket, manifest)
                    import_date(docker_container(), manifest, files, validate_only)
                    return True

                if failures.attempt(f"import/{day}", do_import) is not True:
                    continue
                if validate_only:
                    continue
                phase["imported"] = True
                progress[str(day)] = phase
                state["average_pending"] = True
                atomic_json(state_path, state)
            for operation in ("index", "totals"):
                if phase.get(operation):
                    continue

                def do_operation(operation=operation, day=day):
                    run_operation(docker_container(), operation, str(day))
                    return True

                if failures.attempt(f"{operation}/{day}", do_operation) is True:
                    phase[operation] = True
                    progress[str(day)] = phase
                    atomic_json(state_path, state)
            if phase.get("index") and phase.get("totals"):
                state["completed"][str(day)] = manifest["revision"]
                progress.pop(str(day), None)
                atomic_json(state_path, state)
        if dry_run:
            print(
                json.dumps(
                    {
                        "pending": [
                            {"day": day, "revision": revision}
                            for day, revision in targets.items()
                            if state["completed"].get(day) != revision
                        ],
                        "errors": failures.errors,
                    }
                )
            )
        elif not validate_only and state.get("average_pending"):
            # The deployed average uses date > CURDATE()-13, i.e. the last
            # twelve completed days. Index/totals failures do not invalidate DB
            # counts; missing/rejected imports in this window do.
            yesterday = utc_today() - dt.timedelta(days=1)
            first = max(first_day, utc_today() - dt.timedelta(days=12))

            def imported(day):
                revision = targets.get(day)
                return revision is not None and (
                    state["completed"].get(day) == revision
                    or (
                        progress.get(day, {}).get("revision") == revision
                        and progress[day].get("imported")
                    )
                )

            missing = [str(day) for day in dates(first, yesterday) if not imported(str(day))]
            if missing:
                print("Average waits for required imports: " + ", ".join(missing), flush=True)
            else:

                def average():
                    run_operation(docker_container(), "average")
                    return True

                if failures.attempt("average", average) is True:
                    state["average_pending"] = False
                    atomic_json(state_path, state)
        if failures.errors:
            raise RuntimeError(
                "; ".join(f"{e['component']}: {e['error']}" for e in failures.errors)
            )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bucket")
    parser.add_argument("--state", type=Path, default=Path("/state/completed.json"))
    parser.add_argument("--first-day", type=dt.date.fromisoformat)
    parser.add_argument("--container", default="addons-server")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument(
        "--catalog-only",
        action="store_true",
        help="Record daily catalog totals independently of imports",
    )
    args = parser.parse_args()
    if args.catalog_only:
        run_operation(get_container(args.container), "catalog")
    else:
        if not args.bucket or not args.first_day:
            parser.error("--bucket and --first-day are required for imports")
        consume(
            args.bucket,
            args.state,
            args.first_day,
            args.container,
            args.dry_run,
            args.validate_only,
        )


if __name__ == "__main__":
    main()
