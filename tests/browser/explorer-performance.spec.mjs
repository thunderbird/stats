import {test, expect} from '@playwright/test';

test.use({reducedMotion: 'reduce'});

test('long zero runs have bounded markers and visibility redraws reuse the date index', async ({page}) => {
  await page.goto('/#daily');
  const result = await page.evaluate(async () => {
    const {renderChart} = await import('/media/js/chart.mjs');
    const host = document.createElement('div');
    host.style.width = '900px';
    document.body.append(host);
    const dates = Array.from({length: 1000}, (_, index) => new Date(Date.UTC(2023, 0, 1 + index)).toISOString().slice(0, 10));
    let dateReads = 0;
    const series = Array.from({length: 30}, (_, group) => ({
      id: String(group), name: `Version ${group}`, color: '#8b5cf6',
      values: dates.map((date, index) => ({
        get date() { dateReads++; return date; },
        value: index === 400 || index === 410 || index === 505 ? 3 : index >= 500 && index <= 510 ? null : 0,
      })),
    }));
    const chart = renderChart(host, series, {mode: 'lines', animate: false});
    const marks = host.querySelectorAll('.chart-point').length;
    const isolated = host.querySelectorAll('.single-observation').length;
    chart.inspectDate(dates[0]);
    const zeroText = host.querySelector('.chart-tooltip-item strong').textContent;
    chart.inspectDate(dates[502]);
    const gapText = host.querySelector('.chart-tooltip-item strong').textContent;
    dateReads = 0;
    chart.update(series.map((item, index) => ({...item, visible: index % 2 === 0})));
    const readsOnToggle = dateReads;
    const extended = series.map((item, index) => index ? item : {...item, values: [...item.values, {date: '2026-01-01', value: 7}]});
    chart.update(extended);
    chart.inspectDate('2026-01-01');
    const newValue = host.querySelector('.chart-tooltip-item strong').textContent;
    chart.destroy();
    host.remove();
    return {marks, isolated, zeroText, gapText, readsOnToggle, newValue};
  });
  expect(result.marks).toBeLessThan(500);
  expect(result.isolated).toBe(30);
  expect(result.zeroText).toBe('0');
  expect(result.gapText).toBe('No observation');
  expect(result.readsOnToggle).toBe(0);
  expect(result.newValue).toBe('7');
});

test('hover on the same day leaves tooltip content alone and a new day reuses its rows', async ({page}) => {
  await page.goto('/#daily');
  const result = await page.evaluate(async () => {
    const {renderChart} = await import('/media/js/chart.mjs');
    const host = document.createElement('div');
    host.style.width = '900px';
    document.body.append(host);
    const chart = renderChart(host, [{id: 'one', name: 'One', values: [
      {date: '2026-01-01', value: 1}, {date: '2026-01-02', value: 2}, {date: '2026-01-03', value: 3},
    ]}], {mode: 'lines', animate: false});
    chart.inspectDate('2026-01-02');
    const tooltip = host.querySelector('.chart-tooltip');
    const original = tooltip.querySelector('li');
    let mutations = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(tooltip, {subtree: true, childList: true, characterData: true});
    const svg = host.querySelector('svg').getBoundingClientRect();
    const interaction = host.querySelector('.chart-interaction');
    const move = x => interaction.dispatchEvent(new PointerEvent('pointermove', {clientX: svg.left + x, clientY: svg.top + 80}));
    for (let index = 0; index < 20; index++) move(470);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const sameDayMutations = mutations;
    move(880);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const reusedRow = tooltip.querySelector('li') === original;
    const changedValue = tooltip.querySelector('li strong').textContent;
    observer.disconnect();
    chart.destroy();
    host.remove();
    return {sameDayMutations, reusedRow, changedValue};
  });
  expect(result).toEqual({sameDayMutations: 0, reusedRow: true, changedValue: '3'});
});

