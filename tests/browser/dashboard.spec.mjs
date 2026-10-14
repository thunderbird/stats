import {selectReport, selectMetric} from "./navigation.mjs";
import { test, expect } from "@playwright/test";

async function open(page, hash = "") {
  await page.goto(`/${hash}`);
  await expect(page.locator("#explorer-chart svg")).toBeVisible();
}

test('Major versions save ESR cutoffs while Detailed versions keep individual labels and filter tiny tooltip shares', async ({page}) => {
  await page.route('**/data/releases.json', route => route.fulfill({json: {releases: [
    {version: '115.0', date: '2023-07-11', channel: 'esr'},
    {version: '128.0', date: '2024-07-11', channel: 'esr'},
    {version: '140.0', date: '2025-07-01', channel: 'esr'},
    {version: '153.0', date: '2026-09-16', channel: 'esr'},
  ]}}));
  await page.route('**/data/adi-2026.json', async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const [date, record] of Object.entries(data)) {
      const latest = date === '2026-09-30';
      record.count = 100000;
      record.channels = {release: {'115.18.3': 10000, '128.13.0': 20000, '140.3': 69850, '153.0': latest ? 100 : 49}, beta: {'154b1': latest ? 49 : 100}, nightly: {'155a1': 1}};
      record.versions = Object.assign({}, ...Object.values(record.channels));
    }
    await route.fulfill({json: data});
  });
  await open(page);
  const cutoff = page.getByLabel('Combine older versions');
  const legend = page.locator('#explorer-legend');
  await expect(cutoff).toHaveValue('128');
  await expect(cutoff.locator('option')).toHaveText(['153 and below', '140 and below', '128 and below', '115 and below', 'No version cutoff']);
  await expect(legend.locator('[data-series="versions-through:128"] .legend-value')).toHaveText('30%');
  await expect(legend.locator('[data-series="major:128"]')).toHaveCount(0);
  const svg = page.locator('#explorer-chart svg.stats-chart');
  const names = page.locator('#explorer-chart .chart-tooltip-name');
  await svg.focus();
  await page.keyboard.press('End');
  await expect(names).toHaveText(['140', '128 and below', '153']);
  await page.keyboard.press('ArrowLeft');
  await expect(names).toHaveText(['140', '128 and below', '154']);
  await page.locator('[data-mode="count"]').click();
  await svg.focus();
  await page.keyboard.press('End');
  await expect(names).toHaveText(['140', '128 and below', '153', '154', '155']);
  await expect(page.locator('#explorer-chart .chart-tooltip-total')).toHaveText('Selected population: 100,000');
  await cutoff.selectOption('115');
  await expect(legend.locator('[data-series="versions-through:115"] .legend-value')).toHaveText('10K');
  await expect(legend.locator('[data-series="major:128"] .legend-value')).toHaveText('20K');
  await page.locator('#grouping').selectOption('versions');
  await expect(cutoff).toBeHidden();
  await expect(legend.locator('[data-series="version:115.18.3"]')).toHaveCount(1);
  await expect(legend.locator('[data-series="version:128.13.0"]')).toHaveCount(1);
  await expect(legend.locator('[data-series^="versions-through:"]')).toHaveCount(0);
  await svg.focus();
  await page.keyboard.press('End');
  await expect(names).toHaveText(['140.3', '128.13.0', '115.18.3', '153.0', '154b1', '155a1']);
  await page.locator('#share').click();
  expect(JSON.parse(new URLSearchParams(page.url().split('?')[1]).get('state')).versionCutoff).toBe(115);
  await page.reload();
  await expect(cutoff).toHaveValue('115');
  await expect(svg).toBeVisible();
  await expect(cutoff).toBeHidden();
  await expect(legend.locator('[data-series="version:115.18.3"]')).toHaveCount(1);
  await expect(legend.locator('[data-series^="versions-through:"]')).toHaveCount(0);
  await page.locator('#grouping').selectOption('major');
  await expect(cutoff).toBeVisible();
  await expect(legend.locator('[data-series="versions-through:115"]')).toHaveCount(1);
  await cutoff.selectOption('140');
  await expect(legend.locator('[data-series="versions-through:140"] .legend-value')).toHaveText('99.85K');
  await cutoff.selectOption('');
  await expect(legend.locator('[data-series="major:115"]')).toHaveCount(1);
  await expect(legend.locator('[data-series^="versions-through:"]')).toHaveCount(0);
  await page.reload();
  await expect(cutoff).toHaveValue('');
  await expect(svg).toBeVisible();
  await page.locator('#grouping').selectOption('channels');
  await expect(cutoff).toBeHidden();
});

test('the version legend filters small shares while search, counts and table data retain every version', async ({page}) => {
  await page.route('**/data/releases.json', route => route.fulfill({json: {
    releases: [],
    release_releases: [{version: '157.0', date: '2026-09-01', channel: 'release'}],
  }}));
  await page.route('**/data/adi-2026.json', async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const [date, record] of Object.entries(data)) {
      const betaCount = date === '2026-09-29' ? 200 : 1;
      record.count = 100000;
      record.channels = {
        release: {'157.0': 100000 - 249 - betaCount, '156.0': 99, '155.0': 100, '155.0.1': 50},
        beta: {'154b1': betaCount}, nightly: {'158a1': 0},
      };
      record.versions = Object.assign({}, ...Object.values(record.channels));
    }
    await route.fulfill({json: data});
  });
  await open(page);
  await page.locator('#combine-release-versions').uncheck();
  const names = page.locator('#explorer-legend .legend-name');
  const showSmall = page.getByLabel('Show versions below 0.1%', {exact: true});
  await expect(showSmall).not.toBeChecked();
  await expect(names).toHaveText(['157', '155']);
  await expect(page.locator('#legend-status')).toContainText('2 of 6 series listed');
  await expect(page.locator('#explorer-chart path[data-series="major:156"]')).toHaveCount(1);
  await page.locator('.data-table-details summary').click();
  await expect(page.locator('#explorer-table thead th')).toHaveText(['Date', 'Selected population', '158', '158 share', '157', '157 share', '156', '156 share', '155', '155 share', '154', '154 share', '128 and below', '128 and below share']);
  const downloaded = page.waitForEvent('download');
  await page.locator('#export-csv').click();
  const stream = await (await downloaded).createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk;
  expect(csv).toContain('"99","0.099"');

  await page.locator('[data-mode="count"]').click();
  await expect(names).toHaveText(['157', '155']);
  await showSmall.check();
  await expect(names).toHaveText(['157', '155', '156', '154', '158', '128 and below']);
  await page.locator('#share').click();
  await page.reload();
  await expect(showSmall).toBeChecked();
  await page.locator('#reset-hidden').click();
  await expect(showSmall).not.toBeChecked();
  await expect(page.locator('#combine-release-versions')).toBeChecked();
  await page.locator('#combine-release-versions').uncheck();
  await expect(names).toHaveText(['157', '155']);

  // Select an older date without changing the range. A toggle must retain it.
  const chart = page.locator('#explorer-chart');
  await chart.locator('.chart-interaction').scrollIntoViewIfNeeded();
  const position = await chart.locator('svg').evaluate(svg => {
    const plot = svg.querySelector('clipPath rect').getBBox();
    const point = new DOMPoint(plot.x + plot.width * 28 / 29, plot.y + plot.height / 2).matrixTransform(svg.getScreenCTM());
    return {x: point.x, y: point.y};
  });
  await page.mouse.click(position.x, position.y);
  await expect(page.locator('#legend-date')).toHaveText('Sep 29, 2026');
  await expect(names).toHaveText(['157', '154', '155']);
  await page.locator('#explorer-legend [data-series="major:154"]').click();
  await expect(page.locator('#legend-date')).toHaveText('Sep 29, 2026');
  await expect(page.locator('#explorer-legend [data-series="major:154"]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#reset-hidden').click();
  await expect(page.locator('#legend-date')).toHaveText('Sep 30, 2026');
  await expect(page.locator('#start-date')).toHaveValue('2026-09-01');
  await expect(page.locator('#combine-release-versions')).toBeChecked();
  await page.locator('#grouping').selectOption('versions');
  await expect(names).toHaveText(['157.0', '155.0']);
  await page.locator('#legend-search').fill(' 156.0 ');
  await expect(names).toHaveText(['156.0']);
  await expect(page.locator('#focus-matching')).toBeEnabled();
  await page.locator('#focus-matching').click();
  await expect(page.locator('#explorer-chart path[data-series]')).toHaveCount(1);
  await expect(page.locator('#explorer-legend [data-series="version:156.0"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#clear-legend-search').click();
  await expect(page.locator('#legend-search')).toBeFocused();
  await expect(names).toHaveText(['157.0', '155.0']);
  await page.locator('#reset-hidden').click();
  await expect(page.locator('#grouping')).toHaveValue('major');
  await expect(names).toHaveText(['157', 'Other Release versions']);
  await expect(page.locator('#explorer-chart path[data-series]')).toHaveCount(5);
  await page.locator('#grouping').selectOption('channels');
  await expect(showSmall).toBeHidden();
  await expect(names).toContainText(['Beta', 'Nightly']);
});

