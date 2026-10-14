# GPT 6 Astra follow-up code and visual review

Reviewed 2026-10-13 against the updated source and `http://127.0.0.1:8877`.

**Disposition: the four original findings are resolved. No remaining blocking defect was found in the targeted follow-up.** Both code and rendered visuals were reviewed again. Two edge defects in the new version-promotion interaction were found during this follow-up, reported, fixed, and independently retested before this disposition.

**Original findings and verification**

- **Add-on source equivalence:** closed. The default Add-ons view stays on existing telemetry even when a fixture supplies Glean records. Glean is an explicit, separately labeled selector option. Its legend says “Excluding Glean's weekly top 10”, and its footer displays the supplied comparison statement explaining that the ranking is not ATN's. The real preview currently has no Glean add-on records and shows a proper unavailable state when explicitly selected; the positive Glean path was tested with a controlled fixture.
- **Missing Glean weeks:** closed for gaps within the displayed observation range. `basicSeries` fills a seven-day cadence with null observations, and the affected weekly callers use it. Repeating the original September 20 / October 4 fixture now yields `M60,110.333ZM1182,27Z`, rather than a continuous line. Keyboard inspection of September 27 says “No observation for this date”. The automated regression checks the split path too. Leading/trailing collection backlog is represented by the explicit observed-date range, rather than extrapolated as data.
- **Search outside the initial version cap:** closed. Search uses the full recorded version inventory and offers exact-version Compare actions. The initial readable chart cap remains. On real data, `115.0` can now be found and selected. A follow-up initially found that appending it after the broad “115 and below” rule produced zeros; the corrected action now places it first. The independent retest measured **767,080** summed observations and a daily maximum of **5,861** for the promoted exact series, with every displayed daily total still conserved.
- **Mobile Include versions width:** closed. The field explicitly spans columns 2 through the end. At a 375 px viewport it is now **275 px wide**, compared with 35.59 px in the initial review. Light and dark editor screenshots were captured and actually inspected; the text field is readable and usable.

**Follow-up defects resolved during this pass**

The version-promotion handler initially (a) appended exact selections behind overlapping broad rules and (b) changed stored groups without refreshing an already open editor. The final handler in `docs/media/js/dashboard.mjs` prepends the exact group, refreshes the open editor, and includes a group-count guard. The real-data retest showed four matching editor rows, beginning with `115.0` and an `=115.0` selector. A new browser regression exercises broad-preset promotion and checks a nonzero 65.0% exact share.

**Additional improvements verified**

The single-date chart now has one calendar-date tick instead of invented hourly ticks. The ESR-family and selected-version presets are present, the editor exposes channel exclusions, and historical platform/language cards use legacy methodology wording. The channel-only legacy-data case is covered by the passing JS model suite and remains missing when no channel data can establish a value.

**Visual review evidence**

Actually opened and inspected the populated real-data screenshots `telemetry-light-desktop.png` and `platforms-light-desktop.png`. Also captured and inspected `astra-fixed-editor-light.png`, `astra-fixed-editor-dark.png`, and `astra-glean-dark-mobile.png`. The Glean views preserve the dashboard's visual hierarchy and remain within the mobile viewport. The current one-week observations appear as points; no continuous history is invented. The large account-type legend remains dense, as noted in the initial review, but this is a nonblocking readability improvement rather than a new data defect.

**Checks run**

- `npm run test:unit`: **13 passed**.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/ec2-user/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome npm run test:browser`: **6 passed** after the final promotion fix. Log: `build/review/astra-followup-browser.log`.
- Independent Playwright scenarios repeated the add-on source gate, missing-week path/keyboard inspection, single-date ticks, full-inventory version search, broad-rule promotion, editor consistency, exact daily total conservation, and mobile input measurement. No browser page errors were observed in the real-data interaction check.

The first plain `npm run test:browser` attempt could not launch because its default bundled Chromium was absent in this environment. Re-running with the installed Chromium path supported by the project's config passed; this was an environment setup issue, not a product failure.

This targeted follow-up does not certify unfinished warehouse backfill or new collection results arriving after the reviewed snapshot. It verifies the frontend's behavior against the currently published real Glean observation and deterministic fixtures, alongside the prior independent pipeline/code review.