test('closing pinned details suppresses hover until the pointer leaves the plot or selects again', async ({page}) => {
  await page.setViewportSize({width: 1000, height: 1000});
  await page.goto('/#explore');
  const chart = page.locator('#explorer-chart');
  const tooltip = chart.locator('.chart-tooltip');
  await chart.locator('.chart-interaction').scrollIntoViewIfNeeded();
  const plot = await chart.locator('.chart-interaction').boundingBox();
  await page.mouse.click(plot.x + plot.width * 0.7, plot.y + plot.height * 0.5);
  await expect(tooltip).toHaveAttribute('data-pinned', 'true');
  const close = chart.getByRole('button', {name: 'Close chart details'});
  const button = await close.boundingBox();
  const point = {x: button.x + button.width / 2, y: button.y + button.height / 2};
  await close.click();
  await expect(tooltip).toBeHidden();
  await page.mouse.move(point.x + 1, point.y + 1);
  await expect(tooltip).toBeHidden();
  await page.mouse.click(point.x + 1, point.y + 1);
  await expect(tooltip).toHaveAttribute('data-pinned', 'true');
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.move(point.x + 2, point.y + 2);
  await expect(tooltip).toBeHidden();
  const svg = await chart.locator('svg').boundingBox();
  await page.mouse.move(svg.x + 1, svg.y + 1);
  await page.mouse.move(plot.x + plot.width - 2, plot.y + plot.height * 0.5);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveAttribute('data-pinned', 'false');
});

