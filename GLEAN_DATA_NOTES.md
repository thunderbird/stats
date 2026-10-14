# Glean data contract

`stats_pipeline.glean.collect(existing, through, start=None, refresh_week=None,
on_error=None, max_weeks=8)` builds `glean.json`. `empty_data()`, `validate(data)`,
`sanitize_public(data)`, and `check_freshness(data, through)` support snapshot integration. Collection is
read-only and uses STMO's `Telemetry (BigQuery)` data source, discovered by name.
Set `GLEAN_API_KEY`; `GLEAN_KEY` is accepted for local development. Keys remain in
HTTP authorization headers and are never written to public files.

Each date is a Sunday, covering the preceding Monday through that Sunday in UTC
by **submission timestamp**. The collector's backfill bound is the week ending
2025-05-04; this does not imply that every metric was already instrumented and
reported then. Actual coverage is tracked for each metric and section. These
are telemetry reporting populations, not ADI or MAU estimates.

Collection waits one additional completed UTC day for ingestion: the Sunday
endpoint is eligible only when `through` is at least Monday. The daily runner
passes yesterday, so a Monday 04:00 run still uses the preceding week; a Tuesday
04:00 run can collect the newly completed Sunday. This avoids permanently
freezing Sunday's early-morning, partially copied data. Explicit refreshes use
the same eligibility rule.

## Measurements

- Platforms and application locales use the latest baseline ping per client in
  each week. Every client contributes to one category; missing values remain an
  explicit `Unknown` category.
- Account, address-book, calendar, and read-only-calendar counts use each
  client's latest nonmissing metric snapshot in that week. A client contributes
  once per metric, even if it sends many pings.
- `mail.oauth2_provider_count` uses the same snapshot rule for incoming mail
  accounts using OAuth, grouped by issuer. It measures configured accounts,
  independently of whether an authentication window appeared that week.
- Successful and failed account setup, web searches, uploaded bytes, messages
  read, and messages sent are ping-lifetime counters. They are summed across
  distinct ping documents, rather than taking only the client's last ping.
- Secure-mail reads and loads come from the events ping. Event documents are
  deduplicated before counting individual events; repeated loads within a
  document remain separate observations. The two probes retain their different
  semantics as described below.
- Every metric record has a separate `count` of distinct reporting clients and
  `total` measured quantity. `versions` contains the measurement's label totals
  for compatibility with the historical chart data shape; it does **not** mean
  Thunderbird versions. `coverage.versions` and `coverage.channels` describe the
  reporter population using each client's latest retained ping.
- An absent metric is not a zero. The schema is checked first; each successful
  week records observed, unobserved, and unsupported metric IDs. Invalid or
  negative values are not included in measurements. A reported numeric zero is
  retained.
- Automated bot-generated pings and missing client IDs are excluded. No client
  IDs or raw ping documents leave the warehouse.

