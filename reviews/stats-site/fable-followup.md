# Fable 5.1 final code and visual follow-up

Reviewed 2026-10-13 using claude-fable-5-1 through Claude CLI.

**Verdict: no blocking findings.** All four final logs are green (Python 197 passed, lint clean, JS 0 failures, 10 browser specs passed), and every accepted finding from the first review is now implemented with a covering test. What remains is four low-severity items.

## Remaining findings (none blocking)

1. **LOW · `docs/media/js/dashboard.mjs:186-188` · A received share link is stripped from the address bar on first load.** The recipient's `restore` runs `cleanGroups`, which re-orders group keys (for example the default preset becomes `{id,name,color,latestEsr}` instead of `{id,name,latestEsr,color}`), and `setRange` recomputes preset dates. `save()` then sees `shared !== serialized` during the initial `refreshExplorer` and replaces the hash with `#explore` before any user edit. The view itself is applied correctly, but the recipient cannot re-copy or bookmark the link from the address bar, which is the "retain the original shareable URL until then" intent in the disposition. Fix: compare against a normalized serialization of the shared state captured in `readHash` (serialize after restore), or only clear on an actual user-driven state change.

2. **LOW · `docs/media/css/dashboard.css:216, 335 (and 1160)` · Two functional labels remain below the 12px floor.** `.stat-label` (the KPI headings "ACTIVE DAILY INSTALLATIONS") and `.eyebrow` are 10px bold letter-spaced. The eyebrows are arguably decorative; the KPI labels are not, since they name the number. `.art-label` at 10px is decorative and fine.

3. **LOW (visual) · `docs/media/js/chart.mjs:250-255` · Brush selection collapses at short ranges.** In `channel-explorer-dark.png` the 7-day selection over the full-history overview renders as a roughly 2px sliver with both handles overlapping at the far right. The brush is functional and the selected range is unambiguous from the date inputs, but the strip gives no visible affordance that it can be dragged wider. A minimum visual selection width or a highlighted handle would help. Optional: a 7-day rolling mean for the overview path only (not the data) would turn the nine-year sawtooth into a readable silhouette.

4. **LOW (documentation) · `docs/media/js/explorer-model.mjs:131, 283`** · Latest-ESR and ESR-family groups require a matching recorded `update_channel`, so for every date before 2026-10-05 they are empty and everything lands in the remainder. This is correct given the data and the generic "Recorded channel history begins…" warning covers it, but the preset labels in the group editor could say "requires recorded channel data" so users do not read the pre-October zeros as adoption.

Informational, not a defect: `glean.py:492-505` marks `pending_definitions` for any stored week whose metrics coverage lacks `observed/unobserved/unsupported` lists, so an older snapshot will re-query metrics for all weeks at eight per run. Newest weeks are prioritized and freshness only checks the latest week, so this is self-healing.

## Earlier findings now resolved

- **1 Historical ESR channel** · `releases.py:20-24` adds `update_channel` from the tagged build configs; model matches on it (`explorer-model.mjs:131, 283`); tests in `test_releases.py` and the JS "follows dated channel metadata" test.
- **2 Free-form Glean labels** · `glean.py:175-288` applies the 100-reporter floor using `label_clients`, folds unverifiable legacy labels, normalizes channels to the four public names plus `other`, coarsens versions to major, and filters rare add-on IDs. Both public paths sanitize (`website.py:64-66`, `browser_data.py:35-36`). Eight tests in `test_glean.py:381-470` plus `test_browser_data.py:61`.
- **3 Stale saved range** · `dashboard.mjs:1062-1070`; browser test "saved presets advance".
- **4 Navigator** · full-history overview with its own scale and `brush.move` restore (`chart.mjs:235-255`); browser test "navigator retains full history".
- **5 Compact totals** · `adi-totals.json` emitted and used for KPI, Daily and overview; browser test asserts no partition fetch.
- **6 Ingestion lag** · `latest_week` waits one completed UTC day; with the 04:00 UTC cron and `through = yesterday` (`pipeline.py:438`), Sunday is first collected on Tuesday. Tested at `test_glean.py:543`.
- **7 Schema evolution** · new definitions are added, retired ones kept as history, failed re-audits retained with a retry marker; `validation.py:110-114` now raises a clear error instead of `KeyError`. Five tests.
- **8 Add-ons default** · kept per instruction; selector now shows the real end date (`dashboard.mjs:830-833`) and Glean is a labeled alternative.
- **9 Colors** · `assignSeriesColors` max-distance allocation with reserved family colors; distinctness test. Confirmed visually, see below.
- **10 Dense metric charts** · `rankedDefinitions(records, 8)` with stacked counts for gauges (`dashboard.mjs:754-759`).
- **11, 19, 22** · retained per disposition; not re-raised.
- **12 Asset check** · `referenced_json` covers `json`/`fetch` literals and every manifest entry including totals; tests at `test_browser_data.py:39-58`.
- **13 CI browser job** · accepted per disposition.
- **14 Accessible name** · `aria-label="Customize groups"` at `index.html:139`.
- **15 Mobile tabs** · four-column wrapping grid at `dashboard.css:1125-1142`; all eight visible in both mobile screenshots.
- **16 Pressed state** · range presets carry `aria-pressed` (`dashboard.mjs:216`, `index.html:263-267`).
- **17 Other dominance** · last-30-day ranking (`explorer-model.mjs:251-260`); JS test "prefers recent observations". Other is now 4.3% on the legend date.
- **18 Percent export** · CSV and table include share columns and population; browser test.
- **20 Share hash** · cleared on later edits (tested), with the recipient-side caveat in finding 1.
- **21 Ticks** · three-tick floor with calendar-day filtering; mobile shows Apr/Jul/Oct.
- **Visual items** · 12px floor largely applied; third tile is now a link; helper text depends on grouping mode.

## Visual assessment

**Screenshots visually opened:** `light-desktop.png`, `dark-desktop.png`, `light-mobile.png`, `dark-mobile.png`, `channel-explorer-dark.png`, `telemetry-light-desktop.png` (all six).

- **Desktop, both themes.** The stacked chart is now legible: 157 orange, 156 pink, 155 green, 154 brown, 153 teal, 152 mauve, 140 violet, 128 blue, 115 slate, Other grey. No adjacent collisions. The navigator shows the full nine-year history with the six-month selection visible at the right. The third stat tile reads as a link rather than a missing number. Dark mode remains the stronger theme; light is clean.
- **Mobile, both themes.** No horizontal overflow, two-column stats, all eight tabs visible in two rows, icon-only Customize button with a label, three x-axis ticks, two-column legend. The 12px control text is noticeably more comfortable than before.
- **Channel explorer.** Seven real days, ESR 53.4%, Release 38.3%, Unknown 7.9%, daily ticks Oct 5 to Oct 11. The unclassified note is now a single calm line. Only the brush sliver (finding 3) detracts.
- **Telemetry.** Accounts as a stacked gauge count with five series and a caption naming the 9.97M reporting population and the Other fold. Public labels are the fixed product terms only.

I made no changes and did not start or stop any server.