for (const width of [1000, 390]) {
  test(`padded charts align endpoint markers and select the latest day from the right gutter at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await page.goto('/#daily');
    await expect(page.locator('#daily-history svg')).toBeVisible();
    await page.evaluate(async () => {
      const {renderChart} = await import('/media/js/chart.mjs');
      const host = document.createElement('div');
      host.id = 'padded-chart-fixture';
      host.style.cssText = 'width:100%;max-width:960px;padding:0 14px;box-sizing:border-box';
      document.body.append(host);
      const dates = Array.from({length: 365}, (_, day) => new Date(Date.UTC(2026, 0, day + 1)).toISOString().slice(0, 10));
      const series = [60, 25, 15].map((value, index) => ({id: String(index), name: `Series ${index}`, color: ['#8b5cf6', '#20b1c8', '#a7b919'][index],
        values: dates.map(date => ({date, value, percent: value, total: 100}))}));
      window.paddedChart = renderChart(host, series, {mode: 'percent', animate: false,
        onDateSelect: date => { window.selectedChartDate = date; }});
    });
    const chart = page.locator('#padded-chart-fixture');
    const svg = chart.locator('svg');
    await svg.scrollIntoViewIfNeeded();
    const box = await svg.boundingBox();
    const plot = await chart.locator('.chart-interaction').boundingBox();
    // This lies to the right of the drawn data, giving the final day a usable target.
    await page.mouse.click(box.x + box.width - 6, plot.y + plot.height * 0.5);
    await expect(chart.locator('.chart-tooltip-header')).toContainText('Dec 31, 2026');
    expect(await page.evaluate(() => window.selectedChartDate)).toBe('2026-12-31');
    const alignment = await chart.evaluate(host => {
      const svg = host.querySelector('svg');
      const path = host.querySelector('path[data-series]');
      const bounds = path.getBBox();
      const end = new DOMPoint(bounds.x + bounds.width, bounds.y).matrixTransform(svg.getScreenCTM());
      const marker = host.querySelector('.chart-hover-marker').getBoundingClientRect();
      const clip = host.querySelector('clipPath rect').getBBox();
      const clipEnd = new DOMPoint(clip.x + clip.width, clip.y).matrixTransform(svg.getScreenCTM());
      return {markerError: Math.abs(marker.x + marker.width / 2 - end.x),
        pathError: Math.abs(end.x - clipEnd.x), scaleError: Math.abs(svg.getBoundingClientRect().width - svg.viewBox.baseVal.width)};
    });
    expect(alignment.markerError).toBeLessThan(0.1);
    expect(alignment.pathError).toBeLessThan(0.1);
    expect(alignment.scaleError).toBeLessThan(0.1);
    await page.mouse.click(plot.x + 2, plot.y + plot.height * 0.5);
    expect(await page.evaluate(() => window.selectedChartDate)).toBe('2026-01-01');
    await page.evaluate(() => window.paddedChart.destroy());
    await expect(chart.locator('.chart-stage')).toHaveCount(0);
  });
}

test('tooltip share thresholds retain exact boundary values, full stack positions and population totals', async ({page}) => {
  await page.goto('/#daily');
  const result = await page.evaluate(async () => {
    const {renderChart} = await import('/media/js/chart.mjs');
    const host = document.createElement('div');
    host.style.width = '900px';
    document.body.append(host);
    const series = [
      {id: 'tiny', name: 'Tiny version', value: 99, percent: 0.099},
      {id: 'boundary', name: 'Boundary version', value: 100, percent: 0.1},
      {id: 'large', name: 'Large version', value: 99801, percent: 99.801},
    ].map(({value, percent, ...series}) => ({...series, color: '#8b5cf6', values: ['2026-01-01', '2026-01-02'].map(date => ({date, value, percent, total: 100000}))}));
    const chart = renderChart(host, series, {mode: 'percent', animate: false, tooltipMinPercent: 0.1, totalLabel: 'Selected population'});
    chart.inspectDate('2026-01-01');
    const names = () => [...host.querySelectorAll('.chart-tooltip-name')].map(node => node.textContent);
    const shares = names();
    const live = host.querySelector('[aria-live]').textContent;
    const marker = [...host.querySelectorAll('.chart-hover-marker')].find(node => node.__data__.series.id === 'boundary');
    const markerY = Number(/translate\([^,]+,([^p]+)px\)/.exec(marker.style.transform)[1]) + marker.getBoundingClientRect().height / 2;
    const stackY = Number(/^M[^,]+,([^L]+)/.exec(host.querySelector('path[data-series="boundary"]').getAttribute('d'))[1]);
    const stackError = Math.abs(markerY - stackY);
    const modes = [];
    for (const mode of ['count', 'lines']) {
      chart.update(series, {mode});
      chart.inspectDate('2026-01-01');
      modes.push(names());
    }
    chart.update(series.map(series => ({...series, visible: series.id === 'tiny'})));
    chart.inspectDate('2026-01-01');
    const emptyRows = names();
    const emptyText = host.querySelector('.chart-tooltip').textContent;
    const total = host.querySelector('.chart-tooltip-total').textContent;
    chart.destroy(); host.remove();
    return {shares, live, stackError, modes, emptyRows, emptyText, total};
  });
  expect(result.shares).toEqual(['Large version', 'Boundary version']);
  expect(result.live).not.toContain('Tiny version');
  expect(result.stackError).toBeLessThan(0.01);
  expect(result.modes).toEqual([result.shares, result.shares]);
  expect(result.emptyRows).toEqual([]);
  expect(result.emptyText).toContain('No shares at or above 0.1%');
  expect(result.total).toBe('Selected population: 100,000');
});

for (const width of [1000, 390]) {
  test(`large tooltips retain scrolling, missing values and keyboard navigation at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 800});
    await page.goto('/#daily');
    await page.evaluate(async () => {
      const {renderChart} = await import('/media/js/chart.mjs');
      const host = document.createElement('div');
      host.id = 'large-tooltip-fixture';
      host.style.width = '100%';
      document.body.append(host);
      const series = Array.from({length: 1000}, (_, index) => ({
        id: String(index), name: `Version ${index}`, color: '#8b5cf6',
        values: ['2026-01-01', '2026-01-02'].map((date, day) => ({
          date, value: index >= 998 ? null : index === 997 ? 0 : 1000 - index + day,
          percent: index >= 998 ? null : index === 997 ? 0 : 0.1,
          unpublished: index === 999, partial: index === 500, note: index === 500 ? 'Incomplete day' : '',
        })),
      }));
      window.largeTooltipChart = renderChart(host, series, {mode: 'percent', animate: false});
    });
    const chart = page.locator('#large-tooltip-fixture');
    const svg = chart.locator('svg');
    const tooltip = chart.locator('.chart-tooltip');
    const rows = tooltip.locator('.chart-tooltip-item');
    await svg.focus();
    await page.keyboard.press('Enter');
    await expect(tooltip).toHaveAttribute('data-pinned', 'true');
    await expect(tooltip).toHaveAttribute('data-placement', width < 520 ? 'below' : 'overlay');
    await expect(rows.first()).toContainText('Version 0');
    await expect(rows.first()).toHaveAttribute('aria-setsize', '1000');
    expect(await rows.count()).toBeLessThan(25);

    // Move into the list, retaining the marker's full-stack position even when
    // all the preceding series have scrolled out of the rendered row window.
    await tooltip.evaluate(element => { element.scrollTop = 500 * 40; });
    const middle = rows.filter({has: page.locator('.chart-tooltip-name', {hasText: /^Version 500$/})});
    await expect(middle).toContainText('Partial period · Incomplete day');
    await expect(middle).toHaveAttribute('aria-posinset', '501');
    const marker = chart.locator('.chart-hover-marker').filter({visible: true});
    expect(await marker.count()).toBeLessThan(25);
    const stackPosition = await chart.evaluate(element => {
      const mark = [...element.querySelectorAll('.chart-hover-marker')].find(mark => mark.__data__.series.id === '500');
      const path = element.querySelector('path[data-series="500"]').getAttribute('d');
      const y = Number(/^M[^,]+,([^L]+)/.exec(path)[1]);
      const markerY = Number(/translate\([^,]+,([^p]+)px\)/.exec(mark.style.transform)[1]) + mark.getBoundingClientRect().height / 2;
      return Math.abs(y - markerY);
    });
    expect(stackPosition).toBeLessThan(0.01);

    // Scrolling is controlled from either the chart keyboard or the details.
    const scrollBefore = await tooltip.evaluate(element => element.scrollTop);
    await page.keyboard.press('PageDown');
    expect(await tooltip.evaluate(element => element.scrollTop)).toBeGreaterThan(scrollBefore);
    await tooltip.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(rows.last()).toContainText('Not published');
    await expect(rows.filter({hasText: 'Version 998'})).toContainText('No observation');
    await expect(rows.filter({hasText: 'Version 997'}).locator('strong')).toHaveText('0%');
    expect(await rows.count()).toBeLessThan(25);
    const bottomScroll = await tooltip.evaluate(element => element.scrollTop);
    const plotBefore = await svg.locator('g[clip-path]').evaluate(element => element.outerHTML);
    await page.keyboard.press('ArrowRight');
    await expect(tooltip.locator('.chart-tooltip-header')).toContainText('Jan 2, 2026');
    await expect(rows.last()).toContainText('Not published');
    expect(await tooltip.evaluate(element => element.scrollTop)).toBeCloseTo(bottomScroll, 0);
    expect(await svg.locator('g[clip-path]').evaluate(element => element.outerHTML)).toBe(plotBefore);
    await expect(chart.locator('[aria-live]')).toContainText('Version 999: Not published');
    await tooltip.getByRole('button', {name: 'Close chart details'}).click();
    await expect(tooltip).toBeHidden();
    await expect(svg).toBeFocused();
    await page.evaluate(() => window.largeTooltipChart.destroy());
    await expect(chart.locator('.chart-crosshair')).toHaveCount(0);
  });
}