The metric definitions are in Thunderbird's
[mail metrics](https://github.com/mozilla/releases-comm-central/blob/master/mail/metrics.yaml),
[calendar metrics](https://github.com/mozilla/releases-comm-central/blob/master/calendar/metrics.yaml),
[address-book metrics](https://github.com/mozilla/releases-comm-central/blob/master/mail/components/addrbook/metrics.yaml),
[Filelink metrics](https://github.com/mozilla/releases-comm-central/blob/master/mail/components/cloudfile/metrics.yaml),
and [compose metrics](https://github.com/mozilla/releases-comm-central/blob/master/mail/components/compose/metrics.yaml).
Collection checks the live BigQuery schema; a source definition by itself does
not establish that a metric is actually being reported.

### Secure messages

The legacy `tb.mails.read_secure` scalar was omitted from the initial Glean
collector because its replacements are in `thunderbird_desktop.events`, rather
than the metrics table. The collector now queries both event names:

- `mail.mails_read_secure` counts newly read secure messages. This is the event
  defined in [ESR 140](https://hg.mozilla.org/releases/comm-esr140/raw-file/tip/mail/metrics.yaml).
- `mail.secure_mail_loaded` counts secure-message loads, including reopening
  previously read messages. The change was uplifted to 153.0b4; see
  [bug 1867271](https://bugzilla.mozilla.org/show_bug.cgi?id=1867271).

The dashboard exposes them separately as **Secure messages read** and **Secure
messages loaded**. It does not merge them into a continuous read count. Event
identity determines the measurement, avoiding assumptions about release dates
or channel version cutoffs.

Both events provide `security`, `is_signed`, and `is_encrypted` extras. The
collector publishes six mutually exclusive categories: signed only, encrypted
only, and signed and encrypted for each of OpenPGP and S/MIME. A message that is
both signed and encrypted contributes once to its combined category. This
differs from the old scalar's overlapping signed/encrypted labels and makes
the sum equal the event total. Missing or invalid security details remain in
an explicit **Unknown security details** category; absent flags are not assumed
to be false. Fixed security categories do not undergo free-form label folding.

Each record separately retains the count of distinct clients that reported
that particular event and the event totals. The values count read/load events,
not unique messages, users, or delivered messages.

General `mail.mails_read` and `compose.mails_sent` counters remain available as
**All messages read** and **All messages sent**. The legacy sent scalar and
current compose counter are not security-specific; the inspected definitions
do not provide a secure-send breakdown.

### OAuth authentication

`mail.oauth2_authentication` is an active Glean event, not legacy Telemetry.
The old `docs/oauth.json` file is a historical Glean export from January–February
2025, previously generated by `tools/glean/oauth.py` using STMO query 104489.
The maintained collector now publishes current completed weeks in `glean.oauth`.

Each weekly OAuth record has `count` distinct reporting clients, `total` events,
`breakdowns` for issuer, channel, major version, reason, result, and window
location (`where`), and `issuers` containing per-provider records with the other
five dimensions. Each breakdown sums to its own record's event total; dimensions
are alternative views of those same events and must never be added together.
Each provider retains its own distinct-client count, since one client may use
multiple providers. `label_clients` stores named labels' reporter populations,
not additional event values.

Authentication counts measure windows displayed and their recorded outcome;
silent/background token renewals are not counted. Event documents are deduplicated
before unnesting events. Each extra is extracted with a scalar subquery so missing
extras are retained and multiple extra keys cannot multiply event counts.
Channel and version describe the actual event's ping, not the client's final
ping that week. OAuth account snapshots are a separate measurement.

Known public issuer labels come from
[OAuth2Providers.sys.mjs](https://github.com/mozilla/releases-comm-central/blob/master/mailnews/base/src/OAuth2Providers.sys.mjs).
Known reason, result, and location values come from
[OAuth2.sys.mjs](https://github.com/mozilla/releases-comm-central/blob/master/mailnews/base/src/OAuth2.sys.mjs).
These fixed product labels are retained individually. Missing/unrecognized
event details are explicitly `Unknown`; unknown issuer identifiers use
`__other__` and are never published raw. Custom channels use `other`.
Versions are reduced to majors before aggregation and require 100 distinct
reporters per weekly marginal, including within each provider. Suppressed
version totals use `other`; no distinct-client count is invented by adding
the populations of suppressed labels. These rules apply to cached snapshots
through `sanitize_public` as well as newly queried aggregates.

OAuth is an independent weekly transaction and coverage section. Existing
schema-1 files without it remain readable; collection adds its empty definition
and queries the missing weeks. Query failure, invalid marginals, or loss of
previously observed events retain the previous OAuth record and coverage.
An absent events schema is `unsupported`, a successful empty query is
`unobserved`, and neither means a measured numeric zero. Current-week freshness
requires the section's query to finish, while allowing either documented state.

## Operating system versions

The baseline query retains OS versions instead of grouping only by OS family.
Each client still contributes once, from the same latest weekly baseline ping
used for locale and reporter coverage. `client_info.os_version` supplies the
version, and `client_info.windows_build_number` distinguishes Windows 10 from
Windows 11 for NT 10.0. Build 22000 begins the Windows 11 family, following
[Microsoft's version/build table](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/inf-manufacturer-section).
Windows labels identify version families; Server editions sharing those NT/build
values cannot be identified separately from these fields.

The browser names Windows NT 6.1 as Windows 7, 6.2 as Windows 8, and 6.3 as
Windows 8.1 in legends, tooltips, breakdowns, tables, and CSV/SVG exports.
Historical NT 10.0 remains **Windows 10 / 11** because that archive did not
retain build numbers. Historical macOS and Linux records contain only OS families.

Current macOS records retain the reported Darwin kernel version and show its
known macOS major family. An unfamiliar Darwin family keeps its kernel label
without guessing a product version. The kernel cannot identify every macOS
patch release, as described in [Mozilla bug 2017277](https://bugzilla.mozilla.org/show_bug.cgi?id=2017277).
Linux labels identify reported kernel versions, not Linux distributions.
Numeric OS versions are normalized before grouping; existing publication
thresholds and explicit unknown categories still apply.

Successful baseline coverage records `platform_detail: 1`. Cached family-only
weeks are marked `pending_platform_detail` and re-queried as independent baseline
transactions, within the existing newest-first week limit. Failures preserve
prior counts and the retry marker; unrelated metric, OAuth, and add-on sections
are retained. Freshness rejects a pending detail refresh in the latest week.

## Add-ons

The Glean `addons` ping exposes `metrics.object.addons_active_addons` as JSON.
Live schema inspection confirmed that it contains an array of objects with
`id`, `addonType`, and `isSystem` fields. These match the
[upstream add-on metric definition](https://github.com/mozilla-firefox/firefox/blob/main/toolkit/mozapps/extensions/metrics.yaml),
which recommends the add-ons ping for add-on analyses.

Collection takes the latest available weekly add-on snapshot per client, counts active
extensions, excludes system extensions and themes, and retains the existing
ignored GUIDs (`wetransfer@extensions.thunderbird.net`, `search.mozilla.org`).
The denominator is the Glean add-ons reporting population. The top ten are
ranked by distinct weekly clients **within Glean**. The historical collector
uses the ATN popularity listing, so these measures must not be joined into a
single continuous legacy/Glean series without a visible source boundary.

Clients with no valid array snapshot are excluded from the measured population
and counted in `coverage.missing_snapshots`; they are not counted as having no
extensions. Malformed aggregate results fail that weekly section. An integration
can retain the legacy data view when Glean add-on coverage is unavailable.

The redesigned dashboard retains the existing add-on source by default and
offers Glean through a separate data-source option. Its population and weekly
top-ten ranking are explicitly labeled.

## Recovery and publication

Public free-form metric labels require at least **100 distinct reporting
clients per label per week**. Labels below that floor are folded into
`__other__`, retaining their measured quantities. The floor is based on
reporters, never on the measured quantity: one client uploading many bytes
does not make its provider label safe to publish. A small allowlist of fixed,
public product categories (such as IMAP, POP3, and the scalar `all` category)
can remain below the floor. The allowlist is declared in `STATIC_LABELS`.

Newly collected metric records retain `label_clients` only for published named
labels. There is no fabricated distinct population for `__other__`: one client
can contribute to several suppressed labels. Historical records without
per-label populations conservatively fold all free-form names, even if their
measured quantities are large. `sanitize_public(data)` returns a deep copy and
also supports partial snapshots, so both the collection path and every static
publication path can enforce the policy without a warehouse request.

Coverage channels are restricted to `esr`, `release`, `beta`, `nightly`, and
`other`. Coverage versions are reduced to major versions, with populations
below 100 and custom build strings placed in `other`. Small platform and
locale populations use `__other__`; add-on IDs below the same floor are omitted
from the published top-ten listing. These operations preserve the original
measurement and reporting-population totals. Privacy metadata accompanies the
public snapshot.

Each weekly section is an independent transaction in memory. Query failure or
invalid aggregate results preserve previous records and completion metadata.
Successful sections can be saved while failed sections remain retryable.
`refresh_week` re-queries a completed week without first deleting its records.
STMO polling and HTTP calls have bounded timeouts. All scans include explicit
submission-time partition bounds; only aggregate rows are returned.

Collection processes at most eight missing weeks per run, starting with the
newest, and records the remaining backlog under `coverage.pending`.
`max_weeks` can override that positive limit; an explicit `refresh_week` takes
priority. Normal runs gradually fill older history without delaying current
data until the initial backfill finishes.

Successfully queried historical weeks with no source observations are marked
`unobserved` and retain no numeric record. This prevents pre-instrumentation
weeks from monopolizing the retry backlog. A refresh cannot erase previously
observed data, and a current week without baseline observations fails freshness.

Adding a metric definition preserves existing records, adds the new definition,
and reopens only the affected weekly metric query. A failed schema refresh
retains the former availability audit with `pending_definitions`, retries on a
later run, and fails current-week freshness until refreshed. Removed definitions
remain as `retired: true` with their historical records. Validation accepts
older definition sets and retained retired metrics while still checking every
stored record's dates, measured totals, coverage, and reporting populations.

`coverage.weeks` describes completed collection, including successfully queried
metrics with no observations. It is not an assertion that every Thunderbird
channel or version reports every metric. Charts must show the per-record
reporting population and respect gaps in the series.

## Live verification, 2026-10-13

Read-only STMO queries for the week ending 2026-10-11 returned real observations
for all ten configured metrics. The baseline query found 11,871,044 distinct
reporting clients, six platform labels, and 67 application locale labels. All
four main channels were represented, alongside a small population with custom
or unknown channel names.

The account snapshot had 9,969,634 reporters and 24,026,014 accounts. The calendar
snapshot had 3,379,091 reporters and 7,507,866 calendars. These different
populations demonstrate why metric-specific denominators must be retained.

The add-ons query found 10,571,072 clients with valid snapshots, including
1,825,416 with qualifying extensions and 995,149 with an extension outside the
weekly Glean top ten. Another 124,188 clients submitted add-ons pings without a
valid snapshot and were excluded explicitly. The Glean result is useful as a
separate view; it does not establish continuity with the legacy add-on series.

The preview aggregates live in ignored `.state/glean.json`. This file is local
verification data, not a production-state update or a claim that the complete
May 2025 onward history has already been backfilled. New collection starts with
the freshest missing weeks and fills older coverage in bounded batches.
All ten metrics, platforms, locales, and add-ons were collected and validated
for the four weeks ending 2026-09-20, 2026-09-27, 2026-10-04, and 2026-10-11.
After review, the preview was sanitized locally without additional warehouse
queries. All original measured totals and reporting populations were verified
unchanged; 757 historical free-form label occurrences were folded, and the
four-week JSON was reduced to approximately 34 KB. Older preview records lack
per-label reporter counts, so their free-form labels use the conservative
historical policy described above.

The secure-message follow-up queried the events table for the week ending
October 11. It returned 393,433 secure-read events from 71,504 reporting clients
and 12,259,668 secure-load events from 1,172,812 reporting clients. All six fixed
security categories were present. These are separate probe populations and
behaviors, not interchangeable counts. Both queries deduplicate documents and
return aggregates only; no client IDs or raw events are published.

Both secure probes were also collected for the other three preview weeks
(September 20, September 27, and October 4), bringing the preview to twelve
metrics over the same four weeks. The ten existing metrics, baseline
distributions, and add-on records were retained without changes.

The OAuth follow-up confirmed both the account gauge and event fields in the
live schema. For the week ending October 11, the event query returned 1,416,376
authentication events from 286,621 distinct reporting clients. This includes
265,767 successful outcomes and 757,357 cancellations; it does not represent
all account sign-ins. Google, Microsoft, and Yahoo accounted for 641,013,
315,216, and 230,704 events respectively. The location extra was missing for
419,513 events, retained as `Unknown` rather than inferred from the client
version. Smaller known issuers remain individually visible.

The four preview weeks ending September 20, September 27, October 4, and
October 11 now contain both OAuth measurements. Authentication totals are
1,582,512; 1,464,917; 1,459,411; and 1,416,376 events respectively. The latest
account snapshot contains 5,450,563 incoming OAuth accounts from 2,833,260
reporters. Existing metric measurement totals and reporting populations were
unchanged by the normal definition refresh. Both secure-message records and
all platform, locale, and add-on data remained byte-equivalent after canonical
JSON serialization. The current cache remains local preview data, not a
production deployment.
