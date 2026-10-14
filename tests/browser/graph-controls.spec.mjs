import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test.use({reducedMotion: 'reduce'});

const cardFor = (page, id) => page.locator(`.secondary-card:has(#${id})`);

async function downloadedText(page, trigger, testInfo, name) {
  const pending = page.waitForEvent('download');
  await trigger.click();
  const download = await pending;
  const path = testInfo.outputPath(name);
  await download.saveAs(path);
  return readFile(path, 'utf8');
}

test('daily legend hides on the first click and hidden-series export is explicit', async ({page}, testInfo) => {
  await page.goto('/#daily');
  const card = cardFor(page, 'daily-history');
  const average = card.getByRole('button', {name: 'Toggle 7-day moving average', exact: true});
  await expect(average).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('path[data-series="moving-average-7"]')).toHaveCount(1);
  await card.locator('summary').click();
  await expect(card.locator('thead th')).toHaveText(['Date', 'Daily observations (installations)', '7-day moving average (installations)']);

  await average.click();
  await expect(average).toHaveAttribute('aria-pressed', 'false');
  await expect(card.locator('path[data-series="moving-average-7"]')).toHaveCount(0);
  await expect(card.locator('thead th')).toHaveText(['Date', 'Daily observations (installations)']);
  const visibleOnly = await downloadedText(page, card.locator('[data-export]'), testInfo, 'daily-visible.csv');
  expect(visibleOnly).not.toContain('7-day moving average');

  await card.getByRole('checkbox', {name: 'Include hidden series in table and CSV'}).check();
  await expect(card.locator('thead th')).toHaveText(['Date', 'Daily observations (installations)', '7-day moving average (installations)']);
  await expect(card.locator('tbody tr').first().locator('td')).toHaveText(['100', '100']);
  await expect(card.locator('path[data-series="moving-average-7"]')).toHaveCount(0);
  const withHidden = await downloadedText(page, card.locator('[data-export]'), testInfo, 'daily-hidden.csv');
  expect(withHidden).toContain('"7-day moving average (installations)"');
  expect(withHidden).toContain('"2026-09-30","100","100"');
});

