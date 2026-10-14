# Thunderbird stats site redesign plan

Status: static draft implemented and independently reviewed by GPT 6 Astra and
Fable 5.1. See `STATS_SITE_REDESIGN_REVIEW.md` for final checks, review dispositions,
initial data coverage, and remaining historical backfill limits. Not deployed.

This plan covers the static stats-site redesign, the unified ADI explorer,
Glean-based telemetry views, and the independent review process. It is separate
from `MIGRATION_PLAN.md`, which documents the existing collection and CI migration.

## 1. Scope and constraints

- Keep the site entirely static: HTML, CSS, JavaScript, assets, and aggregate JSON.
  Collection and warehouse queries run in the existing pipeline, with no credentials
  or authenticated data access in the browser.
- Take visual inspiration from https://start.thunderbird.net/en-US/release/ in both
  light and dark modes.
- Replace the separate ESR uptake and Beta/Nightly graphs with one configurable
  versions-and-channels explorer.
- Keep separate Daily Installations and MAU tabs, with their existing data sources
  and calculation methods.
- Replace legacy scalar, platform, and language views with verified Glean data.
- Use Glean add-on data if it supports equivalent measures; otherwise retain the
  current add-on source.
- Preserve other tabs and pages, including donations, support, and OAuth, and
  preserve their data sources and functionality.
- Preserve existing history and incorporate the recently repaired CI's recovery,
  validation, snapshot, and deployment behavior.

## 2. Validate and extend the data model

The current ADI source logs contain the information needed for channel analysis;
the processing currently drops channel information. Extend collection to retain
**date × channel × version** from those same sources. Do not infer ESR versus
Release from version numbers.

- Inspect the request formats and normalize channel values consistently.
- Backfill channel aggregates from retained source logs and verify historical
  coverage. Report any actual gaps found during that audit.
- Reconcile channel totals with existing ADI totals, including every contributing
  source, to prevent omissions or double counting.
- Use full, unpruned version counts for custom groups. The current uptake files
  prune small populations and therefore cannot be the explorer's source of truth.
- Publish explicit dataset metadata: source, reporting window, units, denominator,
  freshness, coverage, and any known limitations.
- Validate Glean metric definitions, actual population coverage, earliest reliable
  dates, and aggregation semantics before replacing existing views.

Initial research found recent Glean platform, locale, and active-add-on data, plus
schema candidates for most existing scalars. This establishes feasibility; it does
not yet establish that all replacements have equivalent historical coverage or
counting semantics.

## 3. Visual foundation and frontend

Use D3 with small reusable JavaScript modules for charts and interactions. Publish
all dependencies as static assets. Reuse existing code where suitable, and replace
Highcharts chart rendering as the new shared components take over.

- Adopt the reference page's blue/violet gradients, clear typography, spacious
  layout, restrained borders, and light and dark surfaces.
- Provide System, Light, and Dark theme settings with a persistent preference.
- Give the main explorer most of the page width, with consistent controls,
  accessible navigation, and responsive mobile layouts.
- Share colors, axes, number formatting, tooltips, legends, tables, and export
  controls across charts.
- Keep source explanations and detailed tables available without overwhelming
  the main view.

## 4. Unified versions-and-channels explorer

Replace the separate ESR-family uptake and Beta/Nightly graphs with one explorer.

- Channel selection: ESR, Release, Beta, and Nightly, individually or together.
- Grouping modes: Channels, Major versions, Detailed versions, and Custom groups.
- Display modes: stacked percentages, stacked counts, and comparison lines.
- Date presets, an explicit date range, range selection, hover inspection,
  searchable legend, data table, and CSV export.
- Smooth transitions when changing groups, modes, and dates, while keeping controls
  responsive and honoring reduced-motion preferences.
- Stable series identity and colors when toggling or regrouping data.

## 5. Custom grouping

Provide a group editor with names, colors, order, visibility, version selections
and ranges, channel conditions, and exclusions.

Initial presets:

- 115 and below.
- ESR version families.
- Latest ESR family versus everything else.
- Latest ESR patch versus older ESR versions.
- Release versus ESR.
- Individually selected versions.

Support both the ESR that was latest at each historical date and a pinned ESR
family. Use dated release metadata for the historical definition, so today's
release does not incorrectly become the latest ESR throughout past data.

