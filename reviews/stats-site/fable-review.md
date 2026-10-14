# Fable 5.1 independent code and visual review

Reviewed 2026-10-13 using Claude CLI, model claude-fable-5-1 (requested alias `fable`). Free-form source-label examples are redacted from this retained report.

Review complete. I inspected all four screenshots (light-desktop, dark-desktop, light-mobile, dark-mobile) and the current working-tree code. Note that `dashboard.mjs`, `validation.py`, `pipeline.py` and `browser_data.py` changed while I was reviewing, so I re-read them and the findings below refer to the versions on disk at the end of the review.

## Findings (descending severity)

**1. HIGH. Latest-ESR groups exclude every pre-128 ESR install.**
`docs/media/js/explorer-model.mjs:105`, `:255`, and the `esr-families` preset at `:118` hard-require `channel === 'esr'`. The ADI channel data shows that 115.x, 102.x, 91.x and 78.x installs report channel `release` (the `esr` channel name only exists from 128 onward). Once the channel backfill lands, "Latest ESR family", "Latest ESR patch" and "ESR version families" will be zero for all history before July 2024, and the "115 vs 128" transition will be invisible. Fix: carry the update channel name in the dated release metadata (`stats_pipeline/releases.py:34`: add `"update_channel": "release" if major < 128 else "esr"`), keep `channel: "esr"` for identity, and in the model match `item.channel === latest.update_channel`. This stays within the plan's rule because it comes from dated release metadata, not from ADI versions. Update `tests/js/explorer-model.test.mjs:47` accordingly.

**2. HIGH. Glean publishes free-form, low-count labels on a public site.**
`stats_pipeline/glean_sql.py:158-170` and `stats_pipeline/glean.py:173-202` emit every label with its total, with no minimum population. The current `glean.json` already contains search-engine names typed by users ("[custom label redacted]"), Filelink add-on IDs carrying company domains and internal hostnames with 1 to 5 reporting clients, calendar provider IDs, free-form `app_channel` strings in `coverage.channels` ("[custom label redacted]", "[custom label redacted]") and custom-build version strings in `coverage.versions`. Fix: in `metric_records` fold any label with fewer than N distinct clients (100 is a reasonable floor) into `__other__` before publishing; normalize `coverage.channels` to the known channel set plus `other`; apply the same floor to `coverage.versions`. Do this in Python so the SQL stays simple, and add a test.

**3. MEDIUM. Returning visitors are stuck on a stale date range.**
`docs/media/js/dashboard.mjs:1027-1034` only recomputes the range when the saved dates fall outside the manifest. A user who visited yesterday with the 6M preset keeps yesterday's `endDate` forever, so the explorer silently lags the "Data through" label. Fix: if `state.range !== 'custom'`, always call `setRange(state.range)`; only keep saved dates for `custom`.

**4. MEDIUM. The navigator strip is a copy of the visible range and only zooms in.**
`docs/media/js/chart.mjs:207-221` builds the navigator from the same `rows` and `x` scale as the main plot and never calls `brush.move`, so after a brush the selection vanishes and the strip shows just the new range. It cannot zoom out and the purple sawtooth under the chart (visible in all four screenshots) adds noise without information. Fix: accept an `overview` option with full-history daily totals and its own x scale, draw the brush on that, and restore the selection to the current start and end on each redraw.

**5. MEDIUM. Full ADI partitions are loaded for views that need only totals.**
The Daily tab (`dashboard.mjs:621`) fetches all nine year files, and the KPI (`dashboard.mjs:1037`) fetches the current year file just to read one count. Together that is the same 12 MB the plan set out to avoid. Fix: emit `data/adi-totals.json` ({date: count}, roughly 60 KB) from `stats_pipeline/browser_data.py` and use it for the KPI, the Daily tab and the navigator overview in finding 4.

**6. MEDIUM. Glean week may be queried before its last day is complete.**
`process.yml:4` runs at 04:00 UTC daily; `glean.py:128` treats the week ending yesterday as complete, and completed weeks are never re-queried. If the stable `thunderbird_desktop.*` tables for Sunday are not yet fully copied at 04:00 Monday, the last day is undercounted and frozen. Verify the ETL timing; if there is any risk, require `through >= sunday + 1 day` in `latest_week` and `check_freshness`, or re-query the most recent week once on the following run.

**7. MEDIUM. Metric definition changes break the Glean component permanently.**
`glean.py:281` requires the stored metric set to equal `METRICS`, and `collect` validates the existing baseline at `:315` before any merge. Adding or removing a metric makes every subsequent run fail. Related: `stats_pipeline/validation.py:108-110` raises `KeyError` instead of a clear error when a baseline metric is missing from the current set. Fix: in `collect`, `setdefault` any new `METRICS` keys with empty records before validating, and make `validate` accept stored metrics that are a superset of the definitions (keeping history).

**8. MEDIUM. Add-ons defaults to a source that stopped in July 2025.**
`addon_stats.json` ends on 2025-07-06, yet `dashboard.mjs:598` labels it "Current · existing telemetry" and makes it the default, while Glean add-on data for the latest week is hidden behind the selector. Fix: default to Glean when `glean.addons.records` is non-empty, label the legacy series with its real end date, and keep the source-boundary note.

**9. MEDIUM. Adjacent stacked bands are the same colour.**
`explorer-model.mjs:23-32` hashes ids into a 12-colour palette; 140, 149 and 152 all land on near-identical violets and sit next to each other in the stack. In every screenshot the middle of the chart is one indistinguishable purple mass, and the top three bands (115 slate, 128 blue, Other grey) are also muddled. Fix: assign non-family colours by series rank from a palette ordered for maximum separation, skipping colours already used by family entries; keep Other/Unclassified grey.

