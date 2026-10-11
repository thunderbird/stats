# Statistics operations

## Runtime and ownership

Use Python **3.13.7**, `uv sync --frozen`, and `uv run tb-stats …`. The lockfile
pins transitive dependencies. Node 22 and `npm ci` install Wrangler for uploading
static assets; no JavaScript or TypeScript executes on requests.

All production calculation code is in `stats_pipeline/` and `tools/`. The latter
retains the existing telemetry SQL and metric calculations. `generate_json.py`
is a compatibility entry point; the complete pipeline uses `tb-stats collect`.
Do not run the old `amo-ops`/`athenatools` jobs alongside the new pipeline.

Legacy feature, add-on, platform and locale queries retain the production
version cohort through 140 in `legacy_telemetry_versions`. The 153 release is
still included in ADI/uptake and Glean MAU. Adding 153 to the legacy feature
denominator changes percentages without adding matching feature observations
in the current data; that requires a separate metric
migration, not an automatic release-list bump.

GitHub runs `process.yml` at **04:00 UTC**, processing the previous UTC day.
Weekly metrics retain their Sunday date anchors. `sumo.yml` also runs at 04:00,
independently, so an upstream SUMO failure does not prevent other publication.
Both use one concurrency group. GitHub scheduling is best effort; missing days
are recovered from the saved data, with a 32-day bound per invocation.

The scheduled workflow lives on `master`. Production static files come from
`prod`; staging comes from `stage`. Code pushes to those branches deploy the
chosen branch using the latest validated production data. Staging can read
production snapshots but cannot write production data or ATN handoffs.

## State layout

Bucket: `s3://thunderbird-stats-768512802988` (us-west-2), private, encrypted,
versioned, and TLS-only. Generated data does not produce Git commits.

| Key | Purpose |
| --- | --- |
| `prod/current.json` | Conditional pointer to the current validated snapshot |
| `prod/snapshots/<run>/manifest.json` | Immutable checksums, dates, revision and checkpoints |
| `prod/snapshots/<run>/files/*.json` | Complete website datasets, including historical files |
| `prod/sources/<run>/<day>.json` | Exact source log listing for provenance |
| `prod/atn/artifacts/<day>/<run>/*` | Immutable ATN inputs |
| `prod/atn/ready/<day>.json` | Validated ATN handoff, after snapshot commit |
| `prod/published/{production,staging}.json` | Last verified deployment per hostname |
| `shadow/*` | Isolated collection/validation state; no ATN publication |
| `scratch/<run>/*` | Isolated raw logs; deleted after use, two-day lifecycle fallback |
| `query-results/*` | Athena output; 30-day lifecycle |

Snapshots and handoff artifacts have no expiration policy. A failed upload or
query does not advance `current.json`. A conflicting writer cannot replace a
pointer it did not read. An interrupted deployment can retry the same snapshot
without repeating Athena. Query scratch uses unique tables in `stats_pipeline`,
never the legacy tables or the legacy scratch bucket.

New days require all 24 hourly log partitions, nonempty sources, and no objects
modified within the past 15 minutes. Every run checks source fingerprints for
the most recent seven days. A change reprocesses that date and recalculates
affected MAU coverage factors, preserving raw Glean counts. Older corrections
require an explicit backfill.

## Manual collection and backfills

Use `gh workflow run process.yml --ref master -f namespace=shadow` to validate a
run without publication. For explicit dates:

```bash
gh workflow run process.yml --ref master \
  -f namespace=shadow -f start=2026-10-04 -f through=2026-10-10
```

After reviewing the result, use `namespace=prod` to process and publish. Do not
dispatch production collection from another branch. The `stats-processing`
GitHub environment permits only `master` and owns the processing OIDC role.
Break longer catch-ups into bounded ranges; the CLI accepts `--max-days` for
operator runs when a larger deliberate backfill is appropriate.

For local operator commands, authenticate to AWS and set:

```bash
export STATS_BUCKET=thunderbird-stats-768512802988
export STATS_PREFIX=shadow
uv run tb-stats collect --start 2026-10-10 --through 2026-10-10 \
  --refresh-week 2026-10-04 --data .state
```

`--refresh-week` reruns a complete Sunday weekly point for comparison. Historical
MAU raw values are not replaced. `GLEAN_API_KEY` is required when a missing MAU
point is due. Neither AWS access keys nor Cloudflare operator keys belong in
the repository or GitHub workflows.

For a credential check, add `-f verify_access=true` to a manual processing run.
It also reads a legacy telemetry partition in `us-east-1` and validates the
Glean API response, without changing either source.

Initialize a namespace **only once**, using a reviewed copy of the full control
server dataset, including its historical JSON files:

```bash
uv run tb-stats validate --data /path/to/production-json
uv run tb-stats seed --data /path/to/production-json --run-id baseline-YYYYMMDD
```

Seed refuses to replace existing state. Never use stale checkout data as the
production seed.

## Static deployments and caching

Cloudflare Workers Static Assets serves the complete static directory. The
configuration intentionally has no Worker source, application bindings, routes,
or DNS operations. The hosting resources are `thunderbird-stats` and
`thunderbird-stats-stage`.

Every path receives `Cache-Control: public, max-age=3600`, matching Apache.
After upload, the workflow purges exactly one hostname, verifies its deployment
marker and data hashes, then records the published snapshot. Failure to purge
or verify fails the deployment. Purging the zone or unrelated hosts is never
part of this workflow. Browser caches retain their one-hour lifetime.

Restore a specific snapshot to retry a deployment or prepare a rollback:

