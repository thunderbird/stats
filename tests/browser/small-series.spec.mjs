import {test, expect} from '@playwright/test';
import {selectReport} from './navigation.mjs';

const label = 'Group series below 0.1% into Other';
const categories = date => ({
  dominant: date === '2026-09-06' ? 99610 : 99810,
  boundary: 100, historical: date === '2026-09-06' ? 200 : 0,
  'tiny-a': 20, 'tiny-b': 30, __other__: 40,
});
const records = () => Object.fromEntries(['2026-09-06', '2026-09-27'].map(date =>
  [date, {count: 100000, total: 100000, versions: categories(date)}]));

async function fixture(page) {
  await page.route('**/data/glean.json', async route => {
    const data = await (await route.fetch()).json();
    data.locales.records = records();
    data.platforms.records = records();
    data.metrics.accounts.records = records();
    data.metrics.mail_oauth2_provider_count.records = records();
    for (const [date, record] of Object.entries(data.oauth.records)) {
      record.count = record.total = 100000;
      record.breakdowns.issuer = categories(date);
    }
    await route.fulfill({json: data});
  });
  await page.route('**/locales.json', route => route.fulfill({json: {
    '2025-05-18': {...records()['2026-09-06']}, '2025-05-25': {...records()['2026-09-27']},
  }}));
}

