# Stats site accessibility review — October 14, 2026

## Scope and method

Target: WCAG 2.2 Level AA. This is an engineering review of the current rewrite and local published-data preview, not a conformance certification.

Guidance consulted before changes:

- [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/).
- [W3C WCAG-EM evaluation methodology](https://www.w3.org/WAI/test-evaluate/conformance/wcag-em/): establish scope, identify representative functionality and states, test, and record limitations.
- [W3C complex-image guidance](https://www.w3.org/WAI/tutorials/images/complex/): charts need useful text alternatives, including detailed data.
- [WAI-ARIA authoring principles](https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/) and [disclosure navigation](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/): preserve native semantics and support the keyboard behavior a role promises.
- [W3C status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) and [Playwright accessibility testing](https://playwright.dev/docs/accessibility-testing).
- [W3C technique G209](https://www.w3.org/WAI/WCAG21/Techniques/general/G209): contrasting boundaries, including paired black-and-white strokes, for adjoining graph colors.

The review combines axe-core scans, source inspection, Chromium accessibility-tree inspection, keyboard interactions, responsive checks, text-spacing overrides, contrast measurements, and before/after screenshots. It covers Daily Versions & Channels, Daily Active, Monthly Active, Telemetry, OAuth Providers, Add-Ons, Platforms & Languages, Funding, and Support. Additional states include the custom-group editor, expanded data tables, snapshot charts, pinned chart details, and historical platform data.

## Implemented without changing the visible design

### Names, structure and text alternatives

- `docs/index.html` and `docs/media/js/dashboard.mjs`: chart articles have associated heading names; data tables have visually hidden captions with chart, period, and unit context. Their horizontal scrolling regions are keyboard focusable and named. Table disclosures identify which chart they describe.
- `docs/media/js/chart.mjs` and `docs/media/js/breakdown.mjs`: chart names and descriptions are separate. Descriptions remain available after inspecting or closing details. Time-chart instructions include the date range, visible-series count, keyboard shortcuts, and the existing table alternative. Charts reference their matching data disclosure with `aria-details`; standalone SVG exports remove that external reference.
- Corrected the editor's accessible heading level and removed misleading heading semantics from sidebar category labels, retaining their existing appearance and disclosure buttons.
- Explorer legend controls expose the selected date, value and visibility through accessible descriptions, without changing their visible names or formatting.
- Accessible copy/download labels retain the visible button wording. External links that open a new tab disclose that behavior to assistive technology.
- Browser document titles identify the active report and telemetry metric.

### Keyboard interaction and focus

- The skip link focuses the main content without accidentally routing secondary reports back to Versions & Channels.
- Report navigation initiated from the sidebar moves focus into the selected content; existing direct telemetry links keep their specific chart destination.
- Opening/closing the custom-group editor and adding, moving, removing or rebuilding group controls preserve a useful keyboard focus destination. Focus is allowed to scroll into view. Escape closes the editor and returns to its trigger.
- Ignoring repeated, identical group-field changes prevents a delayed blur event from changing the grouping and moving controls during a reset click. This also resolves the previously failing reset regression.

### Dynamic updates and validation

- A permanently present, visually hidden status region announces messages even when the corresponding visible notice/toast was previously hidden.
- Secondary loading containers expose `aria-busy`; report loading, chart-style and grouping changes, legend actions and searches, and funding controls announce their results.
- Existing date-range error messages are associated with their inputs, which expose `aria-invalid` and clear it after correction.
- Keyboard chart readings include partial-period notes and the displayed population total.

No datasets, grouping calculations, chart palette, font sizes, spacing, or visible copy/layout were redesigned. One broken reference to a nonexistent custom-group datalist was removed; it had no functioning suggestion UI.

## Validation and evidence

- 28 real-data audit states: 14 states in both light and dark themes. After the changes, no violations were reported by the selected WCAG A/AA or axe best-practice rules.
- Four additional axe scans at 320 CSS pixels reported no violations.
- 24 responsive checks: all eight report routes at widths of 320, 375 and 640 CSS pixels, without page-level horizontal overflow. Four representative pages also passed the overflow check with WCAG text-spacing overrides. Scrolling wide data tables remains intentional.
- Six full-page before/after screenshots — Versions & Channels, Platforms, and Funding in light and dark themes — are pixel-identical.
- The browser regression suite includes new tests for report structure, ARIA reference targets, skip/navigation focus, persistent chart instructions, named and focusable tables, group-editor focus, date validation, legend descriptions, and dynamic status messages.
- JavaScript model/unit suite: 46 tests passed.
- Final complete Chromium browser suite: 91 tests passed, including 17 accessibility-specific tests and the formerly failing legend-reset regression. The static preview rebuilt successfully.

Local detailed evidence: `build/accessibility-before/`, `build/accessibility-after/`, `build/accessibility-reflow.json`, `build/accessibility-manual-evidence.json`, and the `build/accessibility-*.log` files. Reusable regression tests are in `tests/browser/accessibility.spec.mjs`, using `@axe-core/playwright` as a development dependency.

## Approved contrast and keyboard updates

The user approved chart contrast improvements and keyboard-only focus outlines after the initial review.

- `docs/media/js/chart-contrast.mjs` computes WCAG sRGB contrast and chooses black or white boundary ink for composited fills. `chart.mjs` adds paired boundaries to area bands and a halo to lines below 3:1 against the chart surface. Muted series retain their original opacity in fills and lines, while their boundaries remain opaque. Grouped bars, isolated observations, partial-period marks and `breakdown.mjs` snapshot bars also receive contrasting edges. Theme changes recalculate boundary colors without changing observations or geometry.
- ESR `#0B5CBD` and Release `#2EB6FF` remain the series colors. The Release color is approximately 2.27:1 against white; the ESR color is approximately 2.70:1 against the dark card background. The added boundaries address visibility without replacing those colors. Tooltip and legend swatches receive an outer ring; spending-allocation bars in `funding-view.mjs` receive an inset edge. SVG export legends retain the original series colors.
- `docs/media/js/focus.mjs` tracks keyboard versus pointer input. `dashboard.css` shows keyboard outlines on controls and scroll regions, places the chart outline inside the SVG, and exposes focus on the visible “Import rules” label. Mouse clicks clear the keyboard styling immediately, including when DOM focus remains on a text input or chart. Snapshot rows use an inset marker only during keyboard navigation. Pointer-focused charts no longer keep an unpinned tooltip visible after the pointer leaves.
- `tests/js/chart-contrast.test.mjs` checks luminance, composited fills and 4,096 RGB samples. `tests/browser/chart-contrast.spec.mjs` checks both themes, five chart modes, muted series, snapshot bars and theme switching. `tests/browser/focus.spec.mjs` checks keyboard navigation and mouse transitions on charts, snapshot rows, import rules, text fields, buttons and tables.
- The complete browser regression suite passed 107 tests, and the JavaScript unit suite passed 55 tests. Another 20 focused browser checks passed after the opacity refinement and funding edge. Thin snapshot bars are tested against the chart surface so their subpixel fills do not mask the boundary. The local static preview was rebuilt. Rendered chart captures are in `build/contrast-*.png`; test logs are in `build/contrast-*.log`.

## Limits and follow-up

### Dark-mode contrast follow-up

A subsequent user-requested contrast audit found gaps in the earlier coverage. At that point, the browser regression tests in `tests/browser/accessibility.spec.mjs` disabled the `color-contrast` rule; those passing results established structure and interaction checks, not text-contrast compliance. The earlier chart work tested series boundaries but did not establish contrast for every navigator/control state.

The follow-up enabled axe's text-contrast rule against the real-data preview on nine report routes and seven additional states: chart details, hidden series, expanded table, group editor, theme menu, platform snapshot, and hidden platform series. SVG text and text over imagery require separate measurements because axe marks those checks incomplete. Computed colors were measured against chart surfaces; text over the artwork was checked at rendered glyph positions using background-only screenshots at 1440 and 375 CSS pixels. Gradient measurements used the CSS gradient colors at those positions. No production styling was changed during this follow-up.

| Item in dark mode | Measured contrast | Result |
| --- | --- | --- |
| Main chart text / date readout | 14.88:1 | Passes normal-text AA |
| Muted text / axis labels against chart surface | 6.64:1 | Passes normal-text AA |
| Purple selected date preset text against its selected background | 6.32:1 | Passes normal-text AA |
| Bottom range handles and date-readout border | 4.08:1 | Passes non-text AA against the surface |
| Bottom range selection outline (65% opacity) | 2.47:1 against surface; 2.05:1 against selected fill | Below 3:1 |
| Navigator overview stroke (50% opacity) | 1.97:1 against surface | Weak visual distinction; review with navigator treatment |
| Hidden series legend name/value | Approximately 3.18–3.63:1 / 1.98–2.07:1 | Below 4.5:1; these are still operable buttons |
| Custom unchecked checkbox border | 1.36:1 | Below 3:1 |
| Shared neutral form-control border | 1.36:1 | Insufficient where the border identifies the control |
| Chart crosshair across some filled series | Approaches 1:1 | Cannot rely on the current stroke to identify the inspected date across every band |
| Mobile KPI labels and captions over artwork | 3.27–4.21:1 in the sampled 375px viewport | Below 4.5:1 |
| Footer gradient at 375px / 1440px | About 4.25:1 / 4.23:1 | Mobile 21px/600 text falls below 4.5:1; desktop 26px text passes the 3:1 large-text threshold |

Decorative grid lines measure about 1.17:1, but faint decorative rules do not themselves establish a WCAG failure. Disabled controls are exempt; hidden-series legend buttons are not disabled and remain subject to text contrast. Header text, ordinary footer text, and the other sampled artwork-backed text passed at the two checked viewport sizes. Other screen sizes and artwork positions have not been exhaustively verified.

Recommended visible follow-up: use stronger theme-aware navigator/control boundaries; retain readable text on hidden legend entries and communicate their state through swatches/decoration; add a contrasting crosshair edge; and increase contrast for the mobile KPI captions and mobile footer gradient. Keep the approved ESR and Release base colors. Enable lasting text-contrast regression coverage after those failures are addressed.

Evidence: `build/dark-contrast-audit.json`, `build/dark-chart-controls.json`, `build/dark-text-measurements.json`, `build/dark-gradient-contrast.json`, and the associated scripts and screenshots under `build/dark-*`.

### Contrast remediation after approval

The user authorized all contrast fixes. `dashboard.css` now gives interactive borders a separate contrast token, keeps hidden-series text fully opaque with a strike-through state, sets readable placeholder colors, and outlines channel swatches. The header and summary have a translucent panel behind their text; the light panel opacity is sufficient even over black artwork. Footer gradients now use theme-specific stops that pass normal-text contrast, including the smaller mobile heading.

`chart.mjs` uses an opaque theme-accent boundary for the range selection, handles, readout, and overview stroke. The crosshair, annotations, and hover markers use paired black-and-white edges. Very narrow grouped bars use a stroke that contrasts with the chart surface. Default-colored series retain their fallback color in hover markers and tooltip swatches.

The measured range-selector edge is 5.63:1 in light mode and 7.91:1 in dark mode against the chart surface, and remains above 3:1 against the selected fill. Default control borders are 4.64:1 and 5.06:1 respectively. At 375 CSS pixels, summary captions measure at least 5.36:1 in light mode and 7.46:1 in dark mode in the sampled artwork positions. The sampled footer text, including gradient text, passes in both themes at 375 and 1440 CSS pixels.

Text-contrast checks are now enabled in `tests/browser/accessibility.spec.mjs`. Six additional browser regressions in `tests/browser/contrast-regressions.spec.mjs` cover hidden-series text, placeholders, unchecked controls, navigator boundaries, hover markers, the crosshair, mobile summaries, and footer gradients. Existing chart contrast tests also check annotation edges. The panel/gradient tests consider both black and white artwork beneath the translucent panels.

Validation: 55 JavaScript unit tests and all 113 browser tests passed, including contrast and tooltip/performance regressions. Real-data text-contrast audits reported no violations across 16 states in each theme. Separate rendered-background measurements found no failures in the sampled text at either viewport size. The preview was rebuilt with the final changes.

Remediation evidence: `build/contrast-remediation-{light,dark}-audit.json`, `build/contrast-remediation-{light,dark}-text-measurements.json`, the accompanying screenshots, and `build/contrast-remediation-*.log`. Automated scans still leave some SVG/image-backed checks incomplete; the manual/composited-color measurements supplement those scans rather than treating incomplete checks as passes.

No NVDA, JAWS, VoiceOver or TalkBack session was available in this environment. Actual browser/screen-reader pair testing is still needed; Chromium accessibility-tree and keyboard checks cannot certify interoperability. In particular, confirm chart navigation in screen-reader browse/interaction modes, virtualized long tooltip lists, native date/select controls, and dynamic announcements with NVDA/Firefox and VoiceOver/Safari.

Axe cannot resolve all text contrast over background imagery, nor determine whether every multicolor graph is distinguishable. Those remain manual visual checks. It also flagged a hidden theme-menu `aria-controls` target for review; direct DOM-reference tests verify that the referenced menu exists. Automated results are not a declaration of complete WCAG compliance.