```bash
uv run tb-stats restore --snapshot RUN_ID --data .state --manifest .snapshot.json
uv run tb-stats build --website docs --data .state --output dist \
  --manifest .snapshot.json --revision "$(git rev-parse HEAD)"
npx --no-install wrangler deploy --config deploy/wrangler.production.jsonc
uv run tb-stats finish-deploy --environment production --output dist \
  --manifest .snapshot.json --revision "$(git rev-parse HEAD)"
```

Start with an empty `dist` directory. These commands require the publishing
role/token and separate purge token. The `financials.json` and `oauth.json`
files come from the selected website branch; generated and historical metric
files come from the chosen snapshot. A site rollback does not reset processing
checkpoints or silently send historical ATN imports.

## ATN consumer

The `atn-admincron` instance (`i-07abb0f0d4145adae`, `172.31.45.221`) consumes
handoffs locally. Its existing instance profile reads S3. No GitHub job has SSH,
SSM execution, or inbound access to the instance.

The Python 3 consumer runs in its own container; it uses the existing
`addons-server` container for Django/database/search operations. Installation
files are `deploy/atn.Dockerfile`, `deploy/stats-atn.service`, and
`deploy/stats-atn.timer`. The host keeps acknowledgements in
`/home/centos/stats-state/completed.json` and polls every five minutes.

Before touching ATN, it validates checksums and dates for all five files. Files
are supplied through the existing import command's **file mode**, rather than
overwriting mutable legacy S3 paths between verification and import. Import is
wrapped in an InnoDB transaction. Indexing and global totals run synchronously
using ATN's existing tasks. Average daily users runs after all pending dates.
Only then are revisions acknowledged atomically.

Repeating an interrupted date replaces its rows rather than adding counts.
A correction that would remove an existing add-on aborts and rolls back: search
documents for removed add-ons need explicit reconciliation. This is safer than
silently leaving stale search documents. The currently active import supports
late-log additions automatically.

The timer's `--first-day` is **2026-10-11**, the first date the new producer owns.
October 10 was imported once during end-to-end validation. Earlier dates
were already imported by control and are deliberately skipped. Set it to the
agreed cutover date, never to an arbitrary historical starting point.

For an intentional ATN correction before that date, review the pending manifest
set with a manual `--dry-run` and an explicitly chosen earlier `--first-day`.
Use the same acknowledgement directory; keep the timer's normal boundary.

To update the consumer, build its pinned image on the operator host and copy it
over the existing SSH connection. This does not give GitHub access to ATN:

```bash
git archive HEAD | docker build -f deploy/atn.Dockerfile -t thunderbird-stats-atn:current -
docker save thunderbird-stats-atn:current | gzip > stats-atn-image.tar.gz
scp stats-atn-image.tar.gz centos@172.31.45.221:/home/centos/
ssh centos@172.31.45.221 'sudo docker load -i /home/centos/stats-atn-image.tar.gz'
```

Build from committed source so local data, scratch files and credentials cannot
enter the image. Wait for an active import to finish before restarting the service. The
unit disables SELinux labeling for the consumer to access this host's existing
Docker socket; it does not alter the running `addons-server` container.

The migration also widened ATN's `global_stats.count` from unsigned 32-bit to
unsigned 64-bit. Its cumulative download count exceeded 4,294,967,295 and the
old asynchronous job swallowed the resulting database error. The operator SQL
is retained in `deploy/atn-global-counts.sql`; a backup and full before/after
comparison confirmed that all 122,826 existing rows survived unchanged. Older
values already capped by the legacy column were not reconstructed.

```bash
sudo systemctl status stats-atn.timer stats-atn.service
sudo journalctl -u stats-atn.service --since today
```

Do not run control's importer and this consumer concurrently. Preserve all
unrelated ATN cron entries. The old 00:20 average/00:40 totals jobs are replaced
by the ordered consumer work, not duplicated.

## Provisioning and credentials

`deploy/provision_aws.py` provisions storage, workgroups and roles.
`deploy/provision_cloudflare.py` creates account-owned, per-Worker Editor tokens
and the separate zone-scoped Cache Purge token. `deploy/configure_github.py`
stores environment secrets and branch restrictions. These operator commands
never run in Actions and keep tokens out of output.

Production and staging publishing tokens were tested against an unrelated
Worker; access must be denied. DNS/custom-domain attachment is a separate
operator step. The purge token is zone-scoped; the application restricts the
request to the target hostname.

Staging shares the existing production stats exception from Cloudflare bot
challenges. Without it, automated JSON requests to the newly proxied staging
hostname receive an HTML challenge. No exception was added for other hosts.

`STATS_SCHEDULE_ENABLED` and `STATS_DEPLOY_ENABLED` are explicit cutover switches.
Both are enabled after the October 11 cutover. Disable scheduling before
restoring legacy producers. GitHub's normal failed-workflow notifications
report failures. A public repository schedule may be disabled after inactivity;
include that check in operational monitoring.

## Known upstream issue and rollback

SUMO's existing dataset ends on **2026-04-02**. Its API currently returns an HTML
browser challenge to both the processing host and GitHub runners. The independent SUMO workflow fails
explicitly and preserves the previous dataset; it never fills missing days with
zero. Resolve upstream access before claiming that the series is current.

Before cutover, retain control's original crontab and complete dataset backup,
ATN's original crontab, and each hostname's original Cloudflare DNS record.
To roll back processing, disable the Actions schedule and ATN timer first,
wait for active work to stop, restore the legacy schedules, then restore DNS
only if reverting hosting too. Never allow two producers/importers to run.
Leave old web hosts/data available until daily and weekly cycles are verified.

For a later rollback, first restore the latest validated S3 JSON snapshot to
the legacy data directories; the initial backup ends on the cutover date.
Detach the selected Worker's custom domain before restoring that hostname's
original CNAME. Keep the compatible 64-bit ATN count column; do not narrow it.
