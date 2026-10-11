# Stats processing and hosting migration

Status: implementation and isolated validation in progress. The S3 bucket,
Athena workgroups, OIDC roles, Cloudflare static resources, narrowly scoped
publishing/purge tokens, and GitHub environments are provisioned. Production
cron and hostname routing remain unchanged until validation completes.

The executable implementation and recovery commands are documented in
[OPERATIONS.md](OPERATIONS.md).

## Agreed outcome

| Responsibility | Target |
| --- | --- |
| All processing code, queries, configuration, and deployment logic | This `stats` repository |
| Daily processing | GitHub Actions at **04:00 UTC** |
| Weekly metrics | Process when due, preserving their existing date anchors |
| Persistent generated data, checkpoints, and snapshots | S3 |
| Production static website | `stats.thunderbird.net`, built from `prod` |
| Staging static website | `stats-stage.thunderbird.net`, built from `stage` |
| Static hosting | Cloudflare Workers Static Assets, without a Worker script |
| ATN imports and indexing | Existing EC2 instance `atn-admincron` |

The finished pipeline will not depend on `athenatools`, `amo-ops`, or
`thundernest-ansible`. Its static website contains HTML, CSS, browser
JavaScript, fonts/images, and JSON. There is no TypeScript server application,
Pages Function, server-side rendering, or request-time data processing.

Generated data updates do **not** create daily Git commits. Git holds the
application code, website source/assets, deployment configuration, and
hand-maintained data such as financials.

## 1. Capture the production baseline

- Back up the control server's complete generated datasets, raw MAU values,
  scripts, current crontab, and relevant configuration before modifying them.
- Treat production data as authoritative. Several local JSON files are older
  than production, so a checkout alone is not a sufficient migration seed.
- Record hashes, date coverage, schemas, and representative calculated values
  for each output file. Include archived and hand-maintained files referenced
  by the website, not only recently generated files.
- Inventory current public paths, both hostname configurations, and effective
  HTTP headers. Preserve the one-hour HTTPS cache lifetime.
- Confirm the canonical GitHub repository before configuring Actions and its
  OIDC trust. The local origin is `thundernest/stats`; the deployment playbook
  references `thunderbird/stats`.

Current production processing is scheduled on control in Pacific time:

| Job | Current schedule |
| --- | --- |
| Main ATN/AUS/ADI/MAU pipeline | Daily 00:01 |
| Add-ons, scalars, platform/locale metrics | Sunday 23:00 |
| SUMO | Daily 00:00 |

The replacement uses UTC explicitly. Its 04:00 start gives the previous UTC
day's S3 logs four hours to arrive. Late-log detection is still required.

## 2. Consolidate and modernize processing

- Move ATN and AUS Athena queries, result processing, and supporting code from
  `athenatools` into this repository. Replace the `amo-ops` orchestration here.
- Port remaining Python 2 code to a supported, pinned Python runtime. Package
  the application with declared, locked dependencies and documented commands
  for collection, validation, backfills, publication, and ATN consumption.
- Reuse the existing implementations where practical. Consolidate shared AWS,
  query polling, HTTP retry, configuration, and file-writing behavior.
- Replace implicit working directories, home-directory paths, local time, and
  sourced shell secrets with explicit configuration and environment variables.
- Give Athena runs isolated scratch prefixes and temporary tables. The old
  scripts share scratch storage and perform broad cleanup; shadow validation
  must never delete or interfere with the legacy job's data.
- Check Athena's terminal status explicitly and fail on unsuccessful queries.
  Use bounded retries/timeouts and useful logs. Never publish partial results
  or silently initialize empty history when required state is missing.
- Preserve existing output schemas and calculations during the migration,
  including the currently published weekday-based MAU adjustment and stored
  raw Glean counts. Changes to methodology require a separate reviewed change.
- Investigate the stale SUMO series and distinguish source/API problems from
  migration regressions. Avoid rebuilding unavailable historical raw data.

## 3. Store generated state in S3

Provision a dedicated bucket or clearly isolated prefix; its name has not yet
been selected or created. Separate production data, staging experiments,
Athena scratch/results, ATN handoff files, and completion manifests.

Each run will:

1. Read the latest validated dataset and its checkpoint from S3.
2. Process missing dates and recent dates whose source-log manifests changed.
   Propagate corrections into affected derived outputs, including MAU factors.
3. Validate date coverage, schemas, required files, and numerical consistency.
4. Save an immutable snapshot identified by run ID, with the code revision,
   source information, processing dates, and file checksums.
5. Advance the current validated-data manifest only after all referenced
   snapshot objects exist and validation succeeds.