For stacked charts, use explicit group precedence and an Everything else remainder
to ensure each record belongs to one displayed group. Overlapping groups can be
compared in line mode, with overlap identified. Keep the denominator explicit;
hiding a series must not silently change the population used for percentages.

Save configurations locally and support sharing through URLs or configuration
export/import. Missing observations must remain distinguishable from zero.

## 6. Telemetry, add-ons, and other tabs

| View | Planned treatment |
| --- | --- |
| Telemetry Scalars | Rebuild around validated Glean equivalents, with readable metric names, units, reporting populations, and coverage dates. |
| Platforms & Languages | Use Glean platform and application-locale data with a documented reporting window and client deduplication. |
| Add-ons | Validate the Glean add-ons ping against the existing measures, including users with add-ons and exclusion of the top ten. Switch if equivalent measures are supported; otherwise retain the current source. |
| Daily Installations | Keep a separate tab and the existing ADI source and methodology. |
| MAUs | Keep a separate tab and the existing source and adjustment methodology. |
| Donations, Support, and other pages | Preserve data sources and functionality; apply the shared visual treatment where appropriate. |

For Glean, distinguish unique reporting clients from ping counts and distinguish
missing metrics from zero values. Validate metric types before aggregation; a
counter, a per-client snapshot, and a distribution need different treatment.

Put legacy telemetry, platform, and language views behind an explicit Historical
data control, hidden by default. Interpret the requested cutoff as May 31, 2025,
inclusive. Preserve existing stored history, including records after that date,
without displaying later legacy data in the default historical view. Identify
the source boundary rather than presenting legacy and Glean observations as one
continuous series with identical measurement semantics.

Preserve existing add-on history if that view changes to Glean.

## 7. Static delivery and CI integration

- Extend the existing pipeline, snapshots, validation, and static deployment
  machinery instead of creating an independent production data path.
- Generate date-partitioned aggregate datasets and load tabs and historical ranges
  on demand. The current full ADI JSON is approximately 14 MB.
- Publish a manifest identifying dataset files and coverage, and verify that every
  referenced asset is included in the static build.
- Preserve existing external data consumers and validate that ADI and MAU results
  remain consistent through the redesign.
- Preserve successful data when a collection component fails, with visible data
  freshness information and appropriate retry behavior.

## 8. Implementation order and delegation

After approval:

1. Complete the source/channel and Glean audits; define normalized datasets and
   document metric mappings and coverage.
2. Build a working rough draft with real ADI data, the visual foundation in both
   themes, the unified explorer, and custom grouping.
3. Add validated Glean collectors, historical views, and the remaining charts;
   integrate them with the existing pipeline and static build.
4. Perform functional and data validation, then the independent review cycle below.

Use sub-agents for distinct data-pipeline, frontend, testing, and review tasks as
needed. Give implementation tasks clear ownership and reconcile their results
before review.

## 9. Independent code and visual reviews

Once a working rough draft is available, have **GPT 6 Astra** and **Fable 5.1** each
perform both a code review and a visual review. Invoke GPT 6 Astra through the
sub-agent tools and Fable 5.1 through Claude.

Provide each reviewer with the requirements, relevant code and changes, the
rendered draft, and screenshots or browser access for both themes and desktop and
mobile layouts. Review chart interaction, custom grouping, accessibility,
performance, static deployment, and data correctness.

- Collect independent findings from both reviewers.
- Integrate improvements that make sense and record reasons for declining any
  material recommendation.
- Re-run relevant checks after changes and obtain follow-up review for substantial
  revisions or unresolved findings.
- Make the final handoff only after both reviews and the improvement/validation
  cycle are complete. Include the reviewed preview, validation results, and any
  remaining limitations.

## 10. Acceptance checks

- Channel aggregates reconcile with existing ADI totals.
- Custom groups handle overlap, remainders, version ranges, and historical
  latest-ESR rules correctly.
- Percentages use the documented denominator, including when series are hidden.
- Glean aggregates use validated client populations and metric semantics.
- Legacy archives honor the May 2025 display cutoff and preserve stored history.
- Daily Installations, MAUs, and other retained sources retain their methodology.
- Keyboard navigation, reduced motion, mobile layouts, exports, and both themes
  work throughout the site.
- The complete site runs as static assets, with no browser credentials or backend
  requirement, and passes the relevant existing and new CI checks.
- Both named reviewers complete code and visual reviews, and worthwhile findings
  are incorporated before the final handoff.
