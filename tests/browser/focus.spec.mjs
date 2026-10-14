import {test, expect} from '@playwright/test';

const outline = locator => locator.evaluate(node => getComputedStyle(node).outlineStyle);
const stroke = locator => locator.locator('.breakdown-hit').evaluate(node => getComputedStyle(node).stroke);

for (const theme of ['light', 'dark']) {
  test(`${theme}: charts show keyboard focus and clear it immediately for mouse use`, async ({page}) => {
    await page.addInitScript(theme => localStorage.setItem('tb-stats-theme', theme), theme);
    await page.goto('/#daily');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const chart = page.locator('#daily-history svg.stats-chart');
    const card = page.locator('article:has(#daily-history)');
    await expect(chart).toBeVisible();
    await card.locator('[data-chart-mode="bars"]').focus();
    await page.keyboard.press('Tab');
    await expect(chart).toBeFocused();
    expect(await outline(chart)).toBe('solid');
    await page.keyboard.press('End');
    await expect(card.locator('[aria-live]')).toContainText('Sep 30, 2026');
    await chart.locator('.chart-interaction').click();
    await expect(chart).toBeFocused();
    expect(await outline(chart)).toBe('none');
    await expect(card.locator('.chart-tooltip')).toHaveAttribute('data-pinned', 'true');
    await card.getByRole('button', {name: 'Close chart details'}).click();
    await expect(chart).toBeFocused();
    expect(await outline(chart)).toBe('none');
    await expect(card.locator('.chart-tooltip')).toBeHidden();
    // A retained mouse focus must not keep an unpinned tooltip stuck open.
    await page.mouse.move(5, 5);
    await chart.locator('.chart-interaction').hover();
    await expect(card.locator('.chart-tooltip')).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(card.locator('.chart-tooltip')).toBeHidden();
    await page.keyboard.press('ArrowLeft');
    expect(await outline(chart)).toBe('solid');
    await expect(card.locator('.chart-tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(chart).toBeFocused();
    expect(await outline(chart)).toBe('solid');
    await expect(card.locator('.chart-tooltip')).toBeHidden();
  });

  test(`${theme}: import rules has a visible keyboard outline on its label only`, async ({page}) => {
    await page.addInitScript(theme => localStorage.setItem('tb-stats-theme', theme), theme);
    await page.goto('/#explore');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.locator('#edit-groups').click();
    const input = page.locator('#import-groups');
    const label = page.locator('.import-label');
    await page.locator('#export-groups').focus();
    await page.keyboard.press('Tab');
    await expect(input).toBeFocused();
    expect(await outline(label)).toBe('solid');
    expect(await label.evaluate(node => getComputedStyle(node).outlineWidth)).toBe('2px');
    const chooserEvent = page.waitForEvent('filechooser');
    await label.click();
    const chooser = await chooserEvent;
    expect(await outline(label)).toBe('none');
    await chooser.setFiles([]);
    await input.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#export-groups')).toBeFocused();
    expect(await outline(page.locator('#export-groups'))).toBe('solid');
    await page.keyboard.press('Tab');
    expect(await outline(label)).toBe('solid');
    // Clicking an inert surface changes input method without requiring blur.
    await page.mouse.click(5, 5);
    expect(await outline(label)).toBe('none');
  });
}

test('buttons, text inputs, headings and scroll regions leave no mouse focus outlines', async ({page}) => {
  await page.goto('/#explore');
  const search = page.locator('#legend-search');
  await search.click();
  expect(await outline(search)).toBe('none');
  await search.fill('140');
  await page.keyboard.press('End');
  expect(await outline(search)).toBe('solid');
  await search.click();
  await expect(search).toBeFocused();
  expect(await outline(search)).toBe('none');
  const legend = page.locator('#explorer-legend .legend-item').first();
  await legend.click();
  await expect(legend).toBeFocused();
  expect(await outline(legend)).toBe('none');
  await page.keyboard.press('Space');
  expect(await outline(legend)).toBe('solid');
  await legend.click();
  expect(await outline(legend)).toBe('none');
  await page.locator('#explorer-data-table summary').click();
  const table = page.locator('#explorer-table');
  await table.focus();
  await page.keyboard.press('ArrowRight');
  expect(await outline(table)).toBe('solid');
  await table.click({position:{x:5,y:5}});
  expect(await outline(table)).toBe('none');
  await page.locator('#site-nav a[data-tab="mau"]').click();
  await expect(page.locator('#secondary-title')).toHaveText('Monthly active installations');
  await expect(page.locator('#secondary-title')).toBeFocused();
  expect(await outline(page.locator('#secondary-title'))).toBe('none');
});

test('snapshot rows use an inset keyboard marker, without a persistent mouse highlight', async ({page}) => {
  await page.route('**/data/glean.json', async route => {
    const data = await (await route.fetch()).json();
    for (const record of Object.values(data.platforms.records))
      record.versions = {'Windows 10':60, 'Windows 11':30, Linux:10};
    await route.fulfill({json:data});
  });
  await page.goto('/#platforms');
  const card = page.locator('article:has(#glean-platforms)');
  await card.locator('[data-chart-view]').selectOption('snapshot');
  const first = card.locator('.breakdown-row').first();
  const second = card.locator('.breakdown-row').nth(1);
  await expect(card.locator('.breakdown-row')).toHaveCount(3);
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(second).toBeFocused();
  expect(await stroke(second)).not.toBe('none');
  expect(await second.locator('.breakdown-hit').evaluate(node => getComputedStyle(node).strokeWidth)).toBe('2px');
  expect(await outline(second)).toBe('none');
  await second.click();
  await expect(second).toBeFocused();
  expect(await stroke(second)).toBe('none');
  expect(await second.locator('.breakdown-hit').evaluate(node => getComputedStyle(node).fill)).toBe('rgba(0, 0, 0, 0)');
  await page.mouse.move(5, 5);
  await expect(card.locator('.breakdown-tooltip')).toBeHidden();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  expect(await stroke(first)).not.toBe('none');
  await expect(card.locator('.breakdown-tooltip')).toBeVisible();
});