test('legend and count/share changes reuse the calculation while filters invalidate it', async ({page}) => {
  const profiler = await page.context().newCDPSession(page);
  await profiler.send('Profiler.enable');
  await profiler.send('Profiler.startPreciseCoverage', {callCount: true, detailed: true});
  const buildCalls = async () => {
    const coverage = await profiler.send('Profiler.takePreciseCoverage');
    return coverage.result.filter(script => script.url.endsWith('/explorer-model.mjs'))
      .flatMap(script => script.functions).filter(fn => fn.functionName === 'buildSeries')
      .reduce((sum, fn) => sum + fn.ranges[0].count, 0);
  };
  await page.goto('/#explore');
  const first = page.locator('#explorer-legend [data-series]').first();
  await expect(first).toBeVisible();
  expect(await buildCalls()).toBeGreaterThan(0);
  await first.evaluate(element => { window.originalLegendButton = element; });
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-mode="count"]').click();
  await expect(page.locator('[data-mode="count"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await buildCalls()).toBe(0);
  expect(await first.evaluate(element => element === window.originalLegendButton)).toBe(true);
  await page.locator('#reset-hidden').click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#grouping').selectOption('channels');
  await expect(page.locator('#explorer-legend')).toContainText('ESR');
  expect(await buildCalls()).toBeGreaterThan(0);
  await page.locator('[data-mode="lines"]').click();
  await expect(page.locator('[data-mode="lines"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await buildCalls()).toBeGreaterThan(0);
  await profiler.send('Profiler.stopPreciseCoverage');
});

test('dense legend filters leave chart geometry untouched and rapid selections share one redraw', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('tb-stats-view', JSON.stringify({grouping: 'versions'})));
  await page.route('**/data/adi-2026.json', async route => {
    const data = await (await route.fetch()).json();
    const versions = Object.fromEntries(Array.from({length: 1000}, (_, index) => [`154.${index}b1`, 1]));
    for (const record of Object.values(data)) {
      record.count = 1000000;
      record.channels = {release: {'157.0': 999000}, beta: versions};
      record.versions = {'157.0': 999000, ...versions};
    }
    await route.fulfill({json: data});
  });
  await page.goto('/#explore');
  const legend = page.locator('#explorer-legend');
  await expect(legend.locator('button')).toHaveCount(1);
  await expect(page.locator('#legend-status')).toContainText('1 of 1001 series listed');
  const originalPlot = await page.locator('#explorer-chart g[clip-path]').evaluate(element => element.outerHTML);
  await page.locator('#legend-show-small-versions').check();
  await expect(legend.locator('button')).toHaveCount(1001);
  await page.locator('#legend-search').fill('154.999b1');
  await expect(legend.locator('button')).toHaveCount(1);
  const sameQueryMutations = await page.evaluate(async () => {
    const mutations = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(document.querySelector('#explorer-legend'), {subtree: true, childList: true, characterData: true, attributes: true});
    document.querySelector('#legend-search').dispatchEvent(new Event('input', {bubbles: true}));
    await Promise.resolve();
    observer.disconnect();
    return mutations.length;
  });
  expect(sameQueryMutations).toBe(0);
  expect(await page.locator('#explorer-chart g[clip-path]').evaluate(element => element.outerHTML)).toBe(originalPlot);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const redraws = await legend.locator('button').evaluate(async button => {
    let redraws = 0;
    const observer = new MutationObserver(records => { redraws += records.length; });
    observer.observe(document.querySelector('#explorer-chart svg'), {attributes: true, attributeFilter: ['viewBox']});
    button.click(); button.click(); button.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    observer.disconnect();
    return redraws;
  });
  await expect(legend.locator('button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#explorer-chart path[data-series="version:154.999b1"]')).toHaveCount(0);
  expect(redraws).toBe(1);
  await page.locator('#reset-hidden').click();
  await expect(page.locator('#grouping')).toHaveValue('major');
  await expect(legend.locator('.legend-name')).toHaveText(['157', '154']);
  await expect(page.locator('#explorer-chart path[data-series]')).toHaveCount(3);
});