test('legend actions reject empty matches, expose selection state and reset filters on mobile', async ({page}) => {
  await page.setViewportSize({width: 375, height: 844});
  await open(page);
  const search = page.locator('#legend-search');
  const matching = page.getByRole('button', {name: 'Show only matching', exact: true});
  const hideAll = page.getByRole('button', {name: 'Hide all', exact: true});
  const reset = page.getByRole('button', {name: 'Reset legend', exact: true});
  await expect(matching).toBeDisabled();
  await expect(reset).toBeDisabled();
  await search.fill('no-such-version');
  await expect(matching).toBeDisabled();
  await expect(page.locator('#legend-empty')).toContainText('No matching series');
  await expect(page.locator('#explorer-chart path[data-series]')).toHaveCount(5);
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.locator('#legend-empty')).toBeHidden();
  await search.fill('  140  ');
  await expect(matching).toBeEnabled();
  await matching.click();
  await expect(page.locator('#explorer-chart path[data-series]')).toHaveCount(1);
  await expect(page.locator('#legend-status')).toContainText('1 shown on chart');
  await hideAll.click();
  await expect(hideAll).toBeDisabled();
  await expect(page.locator('#legend-status')).toContainText('0 shown on chart');
  await expect(page.locator('#explorer-chart path[data-series]')).toHaveCount(0);
  await reset.click();
  await expect(search).toHaveValue('');
  await expect(page.locator('#legend-show-small-versions')).not.toBeChecked();
  await expect(page.locator('#explorer-chart path[data-series]')).toHaveCount(5);
  await expect(reset).toBeDisabled();
  const style = await matching.evaluate(button => {
    const style = getComputedStyle(button);
    return {border: parseFloat(style.borderTopWidth), height: button.getBoundingClientRect().height};
  });
  expect(style.border).toBeGreaterThanOrEqual(1);
  expect(style.height).toBeGreaterThanOrEqual(34);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reset clears saved comparisons and custom rules while retaining the date range', async ({page}) => {
  const state = {
    grouping: 'custom', mode: 'percent', versionCutoff: 115, combineReleaseVersions: false,
    channels: ['esr', 'release', 'unknown'], hiddenSeries: [], showSmallVersions: false,
    range: 'custom', startDate: '2026-09-02', endDate: '2026-09-28',
    groups: [
      {id: 'exact:152.0.6', name: '152.0.6', versions: ['=152.0.6'], color: '#c225df'},
      {id: 'remainder', name: 'Everything else', remainder: true, color: '#8493a7'},
    ],
  };
  await open(page, `#explore?${new URLSearchParams({state: JSON.stringify(state)})}`);
  const reset = page.getByRole('button', {name: 'Reset legend', exact: true});
  const legend = page.locator('#explorer-legend');
  await expect(legend.locator('.legend-name')).toHaveText(['Everything else', '152.0.6']);
  await expect(legend.locator('.legend-value')).toHaveText(['100%', '0%']);
  await expect(reset).toBeEnabled();
  await expect(reset).toHaveAttribute('title', /Restore Major versions/);
  await page.locator('#edit-groups').click();
  await page.locator('#group-preset').selectOption('legacy');
  await reset.click();
  await expect(page.locator('#grouping')).toHaveValue('major');
  await expect(legend).not.toContainText('Everything else');
  await expect(legend.locator('[data-series^="major:"]')).not.toHaveCount(0);
  await expect(page.locator('#start-date')).toHaveValue(state.startDate);
  await expect(page.locator('#end-date')).toHaveValue(state.endDate);
  await expect(page.getByLabel('Combine older versions')).toHaveValue('128');
  await expect(page.locator('#combine-release-versions')).toBeChecked();
  for (const channel of ['esr', 'release', 'beta', 'nightly', 'unknown'])
    await expect(page.locator(`.channel-set input[value="${channel}"]`)).toBeChecked();
  await expect(page.locator('#group-editor')).toBeHidden();
  await expect(page.locator('#edit-groups')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#group-preset')).toHaveValue('latest-esr');
  await expect(reset).toBeDisabled();
  await expect(page).not.toHaveURL(/state=/);
  await page.reload();
  await expect(page.locator('#grouping')).toHaveValue('major');
  await expect(legend).not.toContainText('Everything else');
  await expect(page.locator('#start-date')).toHaveValue(state.startDate);
  await expect(page.locator('#end-date')).toHaveValue(state.endDate);
  await expect(reset).toBeDisabled();
  await page.locator('#edit-groups').click();
  await expect(page.locator('#group-rows [data-field="name"]').first()).toHaveValue('Latest ESR family');
  await expect(page.locator('#group-rows [data-field="name"]').last()).toHaveValue('Everything else');
  await expect(page.locator('#group-rows [data-field="color"]').first()).toHaveValue('#0b5cbd');
  await expect(page.locator('#group-rows [data-field="color"]').last()).toHaveValue('#8493a7');
  await expect(page.locator('#group-rows [data-field="versions"]').first()).toHaveValue('');
  await page.locator('#group-rows [data-field="name"]').first().fill('My saved comparison');
  await page.locator('#group-rows [data-field="name"]').first().dispatchEvent('change');
  await page.locator('#grouping').selectOption('major');
  // Custom rules still need clearing even when they are not the active grouping.
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(reset).toBeDisabled();
  await page.locator('#edit-groups').click();
  await expect(page.locator('#group-rows [data-field="name"]').first()).toHaveValue('Latest ESR family');
  await expect(page.locator('#group-rows [data-field="name"]').last()).toHaveValue('Everything else');
});

test('reset detects each grouping, bucket and channel change and preserves Counts', async ({page}) => {
  await open(page);
  const reset = page.getByRole('button', {name: 'Reset legend', exact: true});
  await page.locator('[data-mode="count"]').click();
  await expect(reset).toBeDisabled();
  const changes = [
    () => page.locator('#grouping').selectOption('versions'),
    () => page.locator('#grouping').selectOption('channels'),
    () => page.locator('#version-cutoff').selectOption(''),
    () => page.locator('#combine-release-versions').uncheck(),
    () => page.locator('.channel-set input[value="beta"]').uncheck(),
  ];
  for (const change of changes) {
    await change();
    await expect(reset).toBeEnabled();
    await reset.click();
    await expect(reset).toBeDisabled();
    await expect(page.locator('#grouping')).toHaveValue('major');
    await expect(page.locator('#version-cutoff')).toHaveValue('128');
    await expect(page.locator('#combine-release-versions')).toBeChecked();
    await expect(page.locator('.channel-set input[value="beta"]')).toBeChecked();
    await expect(page.locator('[data-mode="count"]')).toHaveAttribute('aria-pressed', 'true');
  }
});

test('ESR labels distinguish the same version across tooltips, legends, exports and saved comparisons', async ({page}) => {
  await page.route('**/data/releases.json', route => route.fulfill({json: {
    releases: [{version: '153.0', date: '2026-07-21', channel: 'esr'}],
    release_releases: [{version: '157.0', date: '2026-08-30', channel: 'release'}],
  }}));
  await page.route('**/data/adi-2026.json', async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const record of Object.values(data)) {
      record.count = 100;
      record.channels = {esr: {'153.0': 60}, release: {'153.0': 25}, beta: {'154b1': 10}, unknown: {'153.0': 5}};
      record.versions = {'153.0': 90, '154b1': 10};
    }
    await route.fulfill({json: data});
  });
  await open(page);
  const legend = page.locator('#explorer-legend');
  const esr = legend.locator('[data-series="major:153:esr"]');
  await expect(esr.locator('.legend-name')).toHaveText('153 ESR');
  await expect(esr.locator('.legend-value')).toHaveText('65%');
  await expect(legend.locator('[data-series="other-release-versions"] .legend-value')).toHaveText('25%');
  await page.getByLabel('Combine Release versions prior to 157', {exact: true}).uncheck();
  await expect(legend.locator('[data-series="major:153"] .legend-name')).toHaveText('153');
  await expect(legend.locator('[data-series="major:153"] .legend-value')).toHaveText('25%');
  const colors = await legend.locator('[data-series^="major:153"] .legend-swatch').evaluateAll(nodes => nodes.map(node => node.style.background));
  expect(new Set(colors).size).toBe(2);
  const svg = page.locator('#explorer-chart svg.stats-chart');
  await svg.focus();
  await page.keyboard.press('End');
  await expect(page.locator('#explorer-chart .chart-tooltip-name')).toHaveText(['153 ESR', '153', '154']);
  await expect(page.locator('#explorer-chart .chart-tooltip-total')).toHaveText('Selected population: 100');
  await page.locator('.data-table-details summary').click();
  await expect(page.locator('#explorer-table thead th')).toHaveText(['Date', 'Selected population', '154', '154 share', '153 ESR', '153 ESR share', '153', '153 share', '128 and below', '128 and below share']);
  const downloaded = page.waitForEvent('download');
  await page.locator('#export-csv').click();
  const stream = await (await downloaded).createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk;
  expect(csv.split('\r\n')[0]).toContain('"153 ESR","153 ESR share (%)","153","153 share (%)"');
  await page.locator('#grouping').selectOption('versions');
  await svg.focus();
  await page.keyboard.press('End');
  await expect(page.locator('#explorer-chart .chart-tooltip-name')).toHaveText(['153.0 ESR', '153.0', '154b1']);
  await expect(legend.locator('[data-series="version:153.0:esr"] .legend-value')).toHaveText('65%');
  await expect(legend.locator('[data-series="version:153.0"] .legend-value')).toHaveText('25%');
  await page.locator('#grouping').selectOption('major');
  await page.locator('#legend-search').fill('153.0 ESR');
  await page.locator('[data-version="153.0"][data-esr-version="true"]').click();
  await expect(legend.locator('[data-series="exact:153.0:esr"] .legend-name')).toHaveText('153.0 ESR');
  await expect(legend.locator('[data-series="exact:153.0:esr"] .legend-value')).toHaveText('65%');
  await page.locator('#share').click();
  await page.reload();
  await expect(legend.locator('[data-series="exact:153.0:esr"] .legend-value')).toHaveText('65%');
});