Track the successfully published snapshot separately. A deployment failure
must be retryable from the same validated snapshot without repeating expensive
Athena queries. Initially retain migration backups and snapshots; define any
later retention policy explicitly rather than deleting history during cutover.

## 4. Run processing in GitHub Actions

- Schedule daily processing at **04:00 UTC** and support manual runs with
  explicit dates or a bounded backfill range.
- Keep the schedule workflow on GitHub's default branch, as GitHub requires.
  Explicitly select the intended processing/website revision; the current
  default branch is `master`, while production website deployments use `prod`.
- Run weekly collectors when their existing weekly periods become due. A late
  or missed invocation must catch up rather than skip a point permanently.
- Serialize production state updates and deployment. Use a state checkpoint
  to prevent overlapping or retried jobs from publishing inconsistent data.
- Report failed queries, validation failures, stale outputs, failed imports,
  and failed deployments/purges. Account for GitHub schedule delays and public
  repository inactivity disabling schedules.
- Use AWS OIDC with repository/ref or environment restrictions. Grant only
  required source reads, Athena/Glue operations, and writes/cleanup within the
  selected output and scratch locations. No long-lived AWS access key in GitHub.

## 5. Keep ATN imports local to `atn-admincron`

Target: `atn-admincron`, instance `i-07abb0f0d4145adae`, `us-west-2`, private
address `172.31.45.221`. SSH as `centos` works from tb-sancus-dev. The instance
is tagged `uwsgi=admin`; the existing control playbook already executes the
ATN commands there in its `addons-server` container.

Replace control's remote invocation with a locally scheduled consumer whose
code and installation configuration live in this repository:

1. After producing and validating the complete ATN input set, the GitHub job
   writes a dated S3 completion manifest with revision and artifact checksums.
   This handoff does not depend on successful website publication.
2. A local consumer polls for ready dates, verifies the input set, and acquires
   a lock before importing. Use the existing instance role for S3 access.
3. Run the existing `update_counts_from_file --date=YYYY-MM-DD --stats_source=s3`
   and `index_stats --date=YYYY-MM-DD` management commands locally.
4. Record completion durably after successful work. Verify actual command
   idempotency and failure behavior before enabling retries or corrected-date
   imports; do not assume reruns are harmless.
5. Check dependencies and move `update_addon_average_daily_users` and
   `update_global_totals` into the correctly ordered post-import sequence.
   Their existing 00:20 and 00:40 UTC schedules precede the new processing job.
6. Preserve unrelated ATN cron jobs. Choose a supported consumer runtime that
   works with the existing CentOS 7 host/container arrangement.

GitHub receives no SSH credentials, inbound access, or EC2 command-execution
permissions. ATN database/search credentials remain in the existing application
environment. The instance currently has the `ec2-s3-read` profile with
`AmazonS3ReadOnlyAccess`; verify access to the final handoff locations.

## 6. Build and deploy the fully static website

- Assemble each deployment from the selected website branch, hand-maintained
  files, and an explicitly selected validated generated-data snapshot.
- Deploy the entire assembled static bundle using Wrangler. Do not use raw
  checkout JSON files as a substitute for the current generated snapshot.
- Preserve JSON paths, chart behavior, historical files, and existing links.
  Check all referenced assets and the largest JSON file against hosting limits.
- Provision separate production and staging hosting resources before issuing
  narrowly scoped deployment tokens. Initially verify them using preview URLs.
- Associate production with `prod` and staging with `stage`. Neither checked
  remote currently advertises `stage`; establish that branch and its deployment.
  All three current web-server checkouts use `prod`, and the inspected Apache
  configuration aliases staging to the production document root.
- By default, staging reads a validated data snapshot. Stage deployments must
  not write production state or publish ATN completion manifests.
- Create the two hostname connections using operator credentials when their
  deployments are ready. Routine GitHub deployments do not manage DNS/routes.

The inspected local site is approximately 31 MiB across 119 files; its largest
file is approximately 13.3 MiB, below the current 25 MiB per-asset limit. Check
the final production-seeded bundle again before deployment.

## 7. Preserve caching and purge after deployment

The live HTTPS Apache virtual host and Ansible configuration specify
`ExpiresDefault "access plus 1 hour"`. Apply and verify
`Cache-Control: public, max-age=3600` for both deployments, including JSON.

After each successful deployment:

1. Purge the deployed hostname through Cloudflare's API using the fixed
   environment mapping:
   - Production: `{"hosts":["stats.thunderbird.net"]}`.
   - Staging: `{"hosts":["stats-stage.thunderbird.net"]}`.
