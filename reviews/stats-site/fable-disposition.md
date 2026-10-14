# Fable 5.1 review disposition

The independent review used the actual `claude-fable-5-1` model through Claude
CLI on October 13, 2026. It inspected code and all four desktop/mobile theme
screenshots. The complete report is in `fable-review.md`.

Implementation and verification are complete. `fable-followup.md` records
Fable's final code and visual review with no blocking findings.
`astra-post-fable-review.md` independently verifies the final implementation,
including the stable-color correction made while Fable's follow-up was running.

| Finding | Disposition |
| --- | --- |
| 1. Historical ESR update channel | Add dated `update_channel` metadata using tagged Thunderbird build configurations; use it for historical and pinned ESR rules. |
| 2. Free-form Glean labels | Suppress custom labels without at least 100 distinct reporting clients, preserve aggregate totals, normalize channels, coarsen version coverage, and sanitize both public build paths. Existing labels without reporter evidence are conservatively folded. |
| 3. Stale saved ranges | Recompute relative date presets against the latest manifest; retain explicit custom ranges. |
| 4. Navigator cannot zoom out | Give the navigator full-history daily totals, an independent scale, and a persistent brush selection. |
| 5. Totals load every full partition | Publish a compact `adi-totals.json`; use it for the headline, Daily tab, and overview. |
| 6. Warehouse ingestion lag | Leave a full completed day after the weekly endpoint before collection/freshness accepts that week. |
| 7. Metric-definition evolution | Add new definitions without discarding retired metric history; report missing historical metrics explicitly. |
| 8. Stale add-on default | Keep the existing source as expressly requested when Glean is not equivalent. Show its actual end date in the selector and retain a separately labeled Glean option. Switching automatically would contradict both the user requirement and Astra's source-equivalence finding. |
| 9. Adjacent colors | Assign deterministic colors from series identity, with golden-angle spacing for numeric majors, fixed family/channel colors, and neutral remainders. Astra caught a set-dependent allocation regression; the final implementation and regression test keep colors stable across filters, dates, order, and reloads. |
| 10. Dense metric charts | Share top-category/remainder logic with dimensions; show up to eight named metric categories, use stacked counts for gauges, and lines for counters. No logarithmic mode is added to this draft. |
| 11. Weekend headline variation | Retain the latest daily observation and its explicit date. A weekday-only figure or rolling mean would change the metric; the Daily tab exposes the full weekly pattern. |
| 12. Static asset validation | Validate literal `json`/`fetch` dependencies and every manifest reference, including dynamically selected partitions. Reuse dependency discovery in browser fixtures. |
| 13. Browser checks in CI | Already addressed during the initial review: CI installs Chromium and runs browser tests in addition to JS/Python checks. |
| 14–16. Mobile names, tabs, range state | Add an explicit Customize groups accessible name, make all tabs visible in a wrapping mobile grid, and set pressed states for presets. |
| 17. Excessive Other on recent dates | Rank default capped series using recent observations, keeping all older data in the exact remainder and searchable inventory. |
| 18. Percent export | Include counts, percentages, and the selected population in share-mode tables and CSV. |
| 19. Add-on requests have no channel | Retain Unclassified as a true missing-channel category. ATN is a source, not a release channel; creating a fictitious channel would misstate the data. Explain that add-on requests contribute to this category. |
| 20. Shared state overrides later edits | Clear the shared-state query when the local configuration changes, while retaining the original shareable URL until then. |
| 21. Mobile tick density | Use readable calendar ticks with at least three labels where possible and no subdaily precision for daily data. |
| 22. Old assets | Preserve legacy assets for existing pages and external links during this draft. The redesigned main page does not load Highcharts, jQuery, or DataTables. Removal is a separate compatibility cleanup. |

Additional visual refinements raise control/caption text to 12px, turn the third
hero tile into an explicit link to the channel explorer, and make the helper
text depend on the selected grouping mode.

## Final follow-up

Fable's four remaining findings were low severity. The recipient-side share
link bug was fixed using a normalized baseline and a guard against restoring
the same hash twice. Tests now retain the exact received URL through reload,
advance relative preset dates, and clear the hash only after an edit. KPI labels
are 12px in both layouts; decorative overlines retain their smaller type. The
group editor explicitly says ESR presets require recorded channel observations.

A seven-day selection is still physically narrow on the nine-year navigator.
The actual date extent is preserved rather than enlarged misleadingly; explicit
date controls and presets remain available. This is recorded as nonblocking
visual polish for a future navigator design.

Final validation: 198 Python tests and eight subtests, 18 JavaScript tests,
11 Chromium integration tests, and Ruff all pass. Both named reviewers actually
opened desktop/mobile screenshots in both themes and reviewed the code.
