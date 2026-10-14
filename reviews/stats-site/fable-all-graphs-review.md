# Claude Fable 5.1: all-graphs review

The review is complete. Important context first: the implementation was rewritten while I worked (docs/media/js and index.html changed at 06:39–06:40, adding funding-view.mjs, funding-model.mjs, breakdown.mjs and a new chart.mjs/dashboard.mjs). The collector's screenshots and inventory in build/review/graph-audit predate that rewrite. I verified the preview build is byte-identical to docs after the rewrite and re-probed every family against it (results in fable-checks3.json, fable-checks4.json, screenshots fable3-*.png). Pre-rewrite findings are in fable-checks.json and fable-checks2.json. The rewrite fixed the worst regressions I had found earlier: per-card chart-style switching, overlaid Jan–Dec year comparison, grouped-bar annual totals with partial-year marking, "Selected population: $x" nonsense in tooltips, count-only tables for percent charts, the 2020 add-on chart, log-scale latest-week breakdowns, and tooltip truncation. The findings below are what remains in the rewritten build.

## Defects and functional regressions (prioritized)

**High**

- **Suppressed or absent categories render as zero, not as gaps.** `docs/media/js/dashboard.mjs:1125` returns `r.versions?.[name] ?? 0`. Observed: Web searches tooltip shows "yahoo 0" on Oct 4 although yahoo was only published for Sep 27 and folded into the aggregate otherwise; Accounts shows "exchange 0"; OAuth outcome shows "Unknown 0"; the "Other (publication aggregate)" provider shows "succeeded 0, cancelled 0, Reporting clients: 0" for weeks where it was not published (`dashboard.mjs:1056-1060`). This contradicts the site's own "missing dates remain gaps" rule and misreads privacy folding as zero activity. Fix: return `null` when the label is absent from that week's record (and when a provider record is absent), so the chart draws a gap and the tooltip says "Not published separately" rather than 0. Keep explicit zeros when the source publishes 0.
- **Six weeks of published legacy data are discarded.** `dashboard.mjs:783`, `:876`, `:924` filter legacy telemetry, platforms, locales and legacy add-ons to `manifest.archive_end` (2025-05-31), but telemetry.json, platforms.json and locales.json contain weekly records through 2025-07-06 and the old site showed them. Observed: legacy cards end May 25, 2025 while the "Existing telemetry" add-on option on the same site runs through Jul 6, 2025. With Glean records beginning only on Sep 20, 2026, this widens an already 16-month hole. Fix: show all published legacy weeks and label the archive by its actual last observation; if the cutoff is deliberate, state why in the card meta.
- **Beta/Nightly history has no view.** The old site had eight beta-history charts fed by beta_nightly_adi.json and its per-family files; those files are still built (build/preview) but nothing loads them, and the new channel checkboxes only classify seven days (channel_start 2026-10-05). The only path is Detailed versions plus substring search, with 640 series. Fix without top-N: add a prerelease selector to `explorer-model.mjs:84` `matchesVersionSelector` (for example `stage:beta`, `stage:nightly`, matching the `a`/`b` suffix parsed at `:18`) and ship presets "Beta builds" and "Nightly builds" in `createPresetGroups` (`explorer-model.mjs:132`). That reproduces the old charts across all history from the main ADI file, which I confirmed carries the same beta version counts.

**Medium**

- **Month-comparison axis repeats labels in short ranges.** With month range Oct–Dec, ticks read "Oct Oct Oct Oct Oct Nov Nov Nov Nov" (fable3-funding-compare-octdec.png). `dashboard.mjs:570` passes a month-only `formatTick` while `chart.mjs:286` still generates daily ticks. Fix: for `monthComparison`, set tick values to the first of each month in range.
- **Short presets on annual and monthly cards are meaningless.** The annual card still clones the 1M/3M/6M/1Y toolbar (`dashboard.mjs:583`, `funding-view.mjs:98`); "1M" yields one bar (fundingAnnual1m, pre- and post-rewrite). Fix: give annual cards no sub-year presets (or "last 5 years / 10 years / all"), and hide presets shorter than the series cadence.
- **Smooth interpolation between sparse points.** `chart.mjs:319` defaults to `curveMonotoneX`; funding timeline and year comparison draw humps between the 1st-of-month points (fable3-funding-compare.png, fable3-funding-timeline.png) and the MAU/weekly cards do the same. Only the daily card passes `curve:'linear'`. Fix: linear (or step) for monthly, weekly and annual series in `funding-view.mjs:67,77` and the MAU/metric cards; keep monotone off by default.
- **Channel legend defaults to a date with no channel data.** `dashboard.mjs:307` sets the legend date to the last record (Oct 12), so Channels grouping reads "ESR 0%, Release 0%, Unknown 100%" until the user clicks the new "Use dates with recorded channels" button (fable-checks4.json). Fix: when `channelView` is true, default the legend date to `channel_end`.
- **Mobile pinned details cover the plot.** At 375px the pinned tooltip is 292×290px over a 341×243px chart (fable3-mobile-funding-tooltip.png; same for locales). `chart.mjs:173-178` always positions it inside the chart. Fix: below 520px render pinned details as a panel under the chart (or a bottom sheet), not an overlay.
- **Log-scale axis shows "100m" for counts.** `breakdown.mjs:163` uses a lower bound one decade below the minimum, so a minimum of 1 produces 0.1, formatted as "100m" (fable3-telemetry-legacy-snapshot-log.png). Fix: clamp the lower bound to 1 for integer units and drop sub-unit ticks.
- **Explorer Count and Lines modes lost their y-axis label.** The rewrite's `chart.mjs:308` falls back to "Reported value" because the explorer passes no unit (`dashboard.mjs:308-331`). Pass `unit:'installations'`.
- **The Glean gap is not stated anywhere.** glean.json has `coverage.start` 2025-05-04 but records only from 2026-09-20; cards say "Observations: Sep 20, 2026 – Oct 11, 2026" and nothing explains the 16 missing months on Telemetry, OAuth, Platforms and Glean add-ons. Fix: render a coverage note from `coverage.start`, `pending` and the first observed week.