**10. MEDIUM. Glean metric charts draw 30 to 40 raw lines on a linear axis.**
`dashboard.mjs:722-730` makes one line per label with no cap, so Accounts plots `imap` at 17 million next to labels at 1, and the legend has 30+ chips. Fix: reuse the top-N plus Other logic from `dimensionCard` (top 8), choose a per-kind default (gauges stacked counts, counters lines), and consider a log toggle.

**11. MEDIUM. Hero KPI swings by half depending on the weekday.**
`dashboard.mjs:1037-1042` shows the latest day. The screenshots show 5.12M for Saturday Oct 10, while weekday channel totals are about 10.2M. Fix: show the latest weekday value or a trailing 7-day mean, and say so in the caption.

**12. MEDIUM. Static-build asset check no longer covers the new code.**
`stats_pipeline/website.py:51-54` only matches `getJSON(`, which the new modules never use, so missing `data/*.json` or `thunderbird_ami.json` would pass the build. `tests/browser/serve.py:16-17` has the same dead regex. Fix: match `(getJSON|json|fetch)\(` with quoted `.json` paths, and assert that every file named in `data/index.json` exists.

**13. MEDIUM. Browser tests are not run in CI.**
`.github/workflows/test.yml` runs only `test:unit`. The keyboard, reduced-motion, mobile and archive-cutoff checks live solely in `tests/browser/dashboard.spec.mjs`. Fix: add a job that installs Chromium and runs `npm run test:browser`.

**14. MEDIUM (a11y). "Customize groups" loses its accessible name on mobile.**
`docs/media/css/dashboard.css:1161-1167` sets `font-size: 0` on the button text, and the only remaining content is an `aria-hidden` glyph (`index.html:137-143`). Fix: add `aria-label="Customize groups"` or wrap the text in `.sr-only` instead of zeroing the font.

**15. MEDIUM (mobile). Tabs overflow with no affordance.**
In both mobile screenshots the nav shows three tabs and the other five are off-screen with no fade or wrap. Fix: wrap to two rows below 760px, or add an edge fade plus scroll-snap.

**16. LOW. Range presets lack pressed state.** `dashboard.mjs:207-209` toggles only a class; add `aria-pressed` like the mode buttons.

**17. LOW. "Other versions" dominates the latest date.** `explorer-model.mjs:228-233` ranks by total weight over the whole window, so the legend date shows Other at 35%. Weight by the last 30 days or by the legend date.

**18. LOW. Exports drop percentages.** `dashboard.mjs:364-411` exports and tabulates counts only, even in Share mode. Add percent columns and the population when mode is percent.

**19. LOW. Structural "Unclassified" population.** `stats_pipeline/cloudfront.py:150-156` folds add-on update requests (about 7% of ADI) into `unknown`, so the "no recorded channel" warning will appear forever. Record them as a distinct `atn` bucket so the UI can label "Add-on requests (no channel)" and users can exclude them deliberately.

**20. LOW. Shared-state hash goes stale.** After `#share` (`dashboard.mjs:1161-1171`) the hash keeps `?state=`; later edits are lost on reload because the hash restores after localStorage. Clear the query on the next state change.

**21. LOW. Mobile x-axis has two ticks.** `chart.mjs:166` yields two ticks at 390px for a six-month range. Use a floor of three with short month labels.

**22. LOW. Dead legacy assets.** `docs/media/js/stats.js`, Highcharts, jQuery and DataTables are still shipped but unused by `index.html`. Remove the scripts (keep the legacy JSON for external consumers).

## Visual critique

- **Both themes read as one system** and match the reference page's violet gradients and restrained borders. Dark mode is the stronger of the two; the light hero and stats strip are clean.
- **The chart itself is the weak point.** Colour collisions (finding 9), a decorative navigator (finding 4) and a 35% Other band make the default view hard to read. Fixing 9 alone would change the first impression more than anything else.
- **Type is too small.** Many controls, captions and legend values are 9 to 11px on a 14px body. Raise the floor to 12px; the reference site is noticeably more generous.
- **The third stat tile is decorative text styled as a KPI** ("ESR · Release · Beta · Nightly") and reads as a missing number. Replace with a real figure such as latest-ESR share, or style it as a link.
- **Mobile layouts hold together**: two-column stats, stacked controls, two-column legend and the hidden hero art all work. Icon-only actions need the accessible name fix (finding 14).
- **The empty-channel warning sits in a prominent band** under the chart; once channel history is backfilled it should become a quieter footnote tied to the channel-start date.

## What I inspected

- Plan: `STATS_SITE_REDESIGN_PLAN.md`; notes: `GLEAN_DATA_NOTES.md`.
- Diff of `.github/workflows/*`, `package.json`, `stats_pipeline/{aus_sql,cloudfront,pipeline,validation,website}.py`, `docs/index.html`.
- New: `stats_pipeline/{browser_data,channels,glean,glean_sql,releases}.py`, `docs/media/js/{dashboard,chart,explorer-model}.mjs`, `docs/media/css/dashboard.css`, `tests/js/explorer-model.test.mjs`, `tests/browser/{dashboard.spec.mjs,serve.py}`, `playwright.config.mjs`, `tests/test_channels.py` (signatures).
- Data in the preview build: `data/index.json`, `data/releases.json`, `data/glean.json`, the ADI channel buckets and coverage for channel days, and the date ranges of the legacy `addon_stats.json` and `platforms.json`.
- Screenshots: `build/review/light-desktop.png`, `dark-desktop.png`, `light-mobile.png`, `dark-mobile.png`, all four viewed.

I made no changes and did not deploy anything.
