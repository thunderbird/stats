# Stats site draft: implementation and review record

The reviewed draft is implemented in `docs/index.html`,
`docs/media/css/dashboard.css`, and
`docs/media/js/{dashboard,chart,explorer-model}.mjs`. Its approved scope is in
`STATS_SITE_REDESIGN_PLAN.md`. It remains a static bundle with self-hosted D3,
fonts, and aggregate JSON, built through the existing publisher.

## Independent reviews

**GPT 6 Astra and Fable 5.1 both completed independent code and visual reviews.**
Fable was invoked through Claude CLI; its returned model metadata confirms
`claude-fable-5-1`. Both inspected the rendered desktop/mobile themes. Findings
were integrated and followed by further review; no blocking findings remain.

Reports and dispositions:

- `reviews/stats-site/astra-review.md`: initial review.
- `reviews/stats-site/astra-followup.md`: original findings closed.
- `reviews/stats-site/astra-final-data-review.md`: populated-data visuals.
- `reviews/stats-site/astra-post-fable-review.md`: final code/visual signoff.
- `reviews/stats-site/fable-review.md`: initial review, with source-label examples redacted.
- `reviews/stats-site/fable-followup.md`: final code/visual follow-up, no blockers.
- `reviews/stats-site/fable-disposition.md`: all findings and decisions.

Review-driven changes include dated historical ESR update-channel matching,
public Glean label suppression, schema evolution and ingestion grace, compact
ADI totals, a full-history navigator, stable series colors, full-version search,
exact group precedence, missing-week gaps, readable metric grouping, source
separation, mobile controls, and share/CSV/asset validation fixes.

A seven-day selection remains narrow on the full nine-year navigator. Its date
extent stays accurate; date inputs and presets offer an alternative. This is
nonblocking visual polish, not a data or interaction failure.

## Verified data and limits

The local preview includes 93 consecutive days of recorded channel history from
July 12 through October 12, 2026. Complete AUS logs supply explicit channel
labels; established daily ATN aggregates, or complete raw ATN logs, supply its
unclassified contribution. Earlier ADI history remains available and explicitly
unclassified. `CHANNEL_DATA_NOTES.md` documents the sources, validation and
replay differences of -5 to +35 requests. The authoritative daily totals and
seven-day headline remain unchanged. This backfill supersedes the initial
seven-day channel window.

The Glean preview contains four complete weeks ending September 20 through
October 11, 2026: feature metrics, OAuth accounts and authentication events,
operating systems, application languages, and add-ons.
`GLEAN_DATA_NOTES.md` documents live query validation, populations,
aggregation, public-label suppression, missing observations, ingestion grace,
and bounded historical backfill. Both public Glean paths are sanitized and
retain the same aggregate totals as the collected data.

The existing add-on source remains the default because its ATN ranking and
reporting population differ from Glean's. Its actual end date is shown; Glean is
a separately labeled option. Legacy telemetry/platform/language views stop at
May 31, 2025, without deleting stored history. Daily/MAU, funding, and support
keep their existing sources and methods. OAuth uses current Glean aggregates,
with its previous Glean snapshot available as an archive.

## Reproduction and validation

`npm run build:preview` creates `build/preview`; `npm run preview` serves it at
http://127.0.0.1:8877. `README.md` describes snapshot-based previews and checks.
`build/stats-site-draft.zip` contains the same static site. Review screenshots
and command logs are in `build/review`.

Final checks: **198 Python tests plus eight subtests, 18 JavaScript model tests,
11 Chromium integration tests, and Ruff all pass.** Browser regressions cover
saved/imported rules, exports and share recipients, data-source boundaries,
archives, reduced motion, keyboard interaction, mobile editing, missing-week
gaps, stable exact-version precedence, compact-data loading, and navigator
persistence. Additional review checks exercised real-data source accounting,
public Glean privacy/conservation, and both themes at 320–1440px.

Generated review data live in local `.state` files and are not committed
public datasets. No production resources were changed and no deployment was
performed. Historical backfill coverage should be reviewed before production
cutover.

## Follow-up: daily averages, data freshness, and grouping

The daily chart now includes raw observations and a trailing seven-day moving
average. The headline uses that complete calendar-day average, including the
latest date; it does not substitute a single day or an incomplete week. The
refreshed production ADI snapshot ends October 12, 2026. Its October 6–12 counts
average 8,429,388.857 installations, displayed as 8.43M. Preview builds preserve
these exact published totals separately from local channel enrichment, whose
coverage remains October 5–11. `--refresh-adi` updates the validated local cache;
ordinary builds remain offline.

All time charts now expose From/To inputs and range presets, including archives;
range selection also applies to CSV exports and data tables. Daily ADI retains
a draggable full-history navigator. Spending allocation offers its available
annual reporting periods.

Automatic display caps no longer fold major versions, full versions, or other
published categories into Other. Search and individual/bulk selection expose
all available series. Categories already aggregated upstream remain explicitly
labeled Other (source aggregate), with their limitation stated beside the chart.