test('Major versions optionally bucket non-current Release activity and save the choice without changing Detailed versions', async ({page}) => {
  await page.route('**/data/releases.json', route => route.fulfill({json: {
    releases: [{version: '128.0', date: '2024-07-11', channel: 'esr'}, {version: '140.0', date: '2025-07-01', channel: 'esr'}],
    release_releases: [
      {version: '153.0', date: '2026-08-01', channel: 'release'},
      {version: '157.0', date: '2026-09-30', channel: 'release'},
      {version: '158.0', date: '2026-10-28', channel: 'release'},
    ],
  }}));
  await page.route('**/data/adi-2026.json', async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const record of Object.values(data)) {
      record.count = 100;
      record.channels = {esr: {'140.3': 64}, release: {'153.0': 20, '157.0.1': 5, '158.0': 1}, beta: {'158.0': 8}, nightly: {'159a1': 2}};
      record.versions = {};
      for (const versions of Object.values(record.channels)) for (const [version, count] of Object.entries(versions))
        record.versions[version] = (record.versions[version] || 0) + count;
    }
    await route.fulfill({json: data});
  });
  await open(page);
  const legend = page.locator('#explorer-legend');
  const cutoff = page.getByLabel('Combine older versions');
  const combineRelease = page.getByLabel('Combine Release versions prior to 157', {exact: true});
  const bucket = legend.locator('[data-series="other-release-versions"]');
  const svg = page.locator('#explorer-chart svg.stats-chart');
  await expect(bucket.locator('.legend-name')).toHaveText('Other Release versions');
  await expect(combineRelease).toBeChecked();
  await expect(bucket.locator('.legend-value')).toHaveText('21%');
  await expect(legend.locator('[data-series="major:157"] .legend-value')).toHaveText('5%');
  await expect(legend.locator('[data-series="major:158"] .legend-value')).toHaveText('8%');
  await expect(legend.locator('[data-series="major:153"]')).toHaveCount(0);
  await svg.focus();
  await page.keyboard.press('End');
  await expect(page.locator('#explorer-chart .chart-tooltip-name')).toHaveText(['140 ESR', 'Other Release versions', '158', '157', '159']);
  await expect(page.locator('#explorer-chart .chart-tooltip-total')).toHaveText('Selected population: 100');
  await page.locator('.data-table-details summary').click();
  await expect(page.locator('#explorer-table thead')).toContainText('Other Release versions');
  await expect(page.locator('#explorer-table tbody tr').first().locator('td')).toHaveText(['100', '2', '2%', '8', '8%', '5', '5%', '64', '64%', '0', '0%', '21', '21%']);
  await combineRelease.uncheck();
  await expect(bucket).toHaveCount(0);
  await expect(legend.locator('[data-series="major:153"] .legend-value')).toHaveText('20%');
  await expect(legend.locator('[data-series="major:158"] .legend-value')).toHaveText('9%');
  await expect(cutoff).toHaveValue('128');
  await expect(page.locator('.series-help')).toContainText('individual major families');
  await expect(page.locator('#explorer-table tbody tr').first().locator('td')).toHaveText(['100', '2', '2%', '9', '9%', '5', '5%', '20', '20%', '64', '64%', '0', '0%']);
  await svg.focus();
  await page.keyboard.press('End');
  await expect(page.locator('#explorer-chart .chart-tooltip-name')).toHaveText(['140 ESR', '153', '158', '157', '159']);
  await expect(page.locator('#explorer-chart .chart-tooltip-total')).toHaveText('Selected population: 100');
  await page.reload();
  await expect(svg).toBeVisible();
  await expect(combineRelease).not.toBeChecked();
  await expect(bucket).toHaveCount(0);
  await page.locator('#share').click();
  expect(JSON.parse(new URLSearchParams(page.url().split('?')[1]).get('state')).combineReleaseVersions).toBe(false);
  await page.reload();
  await expect(svg).toBeVisible();
  await expect(combineRelease).not.toBeChecked();
  await expect(bucket).toHaveCount(0);
  await page.locator('.data-table-details summary').click();
  await page.locator('#grouping').selectOption('versions');
  await expect(cutoff).toBeHidden();
  await expect(combineRelease).toBeHidden();
  await expect(bucket).toHaveCount(0);
  await expect(legend.locator('[data-series^="versions-through:"]')).toHaveCount(0);
  for (const [version, share] of [['153.0', '20%'], ['157.0.1', '5%'], ['158.0', '9%'], ['140.3', '64%']])
    await expect(legend.locator(`[data-series="version:${version}${version === '140.3' ? ':esr' : ''}"] .legend-value`)).toHaveText(share);
  await expect(page.locator('#explorer-table thead')).not.toContainText('Other Release versions');
  await page.locator('#grouping').selectOption('major');
  await expect(cutoff).toHaveValue('128');
  await expect(combineRelease).not.toBeChecked();
  await expect(bucket).toHaveCount(0);
  await combineRelease.focus();
  await page.keyboard.press('Space');
  await expect(combineRelease).toBeChecked();
  await expect(bucket.locator('.legend-value')).toHaveText('21%');
  await page.locator('#grouping').selectOption('versions');
  await expect(combineRelease).toBeHidden();
  await expect(legend.locator('[data-series="version:153.0"] .legend-value')).toHaveText('20%');
  await expect(bucket).toHaveCount(0);
  await page.locator('#grouping').selectOption('channels');
  await expect(combineRelease).toBeHidden();
  await page.locator('#grouping').selectOption('major');
  await expect(combineRelease).toBeChecked();
  await expect(bucket.locator('.legend-value')).toHaveText('21%');
  await page.locator('#end-date').fill('2026-09-29');
  await page.locator('#end-date').press('Tab');
  await expect(bucket.locator('.legend-value')).toHaveText('21%');
  await expect(legend.locator('[data-series="major:157"] .legend-value')).toHaveText('5%');
  await page.locator('#share').click();
  await page.reload();
  await expect(svg).toBeVisible();
  await expect(bucket.locator('.legend-value')).toHaveText('21%');
  await expect(cutoff).toHaveValue('128');
  await expect(combineRelease).toBeChecked();
});

