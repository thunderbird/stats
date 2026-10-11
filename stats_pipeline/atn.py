"""Local-only ATN consumer. The Actions workflow has no access to Docker or SSH."""
import argparse
import datetime as dt
import fcntl
import io
import json
from pathlib import Path
import tarfile
import uuid

import boto3

from .cloudfront import GROUPS
from .common import atomic_json, digest


def verify_artifacts(s3, bucket, manifest):
    day = dt.date.fromisoformat(manifest["day"]).isoformat()
    revision = manifest["revision"]
    if set(manifest["artifacts"]) != set(GROUPS.values()):
        raise ValueError("ATN manifest must contain exactly five aggregation files")
    files = {}
    for group, entry in manifest["artifacts"].items():
        prefix = f"prod/atn/artifacts/{day}/{revision}/"
        if not entry["key"].startswith(prefix) or '..' in entry["key"].split('/'):
            raise ValueError("ATN artifact outside the declared revision")
        body = s3.get_object(Bucket=bucket, Key=entry["key"])["Body"].read()
        if len(body) != entry["size"] or digest(body) != entry["sha256"]:
            raise ValueError("ATN artifact checksum mismatch")
        lines = body.decode().splitlines()
        if not lines:
            raise ValueError("Empty ATN artifact")
        for line in lines:
            fields = line.split('\t')
            if fields[0] != day or len(fields) != (6 if group == 'app' else 5) or int(fields[-2]) < 0:
                raise ValueError("Malformed or mismatched ATN artifact")
        files[f"update_counts_by_{group}.hive"] = body
    return files


def container_script(day, folder):
    # Existing management command and Celery tasks do the actual work. A transaction
    # prevents the legacy delete-then-insert import from leaving a partial date.
    return '''from django.core.management import call_command
from django.db import transaction, connection
from django.conf import settings
from celery import current_app
from olympia.amo.decorators import use_primary_db
from olympia.stats.models import UpdateCount
from olympia.stats.cron import update_global_totals
settings.CELERY_TASK_ALWAYS_EAGER = True
settings.CELERY_TASK_EAGER_PROPAGATES = True
assert current_app.conf.task_always_eager and current_app.conf.task_eager_propagates
@use_primary_db
def import_date():
    cursor = connection.cursor()
    cursor.execute('SHOW TABLE STATUS LIKE %s', ['update_counts'])
    assert cursor.fetchone()[1].lower() == 'innodb', 'Atomic imports require InnoDB'
    cursor.close()
    with transaction.atomic():
        previous = set(UpdateCount.objects.filter(date=DAY).values_list('addon_id', flat=True))
        call_command('update_counts_from_file', FOLDER, date=DAY, stats_source='file')
        current = set(UpdateCount.objects.filter(date=DAY).values_list('addon_id', flat=True))
        if not current or not previous.issubset(current):
            raise RuntimeError('Import removes existing addons; manual search reconciliation required')
    call_command('index_stats', date=DAY)
    update_global_totals(DAY)
import_date()
'''.replace('DAY', repr(day)).replace('FOLDER', repr(folder))


def exec_checked(container, command):
    result = container.exec_run(command, workdir="/data/olympia")
    print(result.output.decode(errors='replace'), flush=True)
    if result.exit_code:
        raise RuntimeError(f"ATN command failed with exit {result.exit_code}")
    return result.output.decode().strip()


def import_date(container, manifest, files):
    folder = "stats-pipeline-" + uuid.uuid4().hex
    day = manifest["day"]
    tmp = exec_checked(container, ["python", "manage.py", "shell", "-c",
                                   "from django.conf import settings; print(settings.TMP_PATH)"]).splitlines()[-1]
    if not tmp.startswith('/') or '\n' in tmp:
        raise ValueError("Unexpected ATN temporary directory")
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w') as archive:
        for name, body in files.items():
            info = tarfile.TarInfo(f"{folder}/{day}/{name}")
            info.size, info.mode = len(body), 0o600
            archive.addfile(info, io.BytesIO(body))
    if not container.put_archive(tmp, buffer.getvalue()):
        raise RuntimeError("Could not stage ATN files")
    try:
        exec_checked(container, ["python", "manage.py", "shell", "-c", container_script(day, folder)])
    finally:
        exec_checked(container, ["rm", "-rf", "--", f"{tmp}/{folder}"])


def consume(bucket, state_path, first_day, container_name, dry_run=False):
    state_path = Path(state_path)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    with (state_path.parent / 'consumer.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads(state_path.read_bytes()) if state_path.exists() else {"completed": {}}
        s3 = boto3.client('s3', region_name='us-west-2')
        ready = []
        for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix='prod/atn/ready/'):
            ready.extend(o['Key'] for o in page.get('Contents', []))
        pending = []
        for key in sorted(ready):
            day = dt.date.fromisoformat(Path(key).stem)
            if day < first_day:
                continue
            manifest = json.loads(s3.get_object(Bucket=bucket, Key=key)['Body'].read())
            if manifest['day'] != day.isoformat():
                raise ValueError('Mismatched ready manifest date')
            if state['completed'].get(day.isoformat()) != manifest['revision']:
                pending.append((manifest, verify_artifacts(s3, bucket, manifest)))
        if dry_run:
            print(json.dumps({"pending": [{"day": m['day'], "revision": m['revision']} for m, _ in pending]}))
            return
        if not pending:
            print('No pending ATN imports')
            return
        import docker
        container = docker.from_env().containers.get(container_name)
        for manifest, files in pending:
            import_date(container, manifest, files)
        # Run the dependent average only once all missing dates are present.
        exec_checked(container, ['python', 'manage.py', 'shell', '-c',
                     "from django.conf import settings; settings.CELERY_TASK_ALWAYS_EAGER=True; settings.CELERY_TASK_EAGER_PROPAGATES=True; from celery import current_app; assert current_app.conf.task_always_eager and current_app.conf.task_eager_propagates; from olympia.addons.cron import update_addon_average_daily_users; update_addon_average_daily_users()"])
        for manifest, _ in pending:
            state['completed'][manifest['day']] = manifest['revision']
        atomic_json(state_path, state)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bucket', required=True)
    parser.add_argument('--state', type=Path, default=Path('/state/completed.json'))
    parser.add_argument('--first-day', type=dt.date.fromisoformat, required=True)
    parser.add_argument('--container', default='addons-server')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    consume(args.bucket, args.state, args.first_day, args.container, args.dry_run)


if __name__ == '__main__':
    main()