Follow-up validation passed 22 JavaScript tests, 16 Chromium integration tests,
28 targeted Python tests, and Ruff. These cover complete and missing-day
averages, month-end date presets, date controls across tabs and archives, range
exports, mobile layout, all available categories, and authoritative-total
preservation. Live-preview checks confirmed the October 12 headline and desktop
dark/light and mobile layouts; artifacts are in `build/review`.

## Follow-up: secure-message probes

The Glean collector now reads `mail.mails_read_secure` and
`mail.secure_mail_loaded` from the events table. The dashboard keeps newly read
secure messages separate from secure-message loads (which include reopens).
Both expose six OpenPGP/S/MIME signing and encryption categories and preserve
unknown details explicitly. General read/sent counters are labeled as all
messages, including when displaying cached older labels. The source definitions
do not supply a secure-send breakdown.

An independent source and code review verified probe identities, event
semantics, aggregation, and failure recovery. Live BigQuery validation confirmed
both probes and all six security categories in the week ending October 11.
Validation passed 219 Python tests plus eight subtests, 17 browser tests, and
Ruff. `GLEAN_DATA_NOTES.md` records the source mapping and observed totals.

## Follow-up: OAuth navigation and current Glean data

OAuth now has a main navigation tab using the shared D3 chart interface. The
former `oauth.html` page redirects there; its January–February 2025 Glean
snapshot remains available in the data-source selector. Current account
snapshots and authentication-window events are separate charts. Event views
offer provider filtering and independent issuer, outcome, reason, channel,
major-version, and window-type breakdowns, with date controls and CSV exports.

Independent review corrected provider-specific reporting populations, missing
breakdown handling, and zero-prompt weeks. A known provider total never becomes
a fabricated zero for an unavailable breakdown, and zero weeks do not create
provider-named series in outcome or reason charts. Fixed product labels remain
visible; suppressed version groups explain the 100-reporter threshold.

Validation passed 22 browser integration tests and 22 JavaScript model tests.
Regression coverage includes the old URL, archive separation, every OAuth
dimension, provider filtering, range exports, unavailable details, zero weeks,
and the 320px layout. Backend validation passed 231 Python tests plus eight
subtests and Ruff. Live preview checks in both themes at 320px and 1440px
confirmed that rendered latest-week values match the published totals:
1,416,376 authentication prompts and 5,450,563 incoming OAuth accounts. The
four weeks end September 20 through October 11, 2026. Independent review has no
remaining material findings. Screenshots and checks are in `build/review`;
backend source and population checks are recorded in `GLEAN_DATA_NOTES.md`.


## Follow-up: complete graph audit by Claude Fable 5.1

Claude Fable 5.1 reviewed aesthetics and functionality across all nine tabs:
versions/channels, daily activity, monthly activity, telemetry, OAuth, add-ons,
platforms/languages, funding and support, including the historical sources.
The audit combined source inspection, screenshot inspection and independent
browser probes. Full findings are retained in
`reviews/stats-site/fable-all-graphs-review.md`; corrections and intentional
dispositions are recorded in `reviews/stats-site/graph-audit-changes.md`.

Monthly donations now default to independent year-overlaid areas with distinct
year colors, January–December comparisons, cumulative and chronological views,
and selectable lines or grouped bars. Annual comparisons preserve published
totals, mark partial years, offer matching reported months and use annual date
presets and ticks. No financial source values were changed.

Published categories remain individually selectable and searchable. Category
charts offer history and a complete ranked observation with linear/log scales;
missing observations remain distinct from explicit zero counts. Missing stack
segments do not hide other published segments. Full chart details can be pinned
and scrolled, and mobile pinned details sit below the plot. Tables/CSV explicitly
control hidden-series inclusion; SVG downloads remain available. All time charts
retain date controls, and crowded time-axis labels are thinned to fit.

The review also restored historical add-on update-request estimates, added
historical Beta/Nightly build-label presets, retained the daily seven-day mean,
explained Glean history gaps, and marked the MAU methodology change. Build-label
presets classify published version suffixes; they cannot recover channel labels
that the source omitted. Recorded-channel comparisons remain limited to recorded
coverage. Source publication aggregates cannot be expanded into withheld labels.
The May 2025 legacy cutoff remains intentional, as requested by the user; complete
original files remain retained.

Final validation: 35 JavaScript tests, 33 Chromium integration tests and eight
static-preview Python tests pass. The final eight-state screenshot pass covers
changed funding controls, sparse data, Beta/Nightly presets, the MAU marker and
mobile pinned details with no runtime errors or document overflow. Its evidence
is in `build/review/graph-audit-final/`; the broader post-change matrix covers all
tabs in both themes at desktop and 320px widths. The static preview and
`build/stats-site-draft.zip` were rebuilt; no deployment was performed.

