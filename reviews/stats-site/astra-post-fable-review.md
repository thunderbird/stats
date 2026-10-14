# Astra post-Fable review

Date: 2026-10-13 (UTC)

Reviewer: GPT-6 Astra, independent code and visual review
Disposition: **Approved for the reviewed scope; no remaining blocking defects identified.**

This targeted follow-up reviewed the changes recorded in `fable-disposition.md`, their implementation, the actual local preview at `http://127.0.0.1:8877`, and the refreshed screenshots containing seven channel days and four Glean weeks. No implementation files were changed by this reviewer.

## Finding resolved during review

**P2 — Series colors changed when the selected channel set changed.** The initial color-separation implementation allocated colors from the currently displayed group set. A major version could therefore change color when another channel or version disappeared. This violated the stable-color requirement and made visual comparisons misleading.

The final implementation in `docs/media/js/explorer-model.mjs` derives non-fixed colors deterministically from series identity, preserving explicit family/channel colors. Retesting major 156 with and without major 157 produces `#ccb728` in both cases; major 157 remains `#28b2cc`. The regression test also covers changed dates, ordering, and fresh allocation. **Closed.**

## Code and interaction disposition

- Historical ESR matching follows the release record's dated `update_channel` metadata. An independent fixture spanning the 115/release to 128/esr transition returned the expected `[75, 75]` latest-ESR counts.
- Public Glean sanitization is applied to both published paths. The actual root and `data/` artifacts are identical, validate successfully, and are unchanged by a second sanitization pass. Across 40 metric records, the audit found no retained free-form labels violating the reporter threshold and no total-conservation violations.
- Schema evolution, retryable pending definitions, ingestion grace, and preservation of prior successful records were inspected alongside the relevant tests.
- Direct entry to Daily fetched the manifest, releases, compact ADI totals, and AMI; it did not fetch version partitions or the full ADI artifact.
- The navigator retains full-history context. Dragging the start handle expanded a three-month selection from 2026-07-11 back to 2026-04-24 while its history domain remained anchored at 2018-08-01.
- Relative saved ranges advance on reload. A stale six-month fixture advanced to 2026-04-11–2026-10-11. Sharing creates a state hash; subsequent edits remove the obsolete hash, and the edited preference survives reload.
- Recent ranking, top-eight metric grouping with a conserved remainder, gauge stacking, calendar-date ticks, asset validation, and percentage CSV output were reviewed. No additional actionable regression was found.

## Visual review

Actually inspected `light-desktop.png`, `dark-desktop.png`, `light-mobile.png`, `dark-mobile.png`, `channel-explorer-dark.png`, `telemetry-light-desktop.png`, and `platforms-dark-desktop.png` in `build/review/`. After the palette correction, re-inspected the refreshed dark desktop, telemetry light desktop, and dark mobile screenshots.

Both themes remain readable. Mobile tabs expose all eight destinations, the version editor has usable input width, and the charts and controls fit the viewport. The grouped telemetry charts are materially easier to read than the earlier many-label version. A live 375px viewport reported a 375px document width, and the group customization control had the accessible name “Customize groups.” No concrete new visual defect was identified.

## Verification

Independently executed:

- Targeted Python tests for Glean, releases, and browser data: **61 passed**.
- JavaScript unit suite after the palette fix: **18 passed**.
- The historical ESR fixture, actual public-artifact privacy/conservation audit, direct-Daily network check, and live browser interactions described above. No page errors occurred in the completed browser checks.

Also inspected the final project verification logs: **198 Python tests plus 8 subtests passed; lint passed; 18 JavaScript tests passed; 10 browser tests passed**.

This signoff covers the targeted implementation and preview review above. It does not claim an independent recomputation of upstream telemetry or a production deployment check.

## Final share-link and label follow-up — 2026-10-13

Reviewed the final `sharedViewBaseline` normalization and `lastReadHash` guard, the 12px KPI labels, and the added explanation that ESR presets require recorded channel data. **Approval unchanged; no new blocker found.**

An independent Playwright check against the rebuilt live preview verified that a received six-month link with stale embedded dates retains its exact URL on first load and reload while resolving to 2026-04-11–2026-10-11. Changing the chart mode then clears the obsolete state hash, and the edited mode survives reload. Both desktop and mobile KPI labels compute to 12px; the ESR explanation is present; the 375px viewport has no horizontal overflow; no page errors occurred. Also visually inspected the resulting mobile screenshot (`build/review/astra-final-labels-mobile.png`). The final project browser log records **11 passing tests**.

The narrow seven-day brush over the full historical overview remains a documented nonblocking usability limitation, with exact dates available through the date controls. The earlier deterministic identity-based color fix remains verified; the old allocation description in the Fable follow-up does not describe the final implementation.
