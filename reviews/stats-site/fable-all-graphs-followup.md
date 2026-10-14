# Claude Fable 5.1: follow-up

Review is complete. No further tool calls are needed.

## Final independent review: graph corrections (state as of 06:51 UTC, Oct 13)

**Important context.** The sources changed while I reviewed. The six JavaScript files were rewritten at 06:46–06:49 to apply the findings of the parallel all-graphs audit, and the preview build is byte-identical to the source tree. All findings below are against that latest build, verified live. Several screenshots in the evidence folder predate it, so I treated them as indicative only.

**Verdict.** No material defects remain in the graph families I checked. The user's hard requirements hold: donation years are independent translucent areas with lines and bars optional, eight distinct year colours, Jan–Dec axis, no category is folded into Other by the UI, no automatic top-N cap, and publication suppression is disclosed rather than reconstructed. Three low-severity items are worth fixing.

### Independent verification performed

- **Test suites, run by me:** 35 unit tests pass, 32 Chromium integration tests pass. Python preview tests not rerun.
- **Four live Playwright probes** (scripts and JSON results in build/review/graph-audit-after/probe-fable*.mjs and probe-fable-*-results.json; five new screenshots prefixed probe-). Zero page errors across all runs.
- **Funding:** default view area/monthly/compare with 8 series and the eight colours in final-funding-check.json; tooltip hover, click-to-pin (role dialog, close button), arrow-key date stepping, Escape; bars mode (87 bars); month ranges Mar–Jun, Jan–Mar, Oct–Dec and Jan–Dec all tick once per month; cumulative CSV stops at the first unreported month (2026 April blank); annual CSV preserves published 2017/2018 totals and 2026 bar is marked partial; same-months comparison excludes 2017/2018 and 2026 Jan–Mar equals its cumulative March; timeline view spans 2019-01 to 2026-03; annual presets are now 5Y/10Y/All with year ticks.
- **Daily:** y-axis reads "installations"; first legend click hides only the daily series; table and CSV honour the hidden-series checkbox; moving average present.
- **MAU and support:** units correct; Glean annotation drawn and described.
- **Telemetry:** 21-category snapshot with count/scroll cue, keyboard ArrowDown scrolls viewport and moves tooltip, log scale draws zero as a baseline mark, legacy log axis starts at 1; percent tooltip lists all 21 series with "<0.1%" and an explicit "0%"; suppressed labels now show "Not published" in tooltips, "Unavailable" in snapshot, and remain gaps in the series.
- **OAuth:** current and archived sources, provider and version dimensions, Other labels, legacy versions.
- **Add-ons:** default is existing telemetry; update-request source now labelled "Share of estimated installations" with "Estimated installations" in the tooltip; Glean source separate.
- **Explorer:** tiny shares render as "<0.1%"; channel-coverage button appears only for channel-dependent views and sets Oct 5–11; channel legend now defaults to Oct 11; Count mode y-label "Active daily installations".
- **SVG export:** rendered standalone in a clean page; colours and fonts resolve (no unresolved CSS variables).
- **Mobile 320px:** no horizontal overflow on funding, telemetry, explorer; pinned details now flow below the plot.

### Remaining findings

**1. Beta builds preset is effectively empty across all history (low, labelling).** The preset at `docs/media/js/explorer-model.mjs:142` matches `stage:beta`, but published ADI version strings almost never carry a "b" suffix. Beta-suffixed versions appear on only 13 days in 2025 and 9 in 2026, totalling 88 requests, while recorded channels show Beta at 0.3% (12,144 requests on Oct 11). Live result: "Beta builds 0%, Everything else 100%". The group `description` explaining this is dropped by `cleanGroups` (`dashboard.mjs:136`) and never shown. Fix: surface that description as a chart warning when the preset is applied, or drop the Beta-only option and keep "Nightly builds", which does carry real data.

**2. Exported SVGs have no legend or series names (low, polish).** `chart.mjs:404` serialises only the plot; the standalone render of the funding comparison shows eight unlabelled coloured areas. Same for breakdown SVGs, which do carry row labels, so this mainly affects multi-series time charts. Fix: append a simple legend group using series names and colours, and the card title.

**3. Suppressed-label note appears only when a label is missing (low, consistency).** For Web searches, "yahoo" is published for one week and "Not published separately" for the others, which is correct. But Other (publication aggregate) still shows a positive value every week with no indication which labels it absorbed; that is a data-policy limit and is stated in the meta text, so this is informational only.

### Optional polish

- Explorer warning "Recorded channel history begins Oct 5, 2026" is shown even in Major-versions grouping where channels are irrelevant (`dashboard.mjs:352`).
- Breakdown hover tooltip on 320px overlaps the next two rows (probe-mobile-telemetry-snapshot.png).
- Annual tooltip header reads "Jan 1, 2022" for a yearly total; the note clarifies but a year-only header would be cleaner.

### Coverage limitations

Dark theme verified only from the final funding captures plus code (theme-independent). Touch hardware, screen readers and the OAuth withheld-breakdown empty state not exercised. The preview Python tests were not rerun. Because the implementation moved during the review, any edits after 06:49 UTC are outside this verification.
