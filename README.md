# stats
User count stats collector and display for Thunderbird.

## Static dashboard draft

The redesigned dashboard uses self-hosted D3 and plain ES modules. There is no
browser API key, runtime server, external font service, or JavaScript build step.
The static publisher generates `data/index.json`, compact daily totals, yearly ADI partitions, and
optional Glean and dated ESR metadata from the authoritative snapshot.

```bash
uv sync --frozen
npm ci --ignore-scripts
npm run build:preview
npm run preview
```

The preview is served at http://127.0.0.1:8877. To refresh ADI from the public
production dataset before building, run `npm run build:preview -- --refresh-adi`.
This validates and saves the full dataset in `.state/thunderbird_adi.json`;
ordinary builds reuse the cache without making network requests. The refresh
rejects invalid data and snapshots that would remove cached history.

The build copies checked-in data, then overlays local `.state/glean.json`,
`.state/release_history.json`, and `.state/thunderbird_adi.json` when present.
It retains the cached ADI snapshot's exact daily totals and merges available
`.state/adi-channels-preview.json` observations for version/channel detail only
on dates in that snapshot. Local channel reprocessing can differ slightly from
published totals; it never changes the daily chart or headline's source counts.
The generated `adi_daily_totals.json` records this separate provenance, and
the browser manifest identifies it as `adi.totals_source`. Without that optional
input, a static build derives totals directly from its ADI observations.
The build does not modify those sources or publish anything. To preview a restored snapshot instead, run
`uv run python -m stats_pipeline.preview --data .state`.

The staging deployment additionally layers the reviewed aggregates in
`staging-data/` over the restored snapshot using `tb-stats build --supplemental-data`.
This supplies the rewrite's Glean, release, and historical channel detail while
retaining the snapshot's authoritative daily totals and date coverage. Production
builds do not use these fixed review datasets. See
[staging-data/README.md](staging-data/README.md) before refreshing or removing them.

The daily chart, headline count, and full-history navigator load compact totals;
the explorer loads full version partitions only for its selected years. The
headline is the trailing seven-day average through the latest available day.
The daily chart shows both observations and that average, requiring all seven
calendar days; missing observations remain gaps.
The explorer supports channel, major-version, detailed-version and custom rules,
stacked shares/counts and comparison lines, historical or pinned ESR cohorts,
saved/shared configurations, and SVG/CSV exports. Every observed major or full
version is available without an automatic Other bucket. Search, individual
toggles, and bulk selection focus a comparison; exact versions can also become
custom groups. Other time charts likewise expose every published category.
An explicitly labeled Other (publication aggregate) retains categories combined
when preparing public data, including labels below the reporting threshold.
Those individual values cannot be recovered by the UI.
Stacked cohorts use first-match precedence; line cohorts may overlap. Hidden
series keep their original percentage denominator. Unknown channels and missing
dates are retained explicitly. Legacy telemetry/platform/language archives stop
at May 31, 2025; underlying historical files are preserved.

Time charts have From/To date inputs and range presets, including historical
archives; aligned donation comparisons use From/To month controls. The selected dates also filter its CSV and data table. Daily ADI and
the version explorer additionally have draggable history navigators. Spending
allocation is a yearly snapshot with a reporting-period selector.

Secondary charts offer lines, overlaid areas, and grouped bars, with stacked
counts/shares for categorical metrics. The latest-breakdown view compares every
published category using ranked bars, a selectable observation, and linear/log
scales. Legends, tables, CSV and SVG exports respect selection; an explicit
checkbox includes hidden series. Pinned tooltips retain all visible categories.

Funding defaults to separate yearly areas on a January–December axis; monthly,
cumulative, and chronological views remain selectable. Annual bars distinguish
partial years and offer a comparison of the same reported months across years.
Missing months remain gaps and explicit published annual totals take priority.
The add-on source selector also retains earlier update-request estimates as a
separate chart.

Glean is the default for feature metrics and platforms/languages. Add-ons retain
the existing source by default, with a separately labeled Glean view: Glean uses
a different reporting population and ranks its own weekly top ten. See
[GLEAN_DATA_NOTES.md](GLEAN_DATA_NOTES.md) for metric definitions and coverage.
Platforms show OS version detail with readable Windows product names, macOS
families and their reported Darwin versions, and Linux kernel versions. Current
Glean distinguishes Windows 10 from Windows 11 using build numbers; the legacy
archive labels their shared NT 10.0 population as Windows 10 / 11. Languages
appear before operating systems in both sources.
Secure-message read and load events are separate metrics with OpenPGP/S/MIME
signing and encryption categories. General read/sent counters are explicitly
labeled as all messages; secure-load counts include reopening messages.
OAuth Providers is available in Telemetry's metric picker, with current Glean
account snapshots and authentication-window events. Provider filtering and independent outcome,
reason, channel, major-version, and window-type breakdowns retain their own
reporting populations. The January–February 2025 Glean snapshot remains in the
data-source selector; the former `oauth.html` URL and `#oauth` links open this
Telemetry view.
Each Telemetry chart has a **Copy link** button. Links select the metric and
current or historical data source, then scroll to the chart. OAuth links also
retain the provider and authentication grouping, and distinguish the accounts
chart from the authentication-prompts chart. The metric picker updates the
address bar, so its URL can also be shared directly.
The approved implementation/review scope is in
[STATS_SITE_REDESIGN_PLAN.md](STATS_SITE_REDESIGN_PLAN.md).

Public Glean aggregates suppress low-population custom labels into Other and
publish normalized channels and coarse version coverage. Existing unverified
free-form labels are folded conservatively at the static-build boundary too.
Weekly collection leaves a full day for ingestion before accepting a completed
week. See the data notes for the precise retention and aggregation rules.

```bash
uv run pytest -q
npm run test:unit
npx --no-install playwright install chromium
npm run test:browser
```

Browser tests build a small deterministic fixture through the static publisher
and check saved rules, export, archive boundaries, themes, keyboard use, mobile
layout, missing-week gaps, and the add-on source distinction. They use a separate
local port (8878) and do not depend on production data or credentials.

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
