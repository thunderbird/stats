import {readFile} from 'node:fs/promises';
import {test, expect} from '@playwright/test';

function distribution(versions, esr, release) {
  return {count: 1000, versions, coverage: {channels: {esr: 600, release: 400}},
    by_channel: {esr: {count: 600, versions: esr}, release: {count: 400, versions: release}}};
}

async function csvRows(card, page) {
  const downloaded = page.waitForEvent('download');
  await card.locator('[data-export]').click();
  const download = await downloaded;
  const text = await readFile(await download.path(), 'utf8');
  const [header, ...rows] = text.trim().split(/\r?\n/)
    .map(row => [...row.matchAll(/"((?:[^"]|"")*)"/g)].map(cell => cell[1].replaceAll('""', '"')));
  return {header, rows: new Map(rows.map(row => [row[0], row.slice(1)]))};
}

test('Glean platform and language channels change counts and CSV while preserving chart controls', async ({page}) => {
  await page.route('**/data/glean.json', async route => {
    const response = await route.fetch();
    const data = await response.json();
    const dates = ['2025-05-04', '2025-05-11', '2025-05-18', '2026-09-27'];
    data.platforms.records = Object.fromEntries(dates.map(date => [date,
      distribution({'Windows 11': 600, Linux: 400}, {'Windows 11': 500, Linux: 100}, {'Windows 11': 100, Linux: 300})]));
    data.locales.records = Object.fromEntries(dates.map(date => [date,
      distribution({'en-US': 600, de: 400}, {'en-US': 500, de: 100}, {'en-US': 100, de: 300})]));
    delete data.platforms.records['2025-05-18'].by_channel;
    delete data.locales.records['2025-05-18'].by_channel;
    data.coverage = {start: dates[0], weeks: Object.fromEntries(dates.map(date => [date,
      {baseline: {status: 'complete', platform_detail: 2}, metrics: {status: 'complete'}}]))};
    await route.fulfill({response, json: data});
  });
  await page.goto('/#platforms');
  const platforms = page.locator('article[aria-labelledby="glean-platforms-title"]');
  const languages = page.locator('article[aria-labelledby="glean-locales-title"]');
  await expect(platforms.locator('svg.stats-chart')).toBeVisible();
  await platforms.locator('[data-chart-mode="lines"]').click();
  await platforms.locator('input[id$="-end-date"]').fill('2025-05-18');
  await platforms.locator('input[id$="-end-date"]').dispatchEvent('change');
  const linux = platforms.locator('button[data-series="Linux"]');
  await linux.click();
  await platforms.locator('summary').click();
  await platforms.locator('[data-hidden-series]').check();
  await platforms.locator('svg.stats-chart').evaluate(svg => {svg.dataset.channelProof = 'same-chart';});

  const channels = page.locator('#report-channels');
  await channels.locator('input[value="release"]').dblclick();
  await expect(channels.locator('input:checked')).toHaveCount(1);
  await expect(platforms.locator('[data-chart-mode="lines"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(platforms.locator('input[id$="-end-date"]')).toHaveValue('2025-05-18');
  await expect(linux).toHaveAttribute('aria-pressed', 'false');
  await expect(platforms.locator('svg.stats-chart')).toHaveAttribute('data-channel-proof', 'same-chart');

  const filtered = await csvRows(platforms, page);
  expect(filtered.rows.get('2025-05-04').map(Number).reduce((sum, value) => sum + value, 0)).toBe(400);
  expect(filtered.rows.get('2025-05-11').map(Number).reduce((sum, value) => sum + value, 0)).toBe(400);
  expect(filtered.rows.get('2025-05-18').every(value => value === '')).toBe(true);
  expect(filtered.rows.size).toBe(3);
  const localeCSV = await csvRows(languages, page);
  const german = localeCSV.header.findIndex(column => column.startsWith('de (')) - 1;
  expect(localeCSV.rows.get('2025-05-04')[german]).toBe('300');
  expect(localeCSV.rows.get('2026-09-27')[german]).toBe('300');
  expect(localeCSV.rows.get('2025-05-18').every(value => value === '')).toBe(true);

  await channels.getByRole('button', {name: 'All channels', exact: true}).click();
  const restored = await csvRows(platforms, page);
  expect(restored.rows.get('2025-05-04').map(Number).reduce((sum, value) => sum + value, 0)).toBe(1000);
  expect(restored.rows.get('2025-05-18').map(Number).reduce((sum, value) => sum + value, 0)).toBe(1000);
  await channels.getByRole('button', {name: 'Clear All', exact: true}).click();
  await expect(page.locator('#secondary-content')).toBeHidden();
  await channels.locator('input[value="release"]').check();
  await expect(platforms.locator('svg.stats-chart')).toHaveAttribute('data-channel-proof', 'same-chart');
  await expect(linux).toHaveAttribute('aria-pressed', 'false');
});