test('Release buckets span the start of recorded channels and expand without losing historical versions', async ({page}) => {
  await page.route('**/data/releases.json', route => route.fulfill({json: {
    releases: [{version: '128.0', date: '2024-07-11', channel: 'esr'}, {version: '140.0', date: '2025-07-02', channel: 'esr'}],
    release_releases: [
      {version: '140.0', date: '2025-07-02', channel: 'release'},
      {version: '152.0', date: '2026-06-16', channel: 'release'},
      {version: '157.0', date: '2026-09-30', channel: 'release'},
    ],
  }}));
  await page.route('**/data/adi-2026.json', async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const [date, record] of Object.entries(data)) {
      record.count = 1000;
      record.versions = {'140.3': 650, '152.0.1': 280, '157.0': 50, '155a1': 20};
      delete record.channels;
      if (date >= '2026-09-12') record.channels = {
        esr: {'140.3': 650}, release: {'152.0.1': 280, '157.0': 50}, nightly: {'155a1': 20},
      };
    }
    await route.fulfill({json: data});
  });
  await open(page);
  await page.locator('#legend-show-small-versions').check();
  await page.locator('#start-date').fill('2026-09-11');
  await page.locator('#start-date').press('Tab');
  await page.locator('#end-date').fill('2026-09-12');
  await page.locator('#end-date').press('Tab');
  const legend = page.locator('#explorer-legend');
  const svg = page.locator('#explorer-chart svg.stats-chart');
  const names = page.locator('#explorer-chart .chart-tooltip-name');
  const rows = page.locator('#explorer-chart .chart-tooltip-item');
  const combineRelease = page.getByLabel('Combine Release versions prior to 157', {exact: true});
  const bucket = legend.locator('[data-series="other-release-versions"]');
  await expect(bucket.locator('.legend-value')).toHaveText('28%');
  await expect(legend.locator('[data-series="major:152"]')).toHaveCount(0);
  await expect(legend.locator('[data-series="major:140:esr"] .legend-value')).toHaveText('65%');
  await svg.focus();
  for (const [key, date] of [['Home', 'Sep 11, 2026'], ['ArrowRight', 'Sep 12, 2026']]) {
    await page.keyboard.press(key);
    await expect(page.locator('#explorer-chart .chart-tooltip-header strong')).toHaveText(date);
    await expect(names).toHaveText(['140 ESR', 'Other Release versions', '157', '155']);
    await expect(rows.filter({hasText: 'Other Release versions'})).toContainText('28%');
    await expect(page.locator('#explorer-chart .chart-tooltip-total')).toHaveText('Selected population: 1,000');
  }
  await combineRelease.uncheck();
  await expect(bucket).toHaveCount(0);
  await expect(legend.locator('[data-series="major:152"] .legend-value')).toHaveText('28%');
  await svg.focus();
  for (const key of ['Home', 'ArrowRight']) {
    await page.keyboard.press(key);
    await expect(names).toHaveText(['140 ESR', '152', '157', '155']);
    await expect(rows.filter({has: page.locator('.chart-tooltip-name', {hasText: /^152$/})})).toContainText('28%');
  }
  await page.locator('#grouping').selectOption('versions');
  await svg.focus();
  for (const key of ['Home', 'ArrowRight']) {
    await page.keyboard.press(key);
    await expect(names).toHaveText(['140.3 ESR', '152.0.1', '157.0', '155a1']);
    await expect(rows.filter({hasText: '152.0.1'})).toContainText('28%');
  }
  await page.locator('#grouping').selectOption('major');
  await combineRelease.check();
  await expect(bucket.locator('.legend-value')).toHaveText('28%');
  await page.locator('.channel-set input[value="release"]').uncheck();
  await expect(bucket.locator('.legend-value')).toHaveText('0%');
  await svg.focus();
  await page.keyboard.press('Home');
  await expect(names).toHaveCount(0);
  await expect(page.locator('#explorer-chart .chart-tooltip')).toContainText('Channel breakdown unavailable');
  await page.keyboard.press('ArrowRight');
  await expect(names).toHaveText(['140 ESR', '155']);
  await expect(page.locator('#explorer-chart .chart-tooltip-total')).toHaveText('Selected population: 670');
  await page.getByRole('button', {name: 'Include all channels', exact: true}).click();
  await svg.focus();
  await page.keyboard.press('Home');
  await expect(names).toHaveText(['140 ESR', 'Other Release versions', '157', '155']);
  await expect(page.locator('#explorer-chart .chart-tooltip-total')).toHaveText('Selected population: 1,000');
});

test('Filtered histories mark unavailable channel dates as gaps and restore the full version totals', async ({page}) => {
  const observations = {
    '2026-07-11': {count: 4845080, versions: {'152.0.1': 1353589, '140.12.0': 3491491}},
    '2026-07-12': {count: 4827709, versions: {'152.0.1': 1402733, '140.12.0': 3424976}, channels: {
      release: {'152.0.1': 1400952, '140.12.0': 359784},
      esr: {'152.0.1': 6, '140.12.0': 3065192},
      beta: {'152.0.1': 299}, nightly: {'152.0.1': 61}, unknown: {'152.0.1': 1415},
    }},
  };
  await page.route('**/data/index.json', async route => {
    const response = await route.fetch();
    const data = await response.json();
    Object.assign(data.adi, {start: '2026-07-11', end: '2026-07-12', channel_start: '2026-07-12', channel_end: '2026-07-12',
      files: [{file: 'adi-2026.json', start: '2026-07-11', end: '2026-07-12'}]});
    await route.fulfill({json: data});
  });
  await page.route('**/data/adi-2026.json', route => route.fulfill({json: observations}));
  await page.route('**/data/adi-totals.json', route => route.fulfill({json: {'2026-07-11': 4845080, '2026-07-12': 4827709}}));
  await page.route('**/data/releases.json', route => route.fulfill({json: {
    releases: [{version: '128.0', date: '2024-07-11', channel: 'esr'}, {version: '140.0', date: '2025-07-02', channel: 'esr'}],
    release_releases: [{version: '152.0', date: '2026-06-16', channel: 'release'}],
  }}));
  await open(page);
  await page.getByLabel('Combine Release versions prior to 152', {exact: true}).uncheck();
  const release = page.locator('.channel-set input[value="release"]');
  await release.uncheck();
  const svg = page.locator('#explorer-chart svg.stats-chart');
  const names = page.locator('#explorer-chart .chart-tooltip-name');
  const version152 = page.locator('#explorer-chart .chart-tooltip-item').filter({has: page.locator('.chart-tooltip-name', {hasText: /^152$/})});
  const total = page.locator('#explorer-chart .chart-tooltip-total');
  await svg.focus();
  await page.keyboard.press('Home');
  await expect(names).toHaveCount(0);
  await expect(page.locator('#explorer-chart .chart-tooltip')).toContainText('Channel breakdown unavailable');
  await expect(total).toBeHidden();
  await page.keyboard.press('End');
  await expect(version152).toHaveCount(0);
  await page.locator('[data-mode="count"]').click();
  await svg.focus();
  await page.keyboard.press('End');
  await expect(version152.locator('strong')).toHaveText('1,775');
  await expect(total).toHaveText('Selected population: 3,066,973');
  await expect(names).toHaveText(['140 ESR', '152', '152 ESR']);
  await expect(page.locator('#denominator-note')).toContainText('Excluded channels: Release.');
  await expect(page.locator('.series-help')).toContainText('Count tooltips show every nonzero value.');
  const geometry = await page.locator('#explorer-chart path[data-series="major:152"]').evaluate(path => path.__data__.geometry.map(point => point.value));
  expect(geometry).toEqual([null, 1775]);
  await page.keyboard.press('Home');
  await expect(names).toHaveCount(0);
  await expect(page.locator('#explorer-chart .chart-tooltip')).toContainText('Include all channels to view the total.');
  await page.locator('[data-mode="percent"]').click();
  await svg.focus();
  await page.keyboard.press('End');
  await expect(version152).toHaveCount(0);
  await page.locator('[data-mode="count"]').click();
  await page.locator('#grouping').selectOption('versions');
  await svg.focus();
  await page.keyboard.press('End');
  await expect(page.locator('#explorer-chart .chart-tooltip-item').filter({has: page.locator('.chart-tooltip-name', {hasText: /^152\.0\.1$/})}).locator('strong')).toHaveText('1,775');
  await page.locator('#grouping').selectOption('major');
  await page.getByRole('button', {name: 'Include all channels', exact: true}).click();
  await expect(release).toBeChecked();
  await expect(page.locator('#include-all-channels')).toBeHidden();
  await svg.focus();
  await page.keyboard.press('Home');
  await expect(version152.locator('strong')).toHaveText('1,353,589');
  await page.keyboard.press('End');
  await expect(version152.locator('strong')).toHaveText('1,402,727');
  await expect(total).toHaveText('Selected population: 4,827,709');
  await expect(page.locator('#denominator-note')).not.toContainText('Excluded channels');
  expect(await page.locator('#explorer-chart path[data-series="major:152"]').evaluate(path => path.__data__.geometry.map(point => point.value))).toEqual([1353589, 1402727]);
  await expect(page.locator('#start-date')).toHaveValue('2026-07-11');
  await expect(page.locator('#end-date')).toHaveValue('2026-07-12');
  await page.reload();
  await expect(release).toBeChecked();
  await expect(svg).toBeVisible();
  await svg.focus();
  await page.keyboard.press('End');
  await expect(version152.locator('strong')).toHaveText('1,402,727');
});

