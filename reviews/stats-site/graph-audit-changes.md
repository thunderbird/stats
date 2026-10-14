# Graph audit corrections — October 13, 2026

Requested scope: all graph families, aesthetics and functionality, reviewed by Claude Fable 5.1. The original evidence is in `build/review/graph-audit/`; post-change evidence is in `build/review/graph-audit-after/`.

## Implemented

- Restored donation comparisons as independent, translucent yearly areas on a January–December axis. Lines and grouped bars remain selectable. Added cumulative and chronological views, month-range selection, distinct stable year colors, and month-only tables/CSV.
- Preserved explicit published annual totals. Derived incomplete totals carry partial-period markings and a visible explanation. The same-reported-months option compares equal periods and excludes years lacking those monthly observations.
- Added chart-style choices to secondary time charts. Category metrics expose history or a ranked snapshot, selectable observation, linear/log scales, and every published category. Zero and missing values remain distinct; long rankings disclose their count and scrolling/keyboard controls.
- Retained all published categories individually. Explained publication aggregates without pretending the UI can reconstruct suppressed labels or weakening the collection's publication rules.
- Fixed the Daily Installations legend's first-click behavior. The seven-day average, headline and original daily data remain intact.
- Restored earlier add-on update-request history as a separate source and chart. Existing telemetry and Glean sources remain separate populations.
- Added complete, pinnable, scrollable time-chart details, tiny-percentage formatting, explicit units and appropriate reporting-client denominators. Added SVG exports and explicit hidden-series inclusion for tables/CSV.
- Added a shortcut to the recorded channel-coverage interval. Channel-dependent comparisons clearly disclose dates without recorded channels.

## Source and deployment boundaries

This correction changes static rendering and its tests. It does not refresh or modify the financial, Glean, add-on, ADI, MAU or support datasets; infer unknown channels; publish private labels; or deploy the site. The existing static preview and downloadable archive are rebuilt after verification.

## Validation

- 35 JavaScript model tests pass.
- 33 Chromium integration tests pass, including graph-control, missing-observation and historical build-preset regressions.
- 8 static-preview Python tests pass.
- Post-change screenshots cover every tab, light/dark themes, desktop/320px mobile, and new comparison modes; 48 captured states have no runtime errors or horizontal overflow. Four additional funding captures verify the corrected palette.

Independent Fable review and follow-up findings are recorded separately alongside this file.

## Corrections from Fable's completed all-graphs review

The completed review is `fable-all-graphs-review.md`. Its substantive findings led to further corrections: missing/suppressed labels and absent provider records remain null, explicit published zeros remain zero, leading/trailing missing weeks stay inside selectable date ranges, historical Beta/Nightly build-label presets work without inventing recorded channels, month-comparison ticks are monthly, sparse-series interpolation is linear, annual presets use years, mobile pinned details flow below the plot, integer logarithmic axes exclude sub-unit ticks, channel legends default to an available recorded date, and Glean history gaps are disclosed. MAU includes its methodology-change annotation; update-request estimates use installation terminology; explorer CSV shares round to four decimals.

The suggestion to extend the legacy archive past May 2025 was intentionally not applied: the user explicitly requested the May 2025 cutoff, and the complete source files remain retained. The missing-publication fixes do not remove privacy thresholds or infer suppressed categories. Year colors remain distinct rather than changing to a sequential ramp, because these are independently selectable categorical year series.

The final screenshot pass also identified crowded date labels. Calendar ticks are now thinned to the available width, and annual funding uses year ticks. Missing segments do not erase other valid segments of a stacked chart; count and percentage regressions cover this explicitly. Build-suffix presets expose historical prerelease labels, but cannot recover Beta or Nightly identities absent from the published version strings; recorded-channel comparisons remain a separate, coverage-limited view.

## Final independent verification

Claude Fable 5.1's final scoped verification found no remaining material issue in the corrected state. Its report is `fable-all-graphs-final-verification.md`. It inspected the final images and source and independently probed sparse telemetry stacks, OAuth provider selection, Beta/Nightly presets and logarithmic snapshots. Its optional suggestions concern hidden empty coverage-note nodes and repeated partial-year reminders; neither changes displayed data or blocks use. The fresh screenshot pass was repeated after date-axis spacing was corrected.

The broader follow-up report (`fable-all-graphs-followup.md`) also found no material defect and independently reran the 35 model and 32 browser tests. Two low-severity improvements were accepted: a prominent warning that Beta suffix groups are not total Beta channel usage, and visible chart titles/series legends in standalone time-chart SVG exports. The source's inability to enumerate labels inside a publication aggregate remains an explicit data limit, not a renderer defect.

The two accepted low-severity follow-up fixes are complete. Beta suffix groups now display their coverage limitation prominently, including an explicit warning when no b-suffixed versions occur in the selected dates. Time-chart SVG exports include a visible title and every visible series in a wrapping legend; hidden series are excluded, and standalone export preserves plot/clip geometry. A 320px browser regression covers long labels and 14 visible series. The final real-data donation export was rendered and visually inspected in `build/review/graph-audit-final/funding-export.png`. Final checks: 35 JavaScript tests, 33 Chromium tests and 8 preview Python tests pass.
