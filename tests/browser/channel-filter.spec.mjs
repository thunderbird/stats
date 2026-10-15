import {test, expect} from '@playwright/test';
import {selectReport, selectMetric} from './navigation.mjs';

const channelHint = 'Choose one or more channels. Double click to isolate one channel by itself.';

test('shared channel selection filters versions, survives navigation and reload, and resets', async ({page}) => {
  await page.goto('/#explore');
  const filter = page.locator('#report-channels');
  await expect(page.locator('#explorer-chart svg')).toBeVisible();
  await expect(filter.getByRole('status')).toHaveText(channelHint);
  await page.locator('#grouping').selectOption('channels');
  const release = filter.locator('input[value="release"]');
  await release.uncheck();
  await expect(page.locator('#denominator-note')).toContainText('Excluded channels: Release.');
  await expect(filter.locator('#all-report-channels')).toHaveAttribute('aria-pressed', 'false');
  await expect(filter.getByRole('status')).toHaveText(channelHint);

  await selectMetric(page, 'accounts');
  await expect(page.locator('#feature-usage svg')).toBeVisible();
  await expect(release).not.toBeChecked();
  await expect(filter.getByRole('status')).toHaveText(channelHint);
  await page.reload();
  await expect(page.locator('#feature-usage svg')).toBeVisible();
  await expect(release).not.toBeChecked();

  await selectReport(page, 'explore');
  await expect(page.locator('#denominator-note')).toContainText('Excluded channels: Release.');
  await filter.getByRole('button', {name: 'All channels', exact: true}).click();
  await expect(release).toBeChecked();
  await expect(page.locator('#denominator-note')).not.toContainText('Excluded channels');
  await expect(filter.locator('#all-report-channels')).toHaveAttribute('aria-pressed', 'true');
});

test('Funding and Support omit channel controls without discarding the selection', async ({page}) => {
  await page.goto('/#mau');
  const filter = page.locator('#report-channels');
  await expect(page.locator('#monthly-history svg')).toBeVisible();
  await filter.getByRole('button', {name: 'Clear All', exact: true}).click();
  for (const tab of ['financials', 'support']) {
    await selectReport(page, tab);
    await expect(filter).toBeHidden();
    await expect(page.locator('#channel-empty-state')).toBeHidden();
    await expect(page.locator('#secondary-content svg').first()).toBeVisible();
  }
  await selectReport(page, 'platforms');
  await expect(filter).toBeVisible();
  await expect(filter.locator('input[value="beta"]')).not.toBeChecked();
  await expect(filter.getByRole('status')).toContainText('No channels selected');
});

test('Clear All clears the selection, persists, and allows choosing one channel or all channels', async ({page}) => {
  await page.goto('/#explore');
  const filter = page.locator('#report-channels');
  const all = filter.getByRole('button', {name: 'All channels', exact: true});
  const none = filter.getByRole('button', {name: 'Clear All', exact: true});
  await expect(page.locator('#explorer-chart svg')).toBeVisible();
  await page.locator('#grouping').selectOption('channels');
  await none.click();
  await expect(filter.locator('input:checked')).toHaveCount(0);
  await expect(none).toHaveAttribute('aria-pressed', 'true');
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await expect(filter.getByRole('status')).toContainText('No channels selected');
  await expect(page.locator('#explorer-legend button[data-series]')).toHaveCount(0);
  await page.reload();
  await expect(none).toHaveAttribute('aria-pressed', 'true');
  await expect(filter.locator('input:checked')).toHaveCount(0);
  await filter.locator('input[value="esr"]').check();
  await expect(filter.locator('input:checked')).toHaveCount(1);
  await expect(none).toHaveAttribute('aria-pressed', 'false');
  await expect(all).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#explorer-legend button[data-series]')).toHaveCount(1);
  await all.click();
  await expect(filter.locator('input:checked')).toHaveCount(5);
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(none).toHaveAttribute('aria-pressed', 'false');
});