test('version area legends rank the largest shares first and retain their colors and toggles', async ({page}) => {
  await page.route('**/data/adi-2026.json', async route => {
    const response = await route.fetch(); const data = await response.json();
    for (const record of Object.values(data)) {
      record.count = 1000;
      record.channels = {esr:{'128.13.0':207}, release:{'153.0':625}, beta:{'154b1':168}};
      record.versions = Object.assign({}, ...Object.values(record.channels));
    }
    await route.fulfill({json:data});
  });
  await open(page);
  const legend = page.locator('#explorer-legend');
  await expect(legend.locator('.legend-name')).toHaveText(['153', '128 and below', '154']);
  await expect(legend.locator('.legend-value')).toHaveText(['62.5%', '20.7%', '16.8%']);
  const largest = legend.locator('[data-series="major:153"]');
  const color = await largest.locator('.legend-swatch').evaluate(node => getComputedStyle(node).backgroundColor);
  await largest.click();
  await expect(largest).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#explorer-chart path[data-series="major:153"]')).toHaveCount(0);
  await largest.click();
  await expect(page.locator('#explorer-chart path[data-series="major:153"]')).toHaveCount(1);
  expect(await largest.locator('.legend-swatch').evaluate(node => getComputedStyle(node).backgroundColor)).toBe(color);
  await page.locator('[data-mode="count"]').click();
  await expect(legend.locator('.legend-name')).toHaveText(['153', '128 and below', '154']);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await largest.locator('.legend-swatch').evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(12);
  expect(await page.locator('.channel-dot').first().evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(12);
});

test("static explorer, channel filters, saved groups and exports work together", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.locator("#grouping").selectOption("channels");
  await expect(page.locator("#explorer-legend")).toContainText("ESR");
  await page.locator('[data-mode="count"]').click();
  await expect(page.locator('[data-mode="count"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#edit-groups").click();
  await page.locator("#group-preset").selectOption("latest-esr");
  await page.locator("#apply-preset").click();
  await expect(page.locator("#group-rows [data-group]")).toHaveCount(2);
  await page
    .locator('#group-rows [data-field="name"]')
    .first()
    .fill("My ESR group");
  await page.locator('#group-rows [data-field="name"]').first().press("Tab");
  await expect(page.locator("#explorer-legend")).toContainText("My ESR group");
  await page.locator(".data-table-details summary").click();
  const exported = page.waitForEvent("download");
  await page.locator("#export-csv").click();
  expect((await exported).suggestedFilename()).toBe("thunderbird-adoption.csv");
  await page.locator("#share").click();
  const shared = page.url();
  expect(shared).toContain("state=");
  await page.reload();
  await expect(page.locator("#explorer-legend")).toContainText("My ESR group");
  await expect(page).toHaveURL(shared);
  expect(errors).toEqual([]);
});

test("Glean is default and legacy view stops at May 2025", async ({ page }) => {
  await open(page);
  await selectReport(page, "telemetry");
  await expect(page.locator("#secondary-content")).toContainText(
    "Mail accounts",
  );
  await expect(page.locator("#secondary-content svg.stats-chart")).toHaveCount(1);
  await page.locator("#archive").selectOption("legacy");
  await expect(page.locator("#secondary-content")).toContainText(
    "legacy.metric",
  );
  await expect(page.locator("#secondary-content")).not.toContainText(
    "must-not-display",
  );
  await page.locator("#archive").selectOption("current");
  await selectReport(page, "platforms");
  await expect(page.locator("#secondary-content svg.stats-chart")).toHaveCount(2);
  await expect(page.locator("#secondary-content")).toContainText("Glean");
  await selectReport(page, "mau");
  await expect(page.locator("#secondary-content svg.stats-chart")).toHaveCount(1);
  await expect(page.locator("#monthly-kpi")).toHaveText("150");
});

test("secure reads and loads stay distinct from all-message counters and the legacy archive", async ({page}) => {
  const categories = {
    "OpenPGP · signed only": 60,
    "OpenPGP · encrypted only": 50,
    "OpenPGP · signed and encrypted": 40,
    "S/MIME · signed only": 30,
    "S/MIME · encrypted only": 20,
    "S/MIME · signed and encrypted": 10,
  };
  await page.route("**/data/glean.json", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const records = (versions) => Object.fromEntries(["2026-09-06", "2026-09-27"].map((date) => [date, {
      count: 100,
      total: Object.values(versions).reduce((sum, value) => sum + value, 0),
      versions,
    }]));
    data.metrics = {
      mail_mails_read: {label: "Messages read", kind: "counter", unit: "messages", records: records({all: 1000})},
      compose_mails_sent: {label: "Messages sent", kind: "counter", unit: "messages", records: records({all: 500})},
      mail_mails_read_secure: {
        label: "Secure messages read", kind: "event", unit: "reads",
        description: "Newly read OpenPGP and S/MIME signed or encrypted messages; each event is counted once.",
        methodology: "Secure-read events from distinct pings; categories are mutually exclusive.",
        records: records(categories),
      },
      mail_secure_mail_loaded: {
        label: "Secure messages loaded", kind: "event", unit: "loads",
        description: "OpenPGP and S/MIME signed or encrypted message loads, including reopens.",
        methodology: "Secure-load events from distinct pings; repeated loads are counted.",
        records: records({...categories, "Unknown security details": 4}),
      },
    };
    await route.fulfill({json: data});
  });
  await page.route("**/telemetry.json", async (route) => {
    await route.fulfill({json: {"legacy.secure.read": {
      "2025-05-25": {count: 100, versions: {"Legacy OpenPGP": 25}},
      "2025-06-01": {count: 100, versions: {"must-not-display": 99}},
    }}});
  });
  await open(page);
  await selectReport(page, "telemetry");
  await expect(page.locator("#telemetry-nav-links [data-metric]")).toHaveText([
    "OAuth Providers", "All messages read", "All messages sent", "Secure messages read", "Secure messages loaded",
  ]);
  const card = page.locator('.secondary-card:has(#feature-usage)');
  await expect(card.locator("h3")).toHaveText("All messages read");
  await selectMetric(page, "mail_mails_read_secure");
  await expect(card.locator("h3")).toHaveText("Secure messages read");
  await expect(card.locator(".secondary-legend .legend-item")).toHaveCount(6);
  for (const category of Object.keys(categories)) {
    await expect(card.getByRole("button", {name: `Toggle ${category}`, exact: true})).toBeVisible();
  }
  await expect(card.locator(".secondary-meta")).toContainText("Glean · reads");
  await expect(card.locator(".secondary-meta")).toContainText("100 reporting clients");
  await expect(card.locator(".secondary-meta")).toContainText("categories are mutually exclusive");
  await expect(card.locator(".range-toolbar")).toBeVisible();
  await card.locator("summary").click();
  await expect(card.locator("table tbody tr").first().locator("td")).toHaveText(["60", "50", "40", "30", "20", "10"]);
  await selectMetric(page, "mail_secure_mail_loaded");
  await expect(card.locator("h3")).toHaveText("Secure messages loaded");
  await expect(card.locator(".card-top p")).toContainText("including reopens");
  await expect(card.locator(".secondary-meta")).toContainText("Glean · loads");
  await expect(card.locator(".secondary-meta")).toContainText("repeated loads are counted");
  await expect(card.locator(".secondary-legend .legend-item")).toHaveCount(7);
  await expect(card.locator(".secondary-legend")).toContainText("Unknown security details");
  await page.locator("#archive").selectOption("legacy");
  await expect(page.locator("#telemetry-nav-links [data-metric]")).toHaveText(["OAuth Providers", "legacy.secure.read"]);
  await expect(card.locator(".secondary-meta")).toContainText("Legacy telemetry");
  await expect(card.locator(".secondary-legend")).toContainText("Legacy OpenPGP");
  await expect(card).not.toContainText("must-not-display");
  await page.locator("#archive").selectOption("current");
  await expect(page.locator("#telemetry-nav-links [data-metric]")).toHaveCount(5);
  await expect(page.locator("#telemetry-nav-links [data-metric]").filter({hasText: "legacy.secure.read"})).toHaveCount(0);
});

test("mobile dark theme, keyboard tooltip and reduced motion remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await open(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#theme").click();
  await page.getByRole("menuitemradio", {name: "Light", exact: true}).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const svg = page.locator("#explorer-chart svg");
  await svg.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#explorer-chart .chart-tooltip")).toBeVisible();
});