2. Never send `purge_everything`, arbitrary hostnames, or a combined purge of
   both deployments.
3. Check HTTP status and the response's `success` field. Retry transient errors
   and fail the job if the purge cannot be confirmed.
4. Verify the live files and their freshness after the purge.

Cache-purge permission is zone-scoped; the workflow enforces the hostname
restriction. Cloudflare purging does not clear files already held in visitors'
browser caches, whose configured lifetime remains one hour.

## 8. Credentials and permissions

| Credential/configuration | Location and scope |
| --- | --- |
| `GLEAN_API_KEY` | Secret available to the Glean collection job; reuse the existing key |
| AWS OIDC role | Trusted GitHub production workflow/environment; restricted AWS data/query permissions |
| `AWS_ROLE_ARN`, regions, bucket/prefix/workgroup names | Non-secret configuration |
| `CLOUDFLARE_API_TOKEN` | Separate production/staging environment secrets; `Editor` scoped to the corresponding existing Worker |
| `CLOUDFLARE_CACHE_PURGE_TOKEN` | Deployment environment secret; only `Cache Purge` on the `thunderbird.net` zone |
| Cloudflare account/zone IDs and deployment names | Non-secret configuration |
| `GITHUB_TOKEN` | Automatically supplied by Actions with only required permissions |
| ATN S3 access | Existing EC2 instance profile; no static key required |
| ATN database/search credentials | Existing ATN application environment |

Operator access is needed for initial AWS IAM/storage setup, GitHub settings,
Cloudflare resource creation, and DNS/hostname changes. Do not place those
administrative credentials in the routine workflows.

Cloudflare's `Editor` role permits content/settings edits as well as deployment;
it is not an upload-only role. Give publishing tokens no product-wide access,
Worker creation/deletion, DNS, or Workers Routes Write permissions. Keep
publishing and purge credentials separate, and verify deployment works with
the narrow scopes before cutover.

## 9. Validate before cutover

- Add focused tests for date boundaries, aggregation compatibility, state
  recovery, late-log corrections, input completeness, ATN handoff/retries,
  environment separation, and hostname-restricted purge construction.
- Run the new collectors against isolated scratch/output locations while the
  old pipeline remains active. Shadow runs must not trigger production ATN
  imports or overwrite current production state.
- Compare daily and weekly results to the production baseline, explaining any
  differences before publishing them. Include at least one complete weekly run.
- Exercise interrupted-query recovery, missing source days, duplicate triggers,
  deployment failure/retry, purge failure, and restoration of a prior snapshot.
- Verify the stage site visually and check asset/JSON URLs, HTTPS, cache
  headers, file hashes, branch selection, and data dates.

## 10. Cut over and retain a rollback path

1. Save the legacy crontab and wait for any active legacy stats processing or
   imports to finish. Capture the final authoritative data/checkpoint.
2. Seed production S3 state and verify the initial static deployment against
   that exact snapshot.
3. Disable only the three legacy stats schedules and the old remote ATN import
   invocation. Preserve certificate renewal and all unrelated server jobs.
4. Enable the new GitHub production schedule and the local ATN consumer without
   allowing two producers or importers to overlap.
5. Switch `stats.thunderbird.net` after deployment verification; configure and
   verify the independent `stats-stage.thunderbird.net` deployment as well.
6. Verify the deployed dataset, hostname-limited purge, ATN import/indexing,
   post-import totals, and subsequent scheduled processing.
7. Keep old hosting, backed-up configuration, and data available for rollback
   until the replacement has completed verified daily and weekly cycles.

Rollback first stops the new producer/consumer, then restores the selected
compatible data snapshot and old schedules/hostname routing as necessary.
Do not re-enable both pipelines simultaneously. Retire stats-specific legacy
files and hosting dependencies only after acceptance; shutting down shared
machines requires checking their other workloads separately.

## Completion criteria

- All processing and deployment logic is maintained in this repository.
- Daily and weekly datasets update correctly without daily data commits.
- Production and staging serve the correct branches as fully static sites.
- The one-hour cache policy and per-hostname deployment purges are verified.
- ATN imports execute locally after validated data is ready, without GitHub
  accessing the machine.
- The pipeline recovers from missed runs and interrupted processing, with
  validated snapshots and a tested rollback procedure.
- Legacy stats cron/copy dependencies are retired; unrelated jobs are intact.

## References

- [GitHub scheduled workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule)
- [AWS OIDC for GitHub Actions](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/)
- [Cloudflare static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/)
- [Cloudflare cache purge API](https://developers.cloudflare.com/api/resources/cache/methods/purge/)
