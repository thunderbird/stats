import {test, expect} from '@playwright/test';
import {selectReport, selectMetric} from './navigation.mjs';

test('site-wide sidebar groups reports and tracks direct links and history', async ({page}) => {
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto('/#telemetry?metric=accounts');
  const navigation = page.getByRole('navigation', {name: 'Statistics views'});
  await expect(navigation.locator('[aria-current="page"]')).toHaveText('Mail accounts');
  await expect(page.locator('#telemetry-nav-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#daily-nav-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#feature-usage svg')).toBeVisible();
  await expect(page.locator('#secondary-content [role="tablist"], .metric-navigation')).toHaveCount(0);
  const [nav, content] = await Promise.all([navigation.boundingBox(), page.locator('#main').boundingBox()]);
  expect(nav.x + nav.width).toBeLessThan(content.x);
  await selectReport(page, 'daily');
  await expect(page.locator('#daily-history svg')).toBeVisible();
  await expect(navigation.locator('[aria-current="page"]')).toHaveText('Active');
  await expect(page.locator('#daily-nav-links a')).toHaveText(['Versions & Channels', 'Active']);
  await expect(page.locator('#telemetry-nav-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.goBack();
  await expect(navigation.locator('[aria-current="page"]')).toHaveText('Mail accounts');
  await expect(page.locator('#telemetry-nav-links [aria-current="page"]')).toHaveAttribute('data-metric', 'accounts');
  await page.locator('.community-footer').scrollIntoViewIfNeeded();
  expect((await page.locator('.site-sidebar').boundingBox()).y).toBeGreaterThanOrEqual(0);
});

test('browsing or collapsing a section leaves the displayed chart unchanged', async ({page}) => {
  await page.goto('/#explore');
  await expect(page.locator('#explorer-chart svg')).toBeVisible();
  const before = page.url();
  await page.locator('#explorer-chart svg').evaluate(node => { node.dataset.browseCheck = 'original'; });
  await page.locator('#telemetry-nav-toggle').click();
  await expect(page.locator('#telemetry-nav-links [data-metric]')).toHaveCount(2);
  await expect(page.locator('#telemetry-nav-links h3')).toHaveText(['Accounts & Authentication']);
  await expect(page.locator('#telemetry-nav-links [data-nav-toggle]')).toHaveCount(1);
  await expect(page.locator('#telemetry-accounts-links')).toBeHidden();
  await page.locator('[data-nav-toggle="telemetry-accounts"]').click();
  await expect(page.locator('#telemetry-accounts-links')).toBeVisible();
  await page.locator('#daily-nav-toggle').click();
  await expect(page.locator('#daily-nav-links')).toBeHidden();
  expect(page.url()).toBe(before);
  await expect(page.locator('#explorer-chart svg')).toHaveAttribute('data-browse-check', 'original');
  await page.locator('#telemetry-nav-links [data-metric="accounts"]').click();
  await expect(page.locator('#feature-usage svg')).toBeVisible();
  await expect(page).toHaveURL(/#telemetry\?metric=accounts$/);
});

test('mobile report navigation opens, dismisses with Escape, and closes after selection', async ({page}) => {
  await page.setViewportSize({width: 375, height: 900});
  await page.goto('/#telemetry?metric=accounts');
  const trigger = page.locator('#site-nav-toggle');
  const navigation = page.locator('#site-nav');
  await expect(page.locator('#feature-usage svg')).toBeVisible();
  await expect(trigger).toContainText('Telemetry · Mail accounts');
  await expect(navigation).toBeHidden();
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#daily-nav-toggle').click();
  await navigation.getByRole('link', {name: 'Active', exact: true}).focus();
  await page.keyboard.press('Escape');
  await expect(navigation).toBeHidden();
  await expect(trigger).toBeFocused();
  await selectReport(page, 'daily');
  await expect(page.locator('#daily-history svg')).toBeVisible();
  await expect(trigger).toContainText('Daily Active');
  await expect(navigation).toBeHidden();
  await trigger.click();
  await navigation.getByRole('link', {name: 'Active', exact: true}).click();
  await expect(navigation).toBeHidden();
  await selectMetric(page, 'oauth-providers');
  await expect(page.locator('#oauth-accounts svg')).toBeVisible();
  await expect(trigger).toContainText('Telemetry · OAuth Providers');
  await expect(navigation).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Daily direct links reveal and highlight the matching child report', async ({page}) => {
  for (const [hash, label, chart] of [['daily', 'Active', '#daily-history'], ['explore', 'Versions & Channels', '#explorer-chart']]) {
    await page.goto(`/#${hash}`);
    await expect(page.locator(`${chart} svg`)).toBeVisible();
    await expect(page.locator('#daily-nav-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#daily-nav-links [aria-current="page"]')).toHaveText(label);
  }
});
