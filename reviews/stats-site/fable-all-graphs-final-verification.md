# Claude Fable 5.1: final-verification

**Result: no remaining material issue in this scoped verification.** Everything I could independently check matches the correction log, and no probe raised a runtime error or warning.

**What I checked**

- Read the correction log and the final `checks.json`. It records no issues, no horizontal overflow across all eight captured states, and the expected ticks, notes, date fields, annotation and mobile tooltip placement.
- Inspected the six named final images. Funding default dark shows independent overlaid yearly areas, a Jan to Dec axis, and year-only ticks on the annual chart with a dashed partial 2026 bar. The Oct to Dec capture shows exactly three monthly ticks. The 5Y preset shows 2021 to 2026 year ticks. The sparse telemetry capture shows owl-graph starting at Sep 27 with a gap at Sep 20, exchange as an explicit zero line with markers, and the table printing a dash for the absent week and 0 for the published zero. MAU shows the May 4, 2025 annotation and the matching footnote. The 320px capture shows pinned details in normal flow below the plot and above the legend.
- Spot-checked source. In chart.mjs the tick count is capped by plot width, calendar intervals are thinned by stride, month and year tick intervals are explicit, the curve defaults to linear, and line and area generators use defined() so only missing segments break while stacked baselines continue for other series. In breakdown.mjs the integer log axis floors at 1 and drops sub-unit ticks, and zero values get a separate baseline mark. In explorer-model.mjs the Beta and Nightly presets are described as suffix-based and independent of the recorded channel. In dashboard.mjs absent providers return null unless the record is an explicit published zero, CSV shares round to four decimals, and the Glean coverage note and legacy May 2025 cutoff label are present. The undated spending option says year not supplied.
- Ran four fresh browser probes against the live preview with the script saved at build/review/graph-audit-final/verify-probe.mjs:
  1. Telemetry accounts in stacked count mode on the full sparse range. Ticks were daily-spaced and legible, 21 stacked paths rendered, and the stack geometry continued across the week where owl-graph is missing.
  2. OAuth provider selection. The provider list includes the publication aggregate as its own entry, the selected provider rendered weekly counts, and the Glean coverage note appeared.
  3. Beta/Nightly preset. Legend reads Beta builds, Nightly builds, Everything else with shares, and the only warning is the honest unclassified-channel note. No claim of recovered channels.
  4. Snapshot view on log scale. Axis starts at the decade of the smallest positive value, no sub-unit ticks, one zero baseline mark, and the scroll and keyboard disclosure for 21 categories is shown.

**Optional polish, not blocking**

- The OAuth coverage-note list returned three empty strings alongside the real note, which suggests hidden empty note containers in the DOM. They are not visible and cause no layout effect.
- The funding partial-year banner appears twice on the same page in near-identical wording, once per card. Acceptable, but it could be shortened on the monthly card.

**Limits**

- I did not re-run the JS, Chromium or Python suites. I relied on the stated passing results plus my own probes.
- The OAuth probe landed on a provider with full weekly data, so the null-versus-explicit-zero path was verified from source and the unit test description, not visually.
- I did not revisit earlier audit screenshots or probe results, per scope, and did not review archive tabs beyond confirming the legacy cutoff label.
