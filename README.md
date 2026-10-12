# stats
User count stats collector and display for Thunderbird.

## Monthly active users

`tools/monthlyusers.py` adds weekly MAU records to the working dataset's
`thunderbird_ami.json`. The Actions pipeline restores that dataset from S3.
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

The published methodology is preserved by this migration. When ADI inputs
change, the pipeline recalculates existing factors while preserving raw Glean
counts and records before May 4, 2025. It adds missing weekly points from Glean.
API failures, invalid records and missing historical dates preserve the affected
point's previous value and fail that collection job, while independent results
can still be published. A point newer than the available Glean results is retried
on the next run.

For a reviewed correction, restore a snapshot and write a separate result:

```bash
uv run tb-stats restore --data .state --manifest .snapshot.json
uv run python -m tools.monthlyusers --recalculate \
  --input .state/thunderbird_ami.json \
  --adi .state/thunderbird_adi.json \
  --output .review/thunderbird_ami.json
```

Authenticate to AWS and provide `STATS_BUCKET` as documented in
[OPERATIONS.md](OPERATIONS.md). Missing Glean points also require
`GLEAN_API_KEY`. Review the result before publishing; do not truncate history
or commit the generated data.

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

Consult [MIGRATION_PLAN.md](MIGRATION_PLAN.md) for cutover status and
[OPERATIONS.md](OPERATIONS.md) for recovery instructions.