test('double-click isolates a channel from its label, checkbox, or color dot while single-click adds channels', async ({page}) => {
  await page.goto('/#explore');
  const filter = page.locator('#report-channels');
  await expect(page.locator('#explorer-chart svg')).toBeVisible();
  await page.locator('#grouping').selectOption('channels');
  const esr = filter.locator('input[value="esr"]');
  const label = filter.locator('label:has(input[value="esr"])');
  for (const target of [label, esr, label.locator('.channel-dot')]) {
    await filter.getByRole('button', {name: 'All channels', exact: true}).click();
    await target.dblclick();
    await expect(esr).toBeChecked();
    await expect(filter.locator('input:checked')).toHaveCount(1);
    await expect(page.locator('#explorer-legend button[data-series]')).toHaveCount(1);
    await expect(page.locator('#explorer-legend')).toContainText('ESR');
  }
  await filter.locator('input[value="release"]').click();
  await expect(esr).toBeChecked();
  await expect(filter.locator('input:checked')).toHaveCount(2);
  await filter.locator('input[value="beta"]').dblclick();
  await expect(filter.locator('input:checked')).toHaveCount(1);
  await expect(filter.locator('input[value="beta"]')).toBeChecked();
  await page.reload();
  await expect(filter.locator('input:checked')).toHaveCount(1);
  await expect(filter.locator('input[value="beta"]')).toBeChecked();
  await selectReport(page, 'daily');
  await label.dblclick();
  await expect(esr).toBeChecked();
  await expect(filter.locator('input:checked')).toHaveCount(1);
  await expect(page.locator('#secondary-content')).toBeVisible();
});

for (const report of ['daily', 'mau', 'telemetry', 'addons', 'platforms']) {
  test(`Clear All empties ${report} and restores the same charts when channels are selected`, async ({page}) => {
    await page.goto('/#explore');
    await expect(page.locator('#explorer-chart svg')).toBeVisible();
    await selectReport(page, report);
    const content = page.locator('#secondary-content');
    const chart = content.locator('svg.stats-chart').first();
    await expect(chart).toBeVisible();
    await chart.evaluate(node => { node.dataset.clearCheck = 'original'; });
    const filter = page.locator('#report-channels');
    await filter.getByRole('button', {name: 'Clear All', exact: true}).click();
    await expect(filter.locator('input:checked')).toHaveCount(0);
    await expect(page.locator('#channel-empty-state')).toBeVisible();
    await expect(content).toBeHidden();
    await expect(filter.getByRole('status')).toContainText('No channels selected');
    await filter.locator('input[value="esr"]').check();
    await expect(page.locator('#channel-empty-state')).toBeHidden();
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAttribute('data-clear-check', 'original');
    await expect(filter.getByRole('status')).toHaveText(channelHint);
    await filter.getByRole('button', {name: 'Clear All', exact: true}).click();
    await page.reload();
    await expect(page.locator('#channel-empty-state')).toBeVisible();
    await expect(content).toBeHidden();
    await filter.getByRole('button', {name: 'All channels', exact: true}).click();
    await expect(chart).toBeVisible();
    await expect(page.locator('#channel-empty-state')).toBeHidden();
  });
}

test('Clear All removes cutoff and custom series in every explorer chart style', async ({page}) => {
  await page.goto('/#explore');
  await expect(page.locator('#explorer-chart svg')).toBeVisible();
  const filter = page.locator('#report-channels');
  for (const grouping of ['major', 'custom']) for (const mode of ['percent', 'count', 'lines']) {
    await filter.getByRole('button', {name: 'All channels', exact: true}).click();
    await page.locator('#grouping').selectOption(grouping);
    await page.locator(`[data-mode="${mode}"]`).click();
    await filter.getByRole('button', {name: 'Clear All', exact: true}).click();
    await expect(page.locator('#explorer-chart svg')).toContainText('No channels selected');
    await expect(page.locator('#explorer-legend button[data-series]')).toHaveCount(0);
  }
});

test('channel chips wrap on mobile and remain operable by keyboard', async ({page}) => {
  await page.setViewportSize({width: 375, height: 900});
  await page.goto('/#explore');
  const filter = page.locator('#report-channels');
  await expect(page.locator('#explorer-chart svg')).toBeVisible();
  const esr = filter.locator('input[value="esr"]');
  await esr.focus();
  await page.keyboard.press('Space');
  await expect(esr).not.toBeChecked();
  await filter.getByRole('button', {name: 'Clear All', exact: true}).focus();
  await page.keyboard.press('Enter');
  await expect(filter.locator('input:checked')).toHaveCount(0);
  await filter.getByRole('button', {name: 'All channels', exact: true}).focus();
  await page.keyboard.press('Enter');
  await expect(esr).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await filter.boundingBox();
  for (const chip of await filter.locator('label, button').all()) {
    const rect = await chip.boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(bounds.x);
    expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width);
  }
});