test("theme menu supports keyboard selection, saved preferences and system changes", async ({page}) => {
  await open(page);
  const trigger = page.getByRole("button", {name: /^Color theme:/});
  const menu = page.getByRole("menu", {name: "Color theme"});
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", {name: "Light", exact: true})).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.reload();
  await expect(trigger).toHaveAccessibleName("Color theme: Dark");
  await trigger.click();
  await expect(page.getByRole("menuitemradio", {name: "Dark", exact: true})).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("s");
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAccessibleName("Color theme: System");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  for (const colorScheme of ["dark", "light"]) {
    await page.emulateMedia({colorScheme});
    expect(await page.locator("html").evaluate((node) => getComputedStyle(node).colorScheme)).toBe(colorScheme);
  }
  await trigger.click();
  await page.getByRole("heading", {name: "Versions & channels", level: 2}).click();
  await expect(menu).toBeHidden();
  await trigger.click();
  await page.keyboard.press("Tab");
  await expect(menu).toBeHidden();
  await page.setViewportSize({width: 320, height: 844});
  await trigger.click();
  const bounds = await menu.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("missing Glean weeks remain gaps and add-on sources stay distinct", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await selectReport(page, "telemetry");
  const path = page.locator("#feature-usage path[data-series]").first();
  await expect(path).toHaveAttribute("d", /M.*M/);
  await selectReport(page, "addons");
  await expect(page.locator("#secondary-content")).toContainText(
    "Existing legacy telemetry",
  );
  await page.locator("#archive").selectOption("glean");
  await expect(page.locator("#secondary-content")).toContainText(
    "Glean's weekly top 10",
  );
  await expect(page.locator("#secondary-content")).toContainText("differ");
});

test("version search compares an exact recorded version and mobile group fields remain wide", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await open(page);
  await page.locator("#legend-search").fill("140.3");
  await page.locator('[data-version="140.3"]').click();
  await expect(page.locator("#grouping")).toHaveValue("custom");
  await expect(page.locator("#explorer-legend")).toContainText("140.3");
  await page.locator("#edit-groups").click();
  expect(
    await page
      .locator('[data-field="versions"]')
      .first()
      .evaluate((e) => e.getBoundingClientRect().width),
  ).toBeGreaterThan(160);
  await expect(page.locator('[data-field="versions"]').first()).toHaveValue(
    "=140.3",
  );
  const reset = page.getByRole('button', {name: 'Reset legend', exact: true});
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(page.locator('#grouping')).toHaveValue('major');
  await expect(page.locator('#explorer-legend')).not.toContainText('Everything else');
});

test("search promotion precedes broad rules and updates the open editor", async ({
  page,
}) => {
  await open(page);
  await page.locator("#edit-groups").click();
  await page.locator("#group-preset").selectOption("legacy");
  await page.locator("#apply-preset").click();
  await page.locator("#legend-search").fill("140.3");
  await page.locator('[data-version="140.3"]').click();
  await expect(page.locator("#group-rows [data-group]")).toHaveCount(4);
  await expect(
    page.locator('#group-rows [data-field="versions"]').first(),
  ).toHaveValue("=140.3");
  await expect(
    page.locator('[data-series="exact:140.3:esr"] .legend-value'),
  ).toHaveText("65%");
});

test("saved presets advance with the data and later edits replace a shared state", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("tb-stats-view")) localStorage.setItem("tb-stats-view", JSON.stringify({
      range: "6m", startDate: "2026-09-01", endDate: "2026-09-20"
    }));
  });
  await open(page);
  await expect(page.locator("#end-date")).toHaveValue("2026-09-30");
  await expect(page.locator('[data-range="6m"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#share").click();
  expect(page.url()).toContain("state=");
  await page.locator('[data-mode="count"]').click();
  await expect(page).not.toHaveURL(/state=/);
  await page.reload();
  await expect(page.locator('[data-mode="count"]')).toHaveAttribute("aria-pressed", "true");
});

test("daily history uses compact totals without loading version partitions", async ({ page }) => {
  const requested = [];
  page.on("request", (request) => requested.push(request.url()));
  await page.goto("/#daily");
  await expect(page.locator("#daily-history svg")).toBeVisible();
  expect(requested.some((url) => url.endsWith("/data/adi-totals.json"))).toBe(true);
  expect(requested.some((url) => /adi-\d{4}\.json$/.test(url))).toBe(false);
});

test("daily averages, headline, date selection and CSV share the same observations", async ({ page }, testInfo) => {
  await page.route("**/data/adi-totals.json", async (route) => {
    const response = await route.fetch();
    const totals = await response.json();
    for (let day = 24; day <= 30; day++) totals[`2026-09-${day}`] = (day - 23) * 70;
    await route.fulfill({json: totals});
  });
  await page.goto("/#daily");
  await expect(page.locator("#daily-kpi")).toHaveText("280");
  await expect(page.locator("#daily-caption")).toContainText("7-day average");
  await expect(page.locator('#daily-history [data-series="moving-average-7"]')).toBeVisible();
  const card = page.locator(".secondary-card");
  await expect(card.locator(".range-label")).toHaveText("Date range");
  const navigator = card.locator(".chart-navigator");
  const overviewPath = await navigator.locator(".chart-overview-path").getAttribute("d");
  await page.locator("#daily-history-start-date").fill("2026-09-30");
  await page.locator("#daily-history-start-date").press("Tab");
  await expect(page.locator("#daily-history-end-date")).toHaveValue("2026-09-30");
  const svg = page.locator("#daily-history svg");
  await svg.focus();
  await page.keyboard.press("End");
  await expect(page.locator("#daily-history .chart-tooltip")).toContainText("280");
  await expect(page.locator("#daily-history .chart-tooltip")).toContainText("490");
  await expect(navigator.locator(".chart-overview-path")).toHaveAttribute("d", overviewPath);
  const downloaded = page.waitForEvent("download");
  await card.locator("[data-export]").click();
  const download = await downloaded;
  const csvPath = testInfo.outputPath("daily.csv");
  await download.saveAs(csvPath);
  const {readFile} = await import("node:fs/promises");
  const csv = await readFile(csvPath, "utf8");
  expect(csv).toContain('"2026-09-30","490","280"');
  expect(csv).not.toContain('"2026-09-29"');
  await card.locator('[data-card-range="all"]').click();
  await expect(page.locator("#daily-history-start-date")).toHaveValue("2026-09-01");
  await selectReport(page, "mau");
  await expect(page.locator("#monthly-history-start-date")).toBeVisible();
});

test("an incomplete latest week never becomes a partial headline average", async ({page}) => {
  await page.route("**/data/adi-totals.json", async (route) => {
    const response = await route.fetch();
    const totals = await response.json();
    delete totals["2026-09-29"];
    await route.fulfill({json: totals});
  });
  await page.goto("/#daily");
  await expect(page.locator("#daily-caption")).toContainText("incomplete observations");
  await expect(page.locator("#daily-kpi")).toHaveText("—");
});