for (const {tab, id, unit} of [
  {tab: 'telemetry', id: 'feature-usage', unit: 'accounts'},
  {tab: 'platforms', id: 'glean-platforms', unit: 'reporting clients'},
]) {
  test(`${tab} latest breakdown preserves all categories, observation selection and genuine log zeros`, async ({page}) => {
    const categories = Object.fromEntries(Array.from({length: 28}, (_, index) => [`Category ${String(index + 1).padStart(2, '0')}`, 28 - index]));
    const latest = {...categories, 'Explicit zero': 0, __other__: 7};
    const older = Object.fromEntries(Object.entries(latest).map(([key, value]) => [key, value * 2]));
    older['Older-only category'] = 19;
    const records = {
      '2026-09-06': {count: 1000, total: 1000, versions: older},
      '2026-09-27': {count: 1000, total: 1000, versions: latest},
    };
    await page.route('**/data/glean.json', async route => {
      const response = await route.fetch();
      const data = await response.json();
      data.metrics = {accounts: {label: 'Mail accounts', kind: 'gauge', unit: 'accounts', records}};
      data.platforms = {records};
      await route.fulfill({json: data});
    });
    await page.goto(`/#${tab}`);
    const card = cardFor(page, id);
    await card.locator('[data-chart-view]').selectOption('snapshot');
    await expect(card.locator('.breakdown-row')).toHaveCount(31);
    expect(await card.locator('[data-snapshot-date] option').evaluateAll(options => options.map(option => option.value)))
      .toEqual(['2026-09-27', '2026-09-06']);
    await expect(card.getByRole('img', {name: new RegExp(`^Category 28: 1 ${unit};`)})).toHaveCount(1);
    await expect(card.getByRole('img', {name: /^Older-only category: Unavailable/})).toHaveCount(1);
    await expect(card.getByRole('img', {name: new RegExp(`^Other \\(publication aggregate\\): 7 ${unit};`)})).toHaveCount(1);
    await expect(card.locator('.secondary-meta')).toContainText('the site cannot reconstruct their individual values');

    await card.locator('[data-snapshot-date]').selectOption('2026-09-06');
    await expect(card.getByRole('img', {name: new RegExp(`^Category 01: 56 ${unit};`)})).toHaveCount(1);
    await expect(card.getByRole('img', {name: new RegExp(`^Older-only category: 19 ${unit};`)})).toHaveCount(1);
    await card.locator('[data-snapshot-scale]').selectOption('log');
    const zero = card.getByRole('img', {name: new RegExp(`^Explicit zero: 0 ${unit};`)});
    const integerTicks = await card.locator('.breakdown-axis .tick').evaluateAll(ticks => ticks.map(tick => tick.__data__));
    expect(integerTicks.length).toBeGreaterThan(0);
    expect(integerTicks.every(value => value >= 1)).toBe(true);
    expect(await card.locator('.breakdown-axis').textContent()).not.toMatch(/100m|[µμ]/);
    await expect(zero.locator('.breakdown-zero')).not.toHaveAttribute('display', 'none');
    await expect(zero.locator('.breakdown-bar')).toHaveAttribute('display', 'none');
    await expect(card.locator('.breakdown-note')).toContainText('Zero values use a baseline mark outside the log scale');

    await card.locator('.breakdown-row').first().focus();
    await page.keyboard.press('End');
    await expect(zero).toBeFocused();
    expect(await card.locator('.breakdown-viewport').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(card.locator('.breakdown-tooltip')).toContainText('Zero: shown at the baseline');
    await card.locator('[data-chart-view]').selectOption('history');
    await expect(card.locator('.breakdown-chart')).toHaveCount(0);
    await expect(card.locator('svg.stats-chart')).toBeVisible();
    await card.getByRole('button', {name: 'Lines', exact: true}).click();
    await expect(card.locator('path[data-series="Category 28"]')).toHaveCount(1);
    await expect(card.locator('path[data-series="Category 28"]')).toHaveAttribute('fill', 'none');
    await card.locator('summary').click();
    await expect(card.locator('thead th')).toHaveCount(32);
    await expect(card.locator('tbody tr').first().locator('td').first()).toHaveText('28');
    await expect(card.locator('.range-toolbar')).toBeVisible();
  });
}

const financials = {
  donations_yearly: {'2023': 1200, '2024': 9999},
  donations_monthly: {
    '2024': Object.fromEntries(Array.from({length: 12}, (_, index) => [String(index + 1), (index + 1) * 10])),
    '2025': {'1': 20, '2': 30, '3': 40},
    '2026': {'1': 100, '2': 200},
  },
  spending: [{data: [{name: 'Product development', y: 70}, {name: 'Operations', y: 30}]}],
};

async function openFunding(page) {
  await page.route('**/financials.json', route => route.fulfill({json: financials}));
  await page.goto('/#financials');
  await expect(page.locator('#monthly-donations svg.stats-chart')).toBeVisible();
}

test('monthly funding defaults to overlaid years and switches style without losing the selected months', async ({page}, testInfo) => {
  await openFunding(page);
  const card = cardFor(page, 'monthly-donations');
  await expect(card.getByRole('button', {name: 'Overlaid areas', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('path[data-series]')).toHaveCount(3);
  for (const year of ['2026', '2025', '2024']) {
    await expect(card.locator(`path[data-series="${year}"]`)).not.toHaveAttribute('fill', 'none');
  }
  await expect(card.locator('.secondary-meta')).toContainText('Years are overlaid independently, never stacked');
  await expect(card.locator('.funding-coverage-note')).toContainText('2026: Jan–Feb only (2 of 12 months)');
  await card.locator('[data-month-start]').selectOption('2000-02-01');
  await card.locator('[data-month-end]').selectOption('2000-03-01');
  const lines = card.getByRole('button', {name: 'Lines', exact: true});
  await lines.focus();
  await expect(lines.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lines.getByRole('tooltip')).toBeHidden();
  await expect(lines).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(lines).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByRole('button', {name: 'Overlaid areas', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await expect(card.locator('path[data-series="2026"]')).toHaveCount(1);
  await expect(card.locator('path[data-series="2026"]')).toHaveAttribute('fill', 'none');
  const bars = card.getByRole('button', {name: 'Grouped bars', exact: true});
  await bars.hover();
  await expect(bars.getByRole('tooltip')).toBeVisible();
  await bars.click();
  await expect(bars).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('[data-chart-mode][aria-pressed="true"]')).toHaveCount(1);
  await expect(card.locator('.chart-bar')).toHaveCount(5);
  await expect.poll(() => card.evaluate(element => {
    const high = Number(element.querySelector('.chart-bar[data-series="2026"][data-date="2000-02-01"]').getAttribute('height'));
    const low = Number(element.querySelector('.chart-bar[data-series="2024"][data-date="2000-02-01"]').getAttribute('height'));
    return low > 0 ? high / low : 0;
  })).toBeCloseTo(10, 4);
  await expect(card.locator('[data-month-start]')).toHaveValue('2000-02-01');
  await expect(card.locator('[data-month-end]')).toHaveValue('2000-03-01');
  await card.locator('summary').click();
  await expect(card.locator('thead th')).toHaveText(['Month', '2026 (USD)', '2025 (USD)', '2024 (USD)']);
  await expect(card.locator('tbody tr').first()).toHaveText('March—4030');
  await expect(card.locator('tbody tr').last()).toHaveText('February2003020');
  const csv = await downloadedText(page, card.locator('[data-export]'), testInfo, 'funding-months.csv');
  expect(csv).toContain('"Month","2026 (USD)","2025 (USD)","2024 (USD)"');
  expect(csv).toContain('"February","200","30","20"');
  expect(csv).toContain('"March","","40","30"');
  expect(csv).not.toContain('2000');
  expect(csv).not.toMatch(/\d{4}-\d{2}-\d{2}/);
});

test('annual funding labels partial years and compares identical reported months', async ({page}) => {
  await openFunding(page);
  let card = cardFor(page, 'annual-funding');
  await expect(card.getByRole('button', {name: 'Grouped bars', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('.chart-bar[data-partial="true"]')).toHaveCount(2);
  await expect(card.locator('.funding-coverage-note')).toContainText('2025: Jan–Mar only (3 of 12 months)');
  await expect(card.locator('.funding-coverage-note')).toContainText('2026: Jan–Feb only (2 of 12 months)');
  await expect(card.locator('.funding-coverage-note')).toContainText('Incomplete years are not comparable with full-year totals');
  await card.locator('[data-card-range="5y"]').click();
  await expect(card.locator('.chart-axis-x .tick text')).toHaveText(['2023', '2024', '2025', '2026']);
  await card.locator('summary').click();
  await expect(card.locator('tbody tr td')).toHaveText(['300', '90', '9,999', '1,200']);
  await page.locator('#funding-annual-comparison').selectOption('same-months');
  card = cardFor(page, 'annual-funding');
  await expect(card.locator('h3')).toHaveText('Donations for the same reported months');
  await expect(card.locator('.funding-coverage-note')).toContainText("Jan–Feb, matching 2026's reported months");
  await expect(card.locator('.funding-coverage-note')).toContainText('excluded: 2023');
  await expect(card.locator('.chart-bar')).toHaveCount(3);
  await expect(card.locator('.chart-bar[data-partial="true"]')).toHaveCount(0);
  await card.locator('summary').click();
  await expect(card.locator('tbody tr td')).toHaveText(['300', '50', '30']);
});

test('earlier add-on update-request estimates render their own observations and percentages', async ({page}) => {
  await page.route('**/2020_addon_stats.json', route => route.fulfill({json: {
    '2018-01-01': {total: 100, addon_count: 20, minustop10_count: 10},
    '2018-01-02': {total: 200, addon_count: 100, minustop10_count: 30},
  }}));
  await page.goto('/#addons');
  await page.locator('#archive').selectOption('updates');
  const card = cardFor(page, 'addon-adoption');
  await expect(card.locator('.card-top p')).toHaveText('Earlier update-request estimates · share of installations');
  await expect(card.locator('path[data-series]')).toHaveCount(2);
  for (const path of await card.locator('path[data-series]').all()) await expect(path).toHaveAttribute('d', /^M/);
  await expect(page.locator('#addon-adoption-start-date')).toHaveValue('2018-01-01');
  await expect(page.locator('#addon-adoption-end-date')).toHaveValue('2018-01-02');
  await card.locator('summary').click();
  await expect(card.locator('tbody tr').first().locator('td')).toHaveText(['50', '15']);
  await expect(card.locator('tbody tr').last().locator('td')).toHaveText(['20', '10']);
  await expect(card.locator('.secondary-meta')).toContainText('must not be spliced into the later telemetry or Glean series');
});


test('log breakdown keeps a count of one visible and supports fractional metrics explicitly', async ({page}) => {
  await page.goto('/#daily');
  await expect(page.locator('#daily-history svg.stats-chart')).toBeVisible();
  await page.evaluate(async () => {
    const {renderBreakdown} = await import('/media/js/breakdown.mjs');
    const host = document.createElement('div');
    host.id = 'log-boundary-fixture';
    host.style.width = '640px';
    document.body.append(host);
    window.logBoundaryChart = renderBreakdown(host, [
      {id: 'one', name: 'One account', value: 1},
      {id: 'zero', name: 'Zero accounts', value: 0},
    ], {scale: 'log', unit: 'accounts'});
  });
  const chart = page.locator('#log-boundary-fixture');
  const countOne = chart.getByRole('img', {name: 'One account: 1 accounts', exact: true});
  await expect(countOne.locator('.breakdown-point')).not.toHaveAttribute('display', 'none');
  await expect(countOne.locator('.breakdown-point')).toHaveAttribute('r', '3');
  const zero = chart.getByRole('img', {name: 'Zero accounts: 0 accounts', exact: true});
  await expect(zero.locator('.breakdown-zero')).not.toHaveAttribute('display', 'none');
  await expect(zero.locator('.breakdown-point')).toHaveAttribute('display', 'none');
  expect(await chart.locator('.breakdown-axis .tick').evaluateAll(ticks => ticks.every(tick => tick.__data__ >= 1))).toBe(true);
  for (const options of [{integerValues: false, unit: 'accounts'}, {integerValues: undefined, unit: 'percent'}]) {
    await page.evaluate(options => window.logBoundaryChart.update([
      {id: 'fraction', name: 'Small value', value: 0.01},
      {id: 'one', name: 'One', value: 1},
    ], options), options);
    const fraction = chart.getByRole('img', {name: /^Small value: 0.01/});
    expect(Number(await fraction.locator('.breakdown-bar').getAttribute('width'))).toBeGreaterThan(0);
    expect(await chart.locator('.breakdown-axis .tick').evaluateAll(ticks => ticks.some(tick => tick.__data__ < 1))).toBe(true);
  }
  await page.evaluate(() => window.logBoundaryChart.destroy());
  await expect(chart.locator('.breakdown-chart')).toHaveCount(0);
});

test('area charts rank the latest observed values, preserve gaps and keep hover markers on the sorted stack', async ({page}) => {
  await page.goto('/#daily');
  await expect(page.locator('#daily-history svg.stats-chart')).toBeVisible();
  await page.evaluate(async () => {
    const {renderChart} = await import('/media/js/chart.mjs');
    const host = document.createElement('div');
    host.id = 'area-ranking-fixture'; host.style.width = '640px';
    document.body.append(host);
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03'];
    window.areaRankingSeries = [
      {id: 'cutoff', name: '128 and below', shares: [60, 20.7, null]},
      {id: 'release', name: '153', shares: [25, 62.5, null]},
      {id: 'beta', name: 'Beta', shares: [15, 16.8, null]},
    ].map(({shares, ...item}) => ({...item, color: '#2563eb', values: shares.map((percent, index) => ({date: dates[index], value: percent == null ? null : percent * 10, percent, total:1000, missing:percent == null}))}));
    window.areaRankingChart = renderChart(host, window.areaRankingSeries, {mode:'percent', animate:false, totalLabel:'Selected population'});
  });
  const fixture = page.locator('#area-ranking-fixture');
  for (const mode of ['percent', 'count', 'area']) {
    await page.evaluate(mode => window.areaRankingChart.update(window.areaRankingSeries, {mode}), mode);
    const paths = fixture.locator('path[data-series]');
    const ids = await paths.evaluateAll(paths => paths.map(path => path.dataset.series));
    expect(ids).toEqual(mode === 'area' ? ['release', 'cutoff', 'beta'] : ['beta', 'cutoff', 'release']);
    const geometry = await fixture.locator('path[data-series="release"]').evaluate(path => path.__data__.geometry);
    expect(geometry[1].bottom).toBeCloseTo(mode === 'area' ? 0 : mode === 'percent' ? 37.5 : 375);
    expect(geometry[1].top).toBeCloseTo(mode === 'area' ? 625 : mode === 'percent' ? 100 : 1000);
    expect(geometry[2].value).toBe(null);
    await page.evaluate(() => window.areaRankingChart.inspectDate('2026-09-02'));
    await expect(fixture.locator('.chart-tooltip-name')).toHaveText(['153', '128 and below', 'Beta']);
    await expect(fixture.locator('.chart-tooltip-total')).toHaveText('Selected population: 1,000');
    const markerError = await fixture.evaluate(host => {
      const marker = [...host.querySelectorAll('.chart-hover-marker')].find(marker => marker.__data__.series.id === 'release');
      const markerY = Number(/translate\([^,]+,([^p]+)px\)/.exec(marker.style.transform)[1]) + marker.getBoundingClientRect().height / 2;
      const coordinates = host.querySelector('path[data-series="release"]').getAttribute('d').match(/^M[^L]+L[^,]+,([^LZ]+)/);
      return Math.abs(markerY - Number(coordinates[1]));
    });
    expect(markerError).toBeLessThan(0.01);
    expect(await fixture.locator('.chart-tooltip-swatch').first().evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(12);
    await page.evaluate(() => window.areaRankingChart.inspectDate('2026-09-01'));
    await expect(fixture.locator('.chart-tooltip-name')).toHaveText(['128 and below', '153', 'Beta']);
    expect(await paths.evaluateAll(paths => paths.map(path => path.dataset.series))).toEqual(ids);
    await page.evaluate(() => window.areaRankingChart.inspectDate('2026-09-03'));
    await expect(fixture.locator('.chart-tooltip')).toContainText('No observation');
  }
  await page.evaluate(() => window.areaRankingChart.update(window.areaRankingSeries, {mode:'percent', endDate:'2026-09-01'}));
  expect(await fixture.locator('path[data-series]').evaluateAll(paths => paths.map(path => path.dataset.series))).toEqual(['beta', 'release', 'cutoff']);
  await page.evaluate(() => window.areaRankingChart.destroy());
});

test('secondary area legends keep ranked toggles and filtering tied to their series', async ({page}) => {
  await page.route('**/data/glean.json', async route => {
    const response = await route.fetch(); const data = await response.json();
    for (const record of Object.values(data.platforms.records))
      record.versions = {Small:1, Largest:60, Middle:25, Remaining:13, Tiny:1, Zero:0};
    await route.fulfill({json:data});
  });
  await page.goto('/#platforms');
  const card = cardFor(page, 'glean-platforms');
  await expect(card.locator('svg.stats-chart')).toBeVisible();
  for (const name of ['Overlaid areas', 'Stacked counts', 'Stacked shares']) {
    await card.getByRole('button', {name, exact:true}).click();
    await expect(card.locator('.secondary-legend .legend-item')).toHaveText(['Largest', 'Middle', 'Remaining', 'Small', 'Tiny', 'Zero']);
  }
  const largest = card.getByRole('button', {name:'Toggle Largest', exact:true});
  await largest.click();
  await expect(largest).toHaveAttribute('aria-pressed', 'false');
  await expect(card.locator('path[data-series="Largest"]')).toHaveCount(0);
  await expect(card.locator('path[data-series="Small"]')).toHaveCount(1);
  await largest.click();
  await expect(card.locator('path[data-series="Largest"]')).toHaveCount(1);
  await card.locator('.series-selection-controls input').fill('Small');
  await expect(card.getByRole('button', {name:'Toggle Small', exact:true})).toBeVisible();
  await expect(largest).toBeHidden();
  await card.getByRole('button', {name:'Show only matching', exact:true}).click();
  await expect(card.locator('path[data-series]')).toHaveCount(1);
  await expect(card.locator('path[data-series="Small"]')).toHaveCount(1);
});

test('stacked charts retain published segments when another category is unpublished', async ({page}) => {
  await page.goto('/#daily');
  await expect(page.locator('#daily-history svg.stats-chart')).toBeVisible();
  await page.evaluate(async () => {
    const {renderChart} = await import('/media/js/chart.mjs');
    const host = document.createElement('div');
    host.id = 'missing-stack-fixture';
    host.style.width = '640px';
    document.body.append(host);
    const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
    const values = (counts, unpublished = false) => counts.map((value, index) => ({
      date: dates[index], value, percent: value, unpublished: unpublished && value === null,
    }));
    window.missingStackSeries = [
      {id: 'rare', name: 'Occasional category', color: '#f97316', values: values([null, 5, null, 8], true)},
      {id: 'known', name: 'Published category', color: '#2563eb', values: values([20, 25, null, 40])},
    ];
    window.missingStackChart = renderChart(host, window.missingStackSeries, {mode: 'count', animate: false});
  });
  const fixture = page.locator('#missing-stack-fixture');
  for (const mode of ['count', 'percent']) {
    await page.evaluate(mode => {
      window.missingStackChart.update(window.missingStackSeries, {mode});
      window.missingStackChart.inspectDate('2026-09-01');
    }, mode);
    const known = await fixture.locator('path[data-series="known"]').evaluate(path =>
      path.__data__.geometry.map(({value, bottom, top}) => ({value, bottom, top})));
    expect(known).toEqual([
      {value: 20, bottom: 0, top: 20},
      {value: 25, bottom: 5, top: 30},
      {value: null, bottom: 0, top: 0},
      {value: 40, bottom: 8, top: 48},
    ]);
    const rare = await fixture.locator('path[data-series="rare"]').evaluate(path =>
      path.__data__.geometry.map(({value}) => value));
    expect(rare).toEqual([null, 5, null, 8]);
    await expect(fixture.locator('path[data-series="known"]')).toHaveAttribute('d', /^M/);
    await expect(fixture.locator('.chart-crosshair .chart-hover-marker')).toHaveCount(1);
    await expect(fixture.locator('.chart-tooltip')).toContainText('Not published');
    await expect(fixture.locator('.chart-tooltip')).toContainText('Published category');
    await expect(fixture.locator('.chart-tooltip')).toContainText(mode === 'percent' ? '20%' : '20');
  }
  await page.evaluate(() => window.missingStackChart.destroy());
});

test('standalone SVG exports name every visible series and wrap narrow legends', async ({page}) => {
  await page.goto('/#daily');
  await expect(page.locator('#daily-history svg.stats-chart')).toBeVisible();
  const result = await page.evaluate(async () => {
    const {renderChart} = await import('/media/js/chart.mjs');
    const host = document.createElement('div');
    host.style.width = '320px';
    document.body.append(host);
    const series = Array.from({length: 15}, (_, index) => ({
      id: `export-series-${index}`,
      name: index === 0 ? 'A very long donation comparison label with enough words to wrap on a narrow chart' : index === 1 ? 'UnbrokenLabel'.repeat(8) : `Donation year ${2010 + index}`,
      color: `hsl(${index * 23}, 65%, 45%)`,
      visible: index !== 14,
      values: [{date: '2026-01-01', value: index + 1}, {date: '2026-02-01', value: index + 2}],
    }));
    const chart = renderChart(host, series, {title: 'Donation comparison by year', mode: 'area', animate: false});
    const sourceGeometry = [...host.querySelectorAll('path[data-series]')].map(path => path.getAttribute('d'));
    const clipGeometry = svg => ['x', 'y', 'width', 'height'].map(name => svg.querySelector('clipPath rect').getAttribute(name));
    const sourceClip = clipGeometry(host);
    const output = chart.exportSVG();
    const documentSVG = new DOMParser().parseFromString(output, 'image/svg+xml');
    const exported = document.importNode(documentSVG.documentElement, true);
    document.body.append(exported);
    const width = Number(exported.getAttribute('width')), height = Number(exported.getAttribute('height'));
    const result = {
      parserErrors: documentSVG.querySelectorAll('parsererror').length,
      title: exported.querySelector('.chart-export-title').textContent,
      names: [...exported.querySelectorAll('.chart-export-legend > g')].map(group => group.getAttribute('aria-label')),
      expectedNames: series.filter(item => item.visible).reverse().map(item => item.name),
      hiddenMarks: exported.querySelectorAll('[data-series="export-series-14"]').length,
      sourceGeometry, exportedGeometry: [...exported.querySelectorAll('path[data-series]')].map(path => path.getAttribute('d')),
      sourceClip, exportedClip: clipGeometry(exported),
      viewBox: exported.getAttribute('viewBox'), width, height,
      lineBounds: [...exported.querySelectorAll('.chart-export-title tspan, .chart-export-legend-label tspan')].map(line => {
        const box = line.getBBox(); return {left: box.x, right: box.x + box.width, bottom: box.y + box.height};
      }),
      legendColors: [...exported.querySelectorAll('.chart-export-legend rect')].map(rect => rect.getAttribute('fill')),
      wrappedLongLabels: [...exported.querySelectorAll('.chart-export-legend-label')].slice(-2).every(label => label.querySelectorAll('tspan').length > 1),
    };
    exported.remove(); chart.destroy(); host.remove();
    return result;
  });
  expect(result.parserErrors).toBe(0);
  expect(result.title).toBe('Donation comparison by year');
  expect(result.names).toEqual(result.expectedNames);
  expect(result.names).toHaveLength(14);
  expect(result.hiddenMarks).toBe(0);
  expect(result.exportedGeometry).toEqual(result.sourceGeometry);
  expect(result.exportedClip).toEqual(result.sourceClip);
  expect(result.viewBox).toBe(`0 0 ${result.width} ${result.height}`);
  expect(result.width).toBe(320);
  expect(result.height).toBeGreaterThan(350);
  expect(result.wrappedLongLabels).toBe(true);
  expect(result.legendColors.every(color => !color.includes('var('))).toBe(true);
  for (const box of result.lineBounds) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(result.width);
    expect(box.bottom).toBeLessThanOrEqual(result.height);
  }
});
