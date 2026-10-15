import {test, expect} from '@playwright/test';

test('Glean shows expired source history as gaps and labels recovered baseline history', async ({page}) => {
  await page.route('**/data/glean.json', async route => {
    const data = await (await route.fetch()).json();
    data.coverage = {start: '2025-05-04', weeks: Object.fromEntries(
      Object.keys(data.platforms.records).map(day => [day, {}]),
    )};
    data.coverage.weeks['2025-05-04'] = {
      metrics: {status: 'unavailable', reason: 'source_retention'},
      oauth: {status: 'unavailable', reason: 'source_retention'},
      addons: {status: 'unavailable', reason: 'before_source_available'},
      baseline: {status: 'complete', source: 'baseline_clients_last_seen'},
    };
    for (const group of [data.platforms, data.locales]) {
      group.records['2025-05-04'] = {count: 100, versions: {Historical: 100}};
    }
    await route.fulfill({json: data});
  });
  await page.goto('/#platforms');
  await expect(page.locator('.coverage-note')).toContainText('archived Glean daily summaries');
  await expect(page.locator('.coverage-note')).not.toContainText('source data is unavailable');

  await page.goto('/#telemetry?metric=oauth-providers');
  await expect(page.locator('.coverage-note')).toContainText('source data is unavailable for 1 week');
  await expect(page.locator('.coverage-note')).toContainText('Missing values are gaps, not zero activity');
  const card = page.locator('article:has(#oauth-accounts)');
  await card.locator('[data-card-range="all"]').click();
  await card.locator('summary').click();
  const gap = card.locator('tbody tr').filter({has: page.locator('th', {hasText: '2025-05-04'})});
  await expect(gap).toHaveCount(1);
  await expect(gap.locator('td')).toHaveText(['—', '—']);

  await page.locator('#archive').selectOption('legacy');
  await expect(page.locator('.coverage-note')).toHaveCount(0);
});