test("daily date controls fit on mobile and reject reversed ranges", async ({page}) => {
  await page.setViewportSize({width: 375, height: 844});
  await page.goto("/#daily");
  await expect(page.locator("#daily-history-start-date")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#daily-history-start-date").fill("2026-09-20");
  await page.locator("#daily-history-start-date").press("Tab");
  await page.locator("#daily-history-end-date").fill("2026-09-10");
  await page.locator("#daily-history-end-date").press("Tab");
  await expect(page.locator('.secondary-card [role="alert"]')).toBeVisible();
  await page.locator('[data-card-range="all"]').click();
  await expect(page.locator('.secondary-card [role="alert"]')).toBeHidden();
});

test("every time chart has working date controls, including archives and funding", async ({page}) => {
  await open(page);
  const tabs = {
    daily: ["daily-history"], mau: ["monthly-history"], telemetry: ["feature-usage"],
    platforms: ["glean-platforms", "glean-locales"], addons: ["addon-adoption"],
    financials: ["monthly-donations", "annual-funding"], support: ["support-questions"],
  };
  for (const [tab, ids] of Object.entries(tabs)) {
    await selectReport(page, tab);
    for (const id of ids) {
      const card = page.locator(`.secondary-card:has(#${id})`);
      await expect(card.locator("svg.stats-chart")).toBeVisible();
      await expect(card.locator(".range-toolbar")).toBeVisible();
      await card.locator('[data-card-range="all"]').click();
      await expect(card.locator('[data-card-range="all"]')).toHaveAttribute("aria-pressed", "true");
      await expect(card.locator(id === "monthly-donations" ? ".comparison-month-range select" : 'input[type="date"]')).toHaveCount(2);
    }
    if (tab === "telemetry" || tab === "platforms") {
      await page.locator("#archive").selectOption("legacy");
      await expect(page.locator('.secondary-card:has(svg.stats-chart)').first().locator(".range-toolbar")).toBeVisible();
      await page.locator("#archive").selectOption("current");
    }
    if (tab === "telemetry") {
      await selectMetric(page, "oauth-providers");
      for (const id of ["oauth-authentication-current-issuer", "oauth-accounts"]) {
        const card = page.locator(`.secondary-card:has(#${id})`);
        await expect(card.locator("svg.stats-chart")).toBeVisible();
        await card.locator('[data-card-range="all"]').click();
        await expect(card.locator('input[type="date"]')).toHaveCount(2);
        await expect(card.locator('[data-card-range="all"]')).toHaveAttribute("aria-pressed", "true");
      }
    }
    if (tab === "financials") {
      const latest = await page.locator(".spending-allocation").textContent();
      await page.locator(".allocation-period select").selectOption("spending_2022");
      await expect(page.locator(".spending-allocation")).not.toHaveText(latest);
      await expect(page.locator(".secondary-card:has(.spending-allocation) .card-top p")).toContainText("2022");
    }
  }
});

test("OAuth Providers is a Telemetry metric with current Glean, independent breakdowns, provider filtering and range exports", async ({page}) => {
  await open(page);
  await expect(page.locator('[data-tab="oauth"]')).toHaveCount(0);
  await selectMetric(page, "oauth-providers");
  await expect(page).toHaveURL(/#telemetry\?metric=oauth-providers$/);
  await expect(page.locator('#telemetry-nav-links [data-metric="oauth-providers"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#archive")).toHaveValue("current");
  await expect(page.getByRole("heading", {name: "OAuth Providers", exact: true})).toBeVisible();
  await expect(page.locator('#telemetry-nav-links [data-metric="mail_oauth2_provider_count"]')).toHaveCount(0);
  await expect(page.locator("#oauth-grouping option")).toHaveText([
    "Provider", "Outcome", "Reason", "Release channel", "Major version", "Window type",
  ]);
  let card = page.locator('.secondary-card:has(#oauth-authentication-current-issuer)');
  await expect(card.locator(".secondary-meta")).toContainText("600 reporting clients");
  await expect(card.locator(".secondary-legend")).toContainText("accounts.google.com");
  await expect(card.locator(".secondary-legend")).toContainText("login.microsoftonline.com");
  await card.locator("summary").click();
  await expect(card.locator("tbody tr").first().locator("td")).toHaveText(["800", "400"]);
  await page.locator("#oauth-provider").selectOption("accounts.google.com");
  await page.locator("#oauth-grouping").selectOption("result");
  card = page.locator('.secondary-card:has(#oauth-authentication-current-result)');
  await expect(card.locator(".secondary-meta")).toContainText("400 reporting clients");
  await card.locator("summary").click();
  await expect(card.locator("tbody tr").first().locator("td")).toHaveText(["700", "100"]);
  await card.locator('input[id$="-start-date"]').fill("2026-09-27");
  await card.locator('input[id$="-start-date"]').press("Tab");
  await expect(card.locator("tbody tr")).toHaveCount(1);
  const downloadEvent = page.waitForEvent("download");
  await card.locator("[data-export]").click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk;
  expect(csv).toContain('"2026-09-27","700","100"');
  expect(csv).not.toContain("2026-09-06");
  const accounts = page.locator('.secondary-card:has(#oauth-accounts)');
  await expect(accounts.locator(".secondary-meta")).toContainText("400 reporting clients for this provider");
  await accounts.locator("summary").click();
  await expect(accounts.locator("tbody tr").first().locator("td")).toHaveText(["1,000"]);
  for (const dimension of ["reason", "channel", "version", "where"]) {
    await page.locator("#oauth-grouping").selectOption(dimension);
    await expect(page.locator(`#oauth-authentication-current-${dimension} svg`)).toBeVisible();
  }
  await page.setViewportSize({width: 320, height: 812});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.locator('#telemetry-nav-links [aria-current="page"]')).toHaveAttribute("data-metric", "oauth-providers");
  await expect(page.getByRole("heading", {name: "OAuth Providers", exact: true})).toBeVisible();
});

test("the old OAuth URL opens Telemetry and its Glean archive remains separate from legacy metrics", async ({page}) => {
  await page.goto("/oauth.html");
  await expect(page).toHaveURL(/\/index.html#telemetry\?metric=oauth-providers$/);
  await expect(page.locator("#oauth-charts svg").first()).toBeVisible();
  await page.locator("#archive").selectOption("legacy");
  await expect(page.locator("#oauth-grouping option")).not.toContainText(["Window type"]);
  await expect(page.locator("#oauth-charts")).not.toContainText("Accounts using OAuth");
  const card = page.locator('.secondary-card:has(#oauth-authentication-archive-issuer)');
  await expect(card.locator(".secondary-meta")).toContainText("Archived Glean");
  await expect(card.locator(".secondary-meta")).toContainText("Feb 11, 2025");
  await expect(card.locator(".range-toolbar")).toBeVisible();
  await page.locator("#oauth-provider").selectOption("accounts.google.com");
  await page.locator("#oauth-grouping").selectOption("result");
  await expect(page.locator("#oauth-authentication-archive-result svg")).toBeVisible();
  await selectMetric(page, "accounts");
  await expect(page.locator("#feature-usage svg.stats-chart")).toBeVisible();
  await expect(page.locator("#archive")).toHaveValue("current");
  await expect(page.locator('#archive option[value="legacy"]')).toHaveText("Historical · through May 2025");
  await page.locator("#archive").selectOption("legacy");
  await expect(page.locator("#feature-usage")).toBeVisible();
  await selectMetric(page, "oauth-providers");
  await expect(page.locator("#oauth-authentication-archive-result svg")).toBeVisible();
  await expect(page.locator("#archive")).toHaveValue("legacy");
  await expect(page.locator('#archive option[value="legacy"]')).toHaveText("Archived Glean · 2025 snapshot");
  await page.locator("#archive").selectOption("current");
  await expect(page.locator("#oauth-accounts svg")).toBeVisible();
  await expect(page.locator("#secondary-content")).not.toContainText("Feb 11, 2025");
});

test("OAuth provider totals remain usable when their detailed breakdowns are unavailable", async ({page}) => {
  await page.route("**/data/glean.json", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const record of Object.values(data.oauth.records)) delete record.issuers["accounts.google.com"];
    await route.fulfill({json: data});
  });
  await page.goto("/#oauth");
  await page.locator("#oauth-provider").selectOption("accounts.google.com");
  const card = page.locator('.secondary-card:has(#oauth-authentication-current-issuer)');
  await card.locator("summary").click();
  await expect(card.locator("tbody tr").first().locator("td")).toHaveText(["800"]);
  await page.locator("#oauth-grouping").selectOption("result");
  await expect(page.locator("#oauth-charts")).toContainText("No published breakdown available.");
  await expect(page.locator("#oauth-authentication-current-result")).toHaveCount(0);
  await expect(page.locator("#oauth-accounts svg")).toBeVisible();
});

test("OAuth Providers remains available when other Telemetry metrics are absent", async ({page}) => {
  await page.route("**/data/glean.json", async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.metrics = {mail_oauth2_provider_count: data.metrics.mail_oauth2_provider_count};
    await route.fulfill({json: data});
  });
  await page.goto('/#telemetry');
  await expect(page.locator('#telemetry-nav-links [aria-current="page"]')).toHaveAttribute("data-metric", 'oauth-providers');
  await expect(page.locator('#oauth-accounts svg.stats-chart')).toBeVisible();
  await expect(page.locator('#oauth-authentication-current-issuer svg.stats-chart')).toBeVisible();
  await expect(page.locator('#archive option[value="legacy"]')).toHaveText('Archived Glean · 2025 snapshot');
  await page.locator('#archive').selectOption('legacy');
  await expect(page.locator('#oauth-authentication-archive-issuer svg.stats-chart')).toBeVisible();
  await expect(page.locator('.coverage-note').filter({hasText: 'This legacy archive intentionally ends'})).toHaveCount(0);
});

test("OAuth explicitly published zero-prompt weeks do not add provider names to outcome groups", async ({page}) => {
  let removeAll = false;
  await page.route("**/data/glean.json", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const [date, record] of Object.entries(data.oauth.records)) {
      if (!removeAll && date !== "2026-09-06") continue;
      delete record.issuers["accounts.google.com"];
      record.breakdowns.issuer["accounts.google.com"] = 0;
    }
    await route.fulfill({json: data});
  });
  await page.goto("/#oauth");
  await page.locator("#oauth-provider").selectOption("accounts.google.com");
  await page.locator("#oauth-grouping").selectOption("result");
  const card = page.locator('.secondary-card:has(#oauth-authentication-current-result)');
  await expect(card.locator(".secondary-legend .legend-item")).toHaveCount(2);
  await expect(card.locator(".secondary-legend")).not.toContainText("accounts.google.com");
  await card.locator("summary").click();
  await expect(card.locator("tbody tr").filter({hasText: "2026-09-06"}).locator("td")).toHaveText(["0", "0"]);
  removeAll = true;
  await page.reload();
  await page.locator("#oauth-provider").selectOption("accounts.google.com");
  await page.locator("#oauth-grouping").selectOption("result");
  await expect(page.locator("#oauth-charts")).toContainText("No authentication prompts recorded.");
});

