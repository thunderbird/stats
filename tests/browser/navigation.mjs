async function openNavigation(page) {
  await page.locator('[data-nav-section][data-active]').first().waitFor({state: 'attached'});
  const trigger = page.locator('#site-nav-toggle');
  if (await trigger.isVisible() && await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
}

async function openSection(page, section) {
  await openNavigation(page);
  const toggle = page.locator(`[data-nav-toggle="${section}"]`);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

export async function selectReport(page, tab) {
  if (tab === 'telemetry') {
    await openSection(page, 'telemetry');
    const links = page.locator('#telemetry-nav-links [data-metric]');
    await links.first().waitFor({state: 'attached'});
    const metrics = page.locator('#telemetry-nav-links [data-metric]:not([data-metric="oauth-providers"])');
    await selectMetric(page, await (await metrics.count() ? metrics.first() : links.first()).getAttribute('data-metric'));
    return;
  }
  if (['explore', 'daily'].includes(tab)) await openSection(page, 'daily');
  else await openNavigation(page);
  await page.locator(`#site-nav [data-tab="${tab}"]`).click();
}

export async function selectMetric(page, metric) {
  await openSection(page, 'telemetry');
  const link = page.locator(`#telemetry-nav-links [data-metric="${metric}"]`);
  await link.waitFor({state: 'attached'});
  const group = await link.getAttribute('data-group');
  const toggle = page.locator(`[data-nav-toggle="telemetry-${group}"]`);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await link.click();
}