**Low**

- "Latest published" spending has no year (`funding-view.mjs:114`; financials.json key `spending` is undated; the old site hardcoded 2024). Have the pipeline publish the year and label it.
- Earlier update-request add-on estimates are labeled "Share of reporting clients (%)" and "Reporting clients: 9,028,436" (`dashboard.mjs:958-959`); those are installations.
- MAU lost the old "Glean begins May 4, 2025" plot line; the methodology change is only in meta text. Add an annotation option to `renderChart`.
- Explorer CSV share values carry 15 decimals; round to 4.

## Aesthetic suggestions

- Explorer legend lists 119 majors in version order with dozens of "0%" rows; add a "sort by share" toggle (not folding) so the top groups surface first.
- The hover tooltip now lists all series (119 rows, 353px) even unpinned. Keep the full list when pinned and let hover show a compact header plus "pin for all series".
- Funding compare uses hash-assigned year colors (two greens, two purples adjacent in the legend). Use an ordered sequential ramp with the most recent year darkest.
- Secondary cards stack three control rows (range, chart controls, legend tools) before the plot on mobile; collapse "Download SVG/CSV" into one menu.
- Y-axis labels for stacked shares read "Share of published categories (%)" while the explorer says "Share of selected population"; align the wording.

## Coverage matrix, unverified items, and sequence

| Family / source | Visual (post-rewrite unless noted) | Functional checks |
|---|---|---|
| Versions & channels: major, detailed, channels, custom presets, remainder | fable3-explore-pinned, fable4-explore-channels-window, pre-rewrite explore-*.png | tooltip/pin, keyboard arrows + End, table/CSV incl. hidden toggle, modes, ESR-families and legacy presets, channel action, SVG export |
| Daily + 7-day mean | daily-current (pre), fable3 data | tooltip, table, CSV, brush present |
| Monthly active | fable3-mau-bars | tooltip, modes, CSV |
| Glean metrics (all 13) | fable3-telemetry-accounts-*, -websearch, -filelink, -secure-read | tooltip, stacked shares, snapshot linear/log, shares in table/CSV, keyboard rows |
| Legacy scalar archive (9 probes) | fable3-telemetry-legacy-snapshot-log, telemetry-legacy-* (pre) | isolate via "Show only matching", log snapshot, date bounds |
| OAuth current: provider × 6 dimensions, accounts | fable3-oauth-result-percent, oauth-current-* (pre) | tooltip, percent mode, Other provider, Seznam/version |
| OAuth archive | oauth-legacy-* (pre), fable3 data | version dimension, tooltip |
| Add-ons: existing, Glean, update-request, legacy | fable3-addons-updates, addons-* (pre) | tooltip, CSV, table, sources |
| Platforms & languages current + legacy | fable3-platforms-lines-hidden, fable3-platforms-legacy | hide series, lines mode, table/CSV units, shares |
| Funding: compare, cumulative, timeline, annual, same-months, spending periods | fable3-funding-* (6 captures), mobile dark | tooltips, partial marking, tables, CSVs, month range, 2022/2023 spending |
| Support | support-current (pre), fable3 data | tooltip, modes |
| Mobile / dark | fable3-mobile-*, fable-mobile-* | pinned tooltip geometry, overflow, snapshot layout |

Not verified: dark theme on every tab after the rewrite (only funding and mobile captured post-rewrite); the Playwright browser suite was not run (JS unit tests pass, 31/31); SVG export rendering beyond file size; OAuth "withheld breakdown" empty state (no current data triggers it); Glean pending-week rendering (none pending); real touch hardware; screen-reader behavior beyond ARIA attributes; and no second collector pass arrived after 06:32.

Suggested implementation order:

1. Null for absent/suppressed labels and absent provider weeks (`dashboard.mjs:1125`, `:1056`).
2. Stop truncating legacy archives at archive_end (`dashboard.mjs:783/876/924`) and add the Glean coverage note.
3. Prerelease selector and Beta/Nightly presets in explorer-model.mjs; channel legend date default.
4. Chart polish in one pass: month-comparison ticks, linear curves for sparse series, annual presets, log lower bound, explorer unit label, mobile pinned panel.
5. Labels and data: spending year, update-request wording, MAU annotation, CSV rounding.
