# stats
User count stats collector and display for Thunderbird.

## Monthly active users

`tools/monthlyusers.py` adds weekly MAU records to `docs/thunderbird_ami.json`.
From May 4, 2025, it scales the raw Glean MAU using the full version distribution
in `docs/thunderbird_adi.json`, independently of the release uptake files:

1. Take the 28-day window ending on the MAU date, including that date.
2. For each Monday-Friday, calculate the fraction of ADI counts on versions 128
   and newer, without an upper version limit.
3. Average those daily fractions, giving each weekday equal weight. Weekends
   are excluded. Every weekday must have valid ADI data.
4. Store the fraction rounded to three decimal places in the existing `78`
   field. The chart divides the raw `ami` value by this fraction.

ADI counts come from update requests, so this estimates monthly user coverage
from the weekday version mix; it is not a directly deduplicated monthly count
of users on older versions.

To correct all existing Glean-era adjustment factors, first ensure the ADI
file is current and back up the MAU file, then run:

```bash
cd ~/stats/tools
source ~/thundernest-ansible/files/secrets.sh
python3 monthlyusers.py --recalculate
```

This preserves existing raw Glean counts and all records before May 4, 2025.
It also adds missing weekly records using the Glean API, as a normal run does.
No truncation is needed. Without `--recalculate`, existing records are left
unchanged. Updates replace the MAU file only after calculations succeed.

For a reviewed backfill, write the result outside `docs` before publishing:

```bash
python3 monthlyusers.py --recalculate \
  --input ../docs/thunderbird_ami.json \
  --adi ../docs/thunderbird_adi.json \
  --output /path/to/private-staging/thunderbird_ami.json
```

API failures, invalid records, and missing historical Glean dates stop the
update. A weekly point newer than the available Glean results is deferred and
retried on the next run. The daily `amo-ops/stats.sh` pipeline runs MAU after
ADI generation and before the Ansible copy, under a shared lock. MAU should
not also run in the weekly cron entry.

The Ansible `stats-copy.yml` playbook accepts `stats_json_files` to publish
only a reviewed list of JSON files; its default remains all `docs/*.json`.
Keep backups and staging files outside `docs` so they are not published.

Run the focused regression tests from the repository root:

```bash
python3 -m unittest discover -s tools -p 'test_monthlyusers.py'
```

## Consolidated pipeline

The implementation is in `stats_pipeline/`, with the existing telemetry
calculations shared from `tools/`. See [OPERATIONS.md](OPERATIONS.md) for
collection, S3 snapshots, static deployment, ATN imports, backfills and rollback.
The design and cutover checklist are in [MIGRATION_PLAN.md](MIGRATION_PLAN.md).

```bash
uv sync --frozen
uv run pytest -q
uv run tb-stats --help
```

GitHub Actions processes complete UTC days at 04:00 and publishes plain static
files for the `prod` and `stage` branches. Generated datasets live in private S3
snapshots; processing does not commit them to Git. Cloudflare deployment tokens
are restricted to their respective hosting resources, and cache purges target
only the corresponding stats hostname.

During migration, the legacy commands above remain in use until the explicit
cutover. Consult [MIGRATION_PLAN.md](MIGRATION_PLAN.md) for current status.