async function csvFor(page, card) {
  const downloaded = page.waitForEvent('download');
  await card.locator('[data-export], #export-csv').click();
  const stream = await (await downloaded).createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

for (const [name, hash, id] of [
  ['languages', 'platforms', 'glean-locales'],
  ['operating systems', 'platforms', 'glean-platforms'],
  ['telemetry categories', 'telemetry?metric=accounts', 'feature-usage'],
  ['OAuth prompts', 'telemetry?metric=oauth-providers', 'oauth-authentication-current-issuer'],
  ['OAuth accounts', 'telemetry?metric=oauth-providers&chart=accounts', 'oauth-accounts'],
]) {
  test(`${name}: small-series grouping agrees across chart, tooltip, table and CSV`, async ({page}) => {
    await fixture(page);
    await page.goto(`/#${hash}`);
    const card = page.locator(`article:has(#${id})`);
    const checkbox = card.getByRole('checkbox', {name: label, exact: true});
    await expect(checkbox).not.toBeChecked();
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(card.locator('.legend-item')).toHaveCount(5);
    await expect(card.getByRole('button', {name: 'Toggle Other', exact: true})).toBeVisible();
    await expect(card.getByRole('button', {name: 'Toggle historical', exact: true})).toBeVisible();
    await expect(card.getByRole('button', {name: 'Toggle boundary', exact: true})).toBeVisible();
    await expect(card.getByRole('button', {name: 'Toggle Other (publication aggregate)', exact: true})).toBeVisible();
    await expect(card.locator('.legend-item')).not.toContainText(['tiny-a', 'tiny-b']);
    await card.getByRole('button', {name: 'Stacked counts', exact: true}).click();
    await card.locator('svg.stats-chart').focus();
    await page.keyboard.press('End');
    await expect(card.locator('.chart-tooltip')).toContainText('Other');
    await expect(card.locator('.chart-tooltip')).not.toContainText('tiny-a');
    await card.locator('summary').click();
    await card.getByRole('checkbox', {name: 'Include shares (%)', exact: true}).check();
    const headers = card.locator('thead');
    await expect(headers).toContainText('Other share (%)');
    await expect(headers).not.toContainText('tiny-a');
    const csv = await csvFor(page, card);
    expect(csv).toContain('Other share (%)');
    expect(csv).toContain('"50","0.05"');
    expect(csv).not.toContain('tiny-a');
    await card.locator('[data-chart-view]').selectOption('snapshot');
    await expect(card.locator('.breakdown-row')).toHaveCount(5);
    await checkbox.uncheck();
    await expect(card.getByRole('button', {name: 'Toggle tiny-a', exact: true})).toBeVisible();
    await expect(card.getByRole('button', {name: 'Toggle Other', exact: true})).toHaveCount(0);
    await expect(headers).toContainText('tiny-a');
  });
}

test('grouping recomputes on range changes, preserves hidden selections and persists per chart', async ({page}) => {
  await fixture(page);
  await page.goto('/#platforms');
  const card = page.locator('article:has(#glean-locales)');
  const checkbox = card.getByRole('checkbox', {name: label, exact: true});
  await card.getByRole('button', {name: 'Toggle tiny-a', exact: true}).click();
  await checkbox.check();
  await expect(card.getByRole('button', {name: 'Toggle tiny-a', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await card.locator('summary').click();
  expect(await csvFor(page, card)).toContain('"30"');
  await card.locator('#glean-locales-start-date').fill('2026-09-20');
  await card.locator('#glean-locales-start-date').dispatchEvent('change');
  await expect(card.getByRole('button', {name: 'Toggle historical', exact: true})).toHaveCount(0);
  await checkbox.uncheck();
  await expect(card.getByRole('button', {name: 'Toggle tiny-a', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await checkbox.check();
  await selectReport(page, 'daily');
  await expect(page.getByRole('checkbox', {name: label, exact: true})).toHaveCount(0);
  await selectReport(page, 'platforms');
  await expect(checkbox).toBeChecked();
  await expect(page.locator('article:has(#glean-platforms)').getByRole('checkbox', {name: label, exact: true})).not.toBeChecked();
  await expect(card.getByRole('button', {name: 'Toggle tiny-a', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#archive').selectOption('legacy');
  await expect(page.locator('article:has(#locales)').getByRole('checkbox', {name: label, exact: true})).not.toBeChecked();
  await page.locator('article:has(#locales)').getByRole('checkbox', {name: label, exact: true}).check();
  await expect(page.locator('article:has(#locales) .legend-item')).toContainText(['Other']);
});

test('version grouping preserves totals, original buckets, shared state and complete reset', async ({page}) => {
  await page.route('**/data/adi-2026.json', async route => {
    const data = await (await route.fetch()).json();
    for (const [date, record] of Object.entries(data)) {
      const historical = date === '2026-09-01' ? 200 : 0;
      record.count = 100000;
      record.channels = {release: {'170.0': 99610 - historical}, esr: {'128.0': 240},
        beta: {'171.0b1': 100, '172.0b1': historical, '173.0b1': 20, '174.0b1': 30}};
      record.versions = Object.assign({}, ...Object.values(record.channels));
    }
    await route.fulfill({json: data});
  });
  await page.goto('/#explore');
  await page.locator('#combine-release-versions').uncheck();
  await page.locator('#legend-show-small-versions').check();
  const checkbox = page.getByRole('checkbox', {name: label, exact: true});
  await expect(page.locator('#explorer-legend [data-series="major:173"]')).toBeVisible();
  await checkbox.check();
  await expect(page.locator('#explorer-legend [data-series="major:173"]')).toHaveCount(0);
  await expect(page.locator('#explorer-legend [data-series="major:172"]')).toBeVisible();
  await expect(page.locator('#explorer-legend [data-series="versions-through:128"]')).toBeVisible();
  await page.locator('[data-mode="count"]').click();
  await expect(page.locator('#explorer-legend [data-series="__small-series__"] .legend-value')).toHaveText('50');
  await page.locator('#explorer-chart svg.stats-chart').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#explorer-chart .chart-tooltip-total')).toHaveText('Selected population: 100,000');
  const details = page.locator('#explorer-data-table');
  await details.locator('summary').click();
  const csv = await csvFor(page, page.locator('article:has(#explorer-chart)'));
  expect(csv).toContain('"Other"');
  expect(csv).not.toContain('"173"');
  expect(csv).toContain('"100000"');
  await page.locator('#share').click();
  expect(JSON.parse(new URLSearchParams(page.url().split('?')[1]).get('state')).groupSmallSeries).toBe(true);
  await page.reload();
  await expect(checkbox).toBeChecked();
  await expect(page.locator('#explorer-legend [data-series="__small-series__"]')).toBeVisible();
  await page.locator('#reset-hidden').click();
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator('#explorer-legend [data-series="__small-series__"]')).toHaveCount(0);
  await expect(page.locator('#reset-hidden')).toBeDisabled();
});