Final independent verification by Claude Fable 5.1 found no remaining material
issue within the corrected scope. See
`reviews/stats-site/fable-all-graphs-final-verification.md` for its exact checks,
optional suggestions and coverage limits.

The broader follow-up report is
`reviews/stats-site/fable-all-graphs-followup.md`. Its two actionable low-severity
findings were addressed: explicit Beta-suffix coverage warnings and titled SVG
exports with a complete wrapping legend. Standalone exports were tested at 320px
and visually checked on the real funding comparison. No further edits are pending.

## Follow-up: three-month channel history

A delegated source reader completed all 93 UTC days from July 12 through
October 12, 2026, using environment credentials from `secrets.sh`. It streamed
every object in complete AUS source days and recovered ATN from the existing
daily version/application archives, with raw-log fallback for October 11 and 12.
Source fingerprints, archive checksums, same-day SeaMonkey exclusions, and
published-total comparisons are retained in local audit metadata. No channels
were inferred from version labels or residual counts.

All 93 dates pass record validation and exact channel-total conservation. The
served static preview reports the same uninterrupted coverage. Its 3M preset
selects July 12–October 12; a real-browser CSV download contains all 93 dates,
and every exported channel count matches the collected observations. Both
themes were inspected without runtime errors. The headline remains 8.43M,
using the unchanged published October 6–12 totals.

Validation passed 55 targeted data/build tests, seven local reader tests, and
33 browser integration tests. Evidence and screenshots are in
`build/review/channel-backfill/`. The static preview and download archive were
rebuilt with the completed history. No production deployment was performed.

## Follow-up: shared dropdown styling

`docs/media/css/dashboard.css` now gives single-select controls consistent
theme colors, borders, spacing, chevrons, hover and focus states. Browsers with
customizable native select support also receive rounded, scrollable option menus
with selected-option highlights and checkmarks. Other browsers retain native
option menus with styled closed controls. Existing selection handlers remain
unchanged; the styles also cover dynamically generated chart controls.

All 33 browser integration tests pass. Additional real-preview checks verified
keyboard selection, one change event per selection, Escape, type-to-select,
long-list navigation, 44px touch targets, 320px viewport fit, and native fallback
selection. Light and dark screenshots and interaction evidence are retained in
`build/review/dropdowns/`. The static preview and download archive were refreshed.
No production deployment was performed.

## Follow-up: pictographic chart-style buttons

`docs/media/js/dashboard.mjs` now renders shared SVG icon buttons for lines,
overlaid areas, grouped bars, stacked counts, and stacked shares. Chart cards
offer their existing supported modes directly instead of a chart-style dropdown;
the versions explorer uses the same buttons. Buttons expose accessible names,
selected states, and hover/focus tooltips that Escape dismisses.
`docs/media/css/dashboard.css` supplies themed styling and 44px touch targets,
and `docs/index.html` contains the explorer control host.

The existing browser tests now select styles through buttons and distinguish
plot SVGs from control icons. All 33 pass, including keyboard activation,
tooltip visibility/dismissal, and donation styles retaining selected months.
Real-data checks verified all five styles in both themes, unchanged date ranges
and hidden-series selections, style restoration after snapshot view, and 320px
mobile fit. Evidence is in `build/review/chart-style-buttons/`. The static preview
and download archive were refreshed. No production deployment was performed.

## Follow-up: OAuth Providers within Telemetry

`docs/index.html` no longer contains a separate OAuth navigation tab.
`docs/media/js/dashboard.mjs` exposes OAuth Providers in Telemetry's metric
picker, reusing the provider filters, authentication breakdowns, account charts,
date controls, and exports. The duplicate generic OAuth-account metric is folded
into this view. Its archived Glean source keeps independent selection state
from historical legacy telemetry. OAuth remains available when other feature
metrics have no observations.

`docs/oauth.html` and old `#oauth` links now open
`#telemetry?metric=oauth-providers`. The metric picker generates that link when
OAuth Providers is selected, so reloading restores the view. README navigation
documentation was updated.

All 34 browser tests pass, including archive separation, old links, secure-message
metrics, provider filtering, and CSV ranges. Real-data checks cover both themes,
reloads, independent source selections, and a 320px mobile viewport without
runtime errors or horizontal overflow. Evidence is in
`build/review/telemetry-oauth/`. The static preview and download archive were
refreshed. No production deployment was performed.


## Channel backfill through January 2024

Completed 1016 consecutive UTC dates from 2024-01-01 through 2026-10-12. All records pass validation and exact channel conservation; the original 93 records and authoritative daily totals are unchanged. Historical channel names retain the actual request labels; ESR-era versions can appear under release in older sources. Replayed daily totals differ from published totals by -10 to 63 requests; those differences are retained in audit metadata. The static preview and download archive include the full history. Existing Python, JavaScript, and browser suites passed; January 2024 CSV counts match every collected channel exactly in both themes. Evidence is in `build/review/channel-backfill-2024/`, with source provenance in `.state/adi-channels-preview.metadata.json`. No production deployment was performed.