test("published categories remain separate and searchable beyond the old top-nine cap", async ({page}) => {
  await page.route("**/data/glean.json", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const versions = Object.fromEntries(Array.from({length: 14}, (_, i) => [`Locale ${i}`, 100 + i]));
    versions.__other__ = 40;
    for (const record of Object.values(data.locales.records)) record.versions = versions;
    await route.fulfill({json: data});
  });
  await page.goto("/#platforms");
  const card = page.locator('.secondary-card:has(#glean-locales)');
  await expect(card.locator(".secondary-legend .legend-item")).toHaveCount(15);
  await expect(card.locator(".secondary-legend")).toContainText("Locale 0");
  await expect(card.locator(".secondary-legend")).toContainText("Other (publication aggregate)");
  await card.locator('.series-selection-controls input').fill("Locale 0");
  await card.getByRole("button", {name: "Show only matching"}).click();
  await expect(card.locator('#glean-locales path[data-series="Locale 0"]')).toBeVisible();
  await expect(card.locator('#glean-locales path[data-series="Locale 13"]')).toHaveCount(0);
  await card.locator("summary").click();
  await expect(card.locator("table thead")).not.toContainText("Locale 13");
  await card.locator("[data-hidden-series]").check();
  await expect(card.locator("table thead")).toContainText("Locale 13");
});

test("share-mode CSV includes exact counts, percentages and population", async ({ page }, testInfo) => {
  await open(page);
  await page.locator(".data-table-details summary").click();
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#export-csv").click();
  const download = await downloadEvent;
  const path = testInfo.outputPath("adoption.csv");
  await download.saveAs(path);
  const { readFile } = await import("node:fs/promises");
  const csv = await readFile(path, "utf8");
  expect(csv).toContain('"Selected population"');
  expect(csv).toContain('share (%)');
  expect(csv).toContain('"65"');
});

test("received relative preset links retain their URL while resolving current dates", async ({ page }) => {
  const state = {
    grouping: "custom", mode: "percent", channels: ["esr", "release", "unknown"],
    groups: [{ id: "latest", name: "Latest ESR", latestEsr: "historical", color: "#8b5cf6" },
      { id: "remainder", name: "Everything else", remainder: true, color: "#8493a7" }],
    hiddenSeries: [], range: "6m", startDate: "2026-09-01", endDate: "2026-09-20"
  };
  const hash = `#explore?${new URLSearchParams({state: JSON.stringify(state)})}`;
  await open(page, hash);
  await expect(page.locator("#end-date")).toHaveValue("2026-09-30");
  expect(new URL(page.url()).hash).toBe(hash);
  await page.reload();
  await expect(page.locator("#end-date")).toHaveValue("2026-09-30");
  expect(new URL(page.url()).hash).toBe(hash);
  await page.locator('[data-mode="lines"]').click();
  await expect(page).not.toHaveURL(/state=/);
});

test("navigator retains full history and selected range after zooming", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  const navigator = page.locator("#explorer-chart .chart-navigator");
  await expect(navigator).toHaveAttribute("data-start", "2026-09-01");
  const path = await navigator.locator(".chart-overview-path").getAttribute("d");
  const selection = navigator.locator(".selection");
  const width = Number(await selection.getAttribute("width"));
  await page.locator("#start-date").fill("2026-09-20");
  await page.locator("#start-date").press("Tab");
  await expect.poll(async () => Number(await selection.getAttribute("width"))).toBeLessThan(width / 2);
  await expect(navigator).toHaveAttribute("data-start", "2026-09-01");
  await expect(navigator.locator(".chart-overview-path")).toHaveAttribute("d", path);
  await expect(selection).toBeVisible();
});

test('navigator dates update during dragging and resizing, then match the committed range', async ({page}) => {
  await open(page);
  await page.locator('#start-date').fill('2026-09-10');
  await page.locator('#start-date').press('Tab');
  await page.locator('#end-date').fill('2026-09-20');
  await page.locator('#end-date').press('Tab');
  const chart = page.locator('#explorer-chart');
  const label = chart.locator('.chart-range-label');
  const start = label.locator('.chart-range-start');
  const end = label.locator('.chart-range-end');
  await expect(label).toBeVisible();
  await expect(start).toHaveText('Sep 10, 2026');
  await expect(end).toHaveText('Sep 20, 2026');
  const selection = chart.locator('.chart-brush .selection');
  await selection.scrollIntoViewIfNeeded();
  const box = await selection.boundingBox();
  const dayWidth = box.width / 10;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 2 * dayWidth, box.y + box.height / 2, {steps: 5});
  await expect(start).toHaveAttribute('datetime', '2026-09-08');
  await expect(end).toHaveAttribute('datetime', '2026-09-18');
  await expect(page.locator('#start-date')).toHaveValue('2026-09-10');
  await page.mouse.up();
  await expect(page.locator('#start-date')).toHaveValue('2026-09-08');
  await expect(page.locator('#end-date')).toHaveValue('2026-09-18');
  for (const [side, days, expectedStart, expectedEnd] of [
    ['e', 3, '2026-09-08', '2026-09-21'],
    ['w', 2, '2026-09-10', '2026-09-21'],
  ]) {
    const handle = await chart.locator(`.chart-brush .handle--${side}`).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + days * dayWidth, handle.y + handle.height / 2, {steps: 5});
    await expect(start).toHaveAttribute('datetime', expectedStart);
    await expect(end).toHaveAttribute('datetime', expectedEnd);
    await page.mouse.up();
    await expect(page.locator('#start-date')).toHaveValue(expectedStart);
    await expect(page.locator('#end-date')).toHaveValue(expectedEnd);
  }
  const overview = await chart.locator('.chart-brush .overlay').boundingBox();
  await page.mouse.move(overview.x + dayWidth, overview.y + overview.height / 2);
  await page.mouse.down();
  await page.mouse.move(overview.x + 4 * dayWidth, overview.y + overview.height / 2, {steps: 5});
  await expect(start).toHaveText('Sep 2, 2026');
  await expect(end).toHaveText('Sep 5, 2026');
  await page.mouse.up();
  await expect(page.locator('#start-date')).toHaveValue('2026-09-02');
  await expect(page.locator('#end-date')).toHaveValue('2026-09-05');
  await page.setViewportSize({width: 375, height: 844});
  await expect(label).toBeVisible();
  const fits = await label.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    const chartBounds = node.parentElement.getBoundingClientRect();
    return bounds.left >= chartBounds.left && bounds.right <= chartBounds.right && node.scrollWidth <= node.clientWidth;
  });
  expect(fits).toBe(true);
  await selectReport(page, "daily");
  await expect(page.locator('#daily-history .chart-range-start')).toHaveText('Sep 1, 2026');
  await expect(page.locator('#daily-history .chart-range-end')).toHaveText('Sep 30, 2026');
});

test("unpublished categories and provider weeks remain gaps while explicit zeros stay zero", async ({page}) => {
  await page.route("**/data/glean.json", async route => {
    const response = await route.fetch(), data = await response.json();
    data.metrics = {publication: {label:"Publication test", unit:"events", records:{
      "2026-09-06": {count:100, total:5, versions:{sometimes:5, explicit:0}},
      "2026-09-27": {count:100, total:4, versions:{explicit:4}},
    }}};
    delete data.oauth.records["2026-09-06"].issuers["accounts.google.com"];
    delete data.oauth.records["2026-09-06"].breakdowns.issuer["accounts.google.com"];
    await route.fulfill({json:data});
  });
  await page.goto('/#telemetry');
  const card=page.locator('.secondary-card:has(#feature-usage)');
  await card.locator('summary').click();
  await expect(card.locator('tbody tr').filter({hasText:'2026-09-27'}).locator('td')).toHaveText(['—','4']);
  await expect(card.locator('tbody tr').filter({hasText:'2026-09-06'}).locator('td')).toHaveText(['5','0']);
  await card.locator('[data-chart-view]').selectOption('snapshot');
  await expect(card.locator('.breakdown-row').filter({hasText:'sometimes'})).toContainText('Unavailable');
  await selectMetric(page, "oauth-providers");
  await page.locator('#oauth-provider').selectOption('accounts.google.com');
  await page.locator('#oauth-grouping').selectOption('result');
  const oauth=page.locator('.secondary-card:has(#oauth-authentication-current-result)');
  await oauth.locator('summary').click();
  await expect(oauth.locator('tbody tr').filter({hasText:'2026-09-06'}).locator('td')).toHaveText(['—','—']);
});

test("prerelease build presets use version labels across historical dates", async ({page}) => {
  await open(page);
  await page.locator('#edit-groups').click();
  await page.locator('#group-preset').selectOption('prerelease-builds');
  await page.locator('#apply-preset').click();
  await expect(page.locator('#explorer-legend')).toContainText('Beta builds');
  await expect(page.locator('#chart-warning')).toContainText('this is not total Beta usage');
  await expect(page.locator('#explorer-legend')).toContainText('Nightly builds');
  await expect(page.locator('[data-series="beta-builds"] .legend-value')).toHaveText('8%');
  await expect(page.locator('[data-series="nightly-builds"] .legend-value')).toHaveText('2%');
  await expect(page.locator('.series-help')).toContainText('independently of the recorded update channel');
});
