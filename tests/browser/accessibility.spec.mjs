import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const visibleChart = page => page.locator('.view:not([hidden]) svg.stats-chart').first();

for (const route of ['explore','daily','mau','telemetry?metric=accounts','telemetry?metric=oauth-providers','platforms','addons','financials','support']) {
  test(`accessible structure and controls: ${route}`, async ({page}, testInfo) => {
    await page.goto(`/#${route}`);
    await expect(visibleChart(page)).toBeVisible();
    const result = await new AxeBuilder({page})
      .withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice'])
      .analyze();
    await testInfo.attach('axe-results', {body:JSON.stringify(result),contentType:'application/json'});
    expect(result.violations).toEqual([]);
    expect(result.incomplete.filter(item=>item.id==='aria-prohibited-attr')).toEqual([]);
    expect(await page.evaluate(()=>{
      const unresolved=[];
      for(const element of document.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-details],[aria-controls]'))
        for(const attribute of ['aria-labelledby','aria-describedby','aria-details','aria-controls'])
          for(const id of (element.getAttribute(attribute)||'').split(/\s+/).filter(Boolean))
            if(!document.getElementById(id)) unresolved.push(`${attribute}: ${id}`);
      return unresolved;
    })).toEqual([]);
    await expect(page.locator('#secondary-content')).not.toHaveAttribute('aria-busy','true');
  });
}

test('skip link reaches content without changing the selected report', async ({page}) => {
  await page.goto('/#platforms');
  await expect(visibleChart(page)).toBeVisible();
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await expect(page).toHaveURL(/#platforms$/);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(()=>document.querySelector('#main').contains(document.activeElement))).toBe(true);
});

test('keyboard report navigation announces the destination and moves focus to its heading', async ({page}) => {
  await page.goto('/#explore');
  await expect(visibleChart(page)).toBeVisible();
  await page.locator('#site-nav a[data-tab="daily"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#secondary-title')).toBeFocused();
  await expect(page).toHaveTitle('Daily Active — Thunderbird Data Report');
  await expect(page.locator('#screen-reader-status')).toContainText('Daily Active loaded');
});

test('charts separate names from instructions and retain instructions while inspecting dates', async ({page}) => {
  await page.goto('/#daily');
  const chart = page.locator('#daily-history svg.stats-chart');
  await expect(chart).toHaveAccessibleName('Daily active installations');
  await expect(chart).toHaveAccessibleDescription(/Home for the first date.*data table/);
  await chart.focus();
  await page.keyboard.press('End');
  await expect(page.locator('#daily-history [aria-live]')).toContainText('Sep 30, 2026');
  await page.keyboard.press('Enter');
  await expect(page.locator('#daily-history [role="dialog"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chart).toBeFocused();
  await expect(chart).toHaveAccessibleDescription(/Use left and right arrow keys/);
  await expect(chart).toHaveAttribute('aria-details','daily-history-data-table');
});

test('tables have names, headers and keyboard accessible scroll regions', async ({page}) => {
  await page.goto('/#platforms');
  const card = page.locator('article:has(#glean-platforms)');
  await expect(card).toHaveAccessibleName('Operating systems');
  await card.locator('summary').click();
  const scroller = card.getByRole('region',{name:'Operating systems data table'});
  await scroller.focus();
  await expect(scroller).toBeFocused();
  await expect(card.getByRole('table')).toHaveAccessibleName(/^Operating systems:/);
  await expect(card.locator('thead th[scope="col"]')).not.toHaveCount(0);
  await expect(card.locator('tbody th[scope="row"]')).not.toHaveCount(0);
  const result = await new AxeBuilder({page}).withRules(['scrollable-region-focusable','table-fake-caption','td-headers-attr']).analyze();
  expect(result.violations).toEqual([]);
});

test('group editor keeps keyboard focus through additions, moves, removals and closing', async ({page}) => {
  await page.goto('/#explore');
  await page.locator('#edit-groups').click();
  await expect(page.locator('#group-preset')).toBeFocused();
  await page.locator('#add-group').click();
  await expect(page.locator('#group-rows [data-field="name"]').last()).toBeFocused();
  const last = page.locator('#group-rows [data-group]').last();
  await last.locator('[data-action="up"]').click();
  expect(await page.evaluate(()=>Boolean(document.activeElement.closest('#group-rows')))).toBe(true);
  await page.locator('#group-rows [data-group]').last().locator('[data-action="remove"]').click();
  expect(await page.evaluate(()=>Boolean(document.activeElement.closest('#group-rows')))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#group-editor')).toBeHidden();
  await expect(page.locator('#edit-groups')).toBeFocused();
});

test('date errors identify the controls and clear after correction', async ({page}) => {
  await page.goto('/#platforms');
  const card = page.locator('article:has(#glean-platforms)');
  const start = card.locator('input[type="date"]').first();
  const end = card.locator('input[type="date"]').last();
  await expect(start).toHaveValue('2026-09-06');
  await end.fill('2026-09-01');
  await end.dispatchEvent('change');
  await expect(start).toHaveAttribute('aria-invalid','true');
  await expect(end).toHaveAttribute('aria-invalid','true');
  await expect(end).toHaveAccessibleDescription(/with the start before the end/);
  await end.fill('2026-09-27');
  await end.dispatchEvent('change');
  await expect(start).toHaveAttribute('aria-invalid','false');
  await expect(card.locator('.chart-warning')).toBeHidden();
});

test('grouping updates are announced in a permanently available status region', async ({page}) => {
  await page.goto('/#platforms');
  const checkbox = page.getByRole('checkbox',{name:'Combine Linux versions'});
  await checkbox.uncheck();
  await expect(page.locator('#screen-reader-status')).toContainText('Operating systems updated');
  await expect(page.locator('#screen-reader-status')).toHaveAttribute('role','status');
  expect(await page.locator('#screen-reader-status').evaluate(node=>getComputedStyle(node).display)).not.toBe('none');
});

test('legend descriptions expose the selected date and value without changing button names', async ({page}) => {
  await page.goto('/#explore');
  const series = page.locator('#explorer-legend [data-series="major:140:esr"]');
  await expect(series).toHaveAccessibleDescription(/Sep 30, 2026: 65%.*Shown on the chart/);
  await series.click();
  await expect(series).toHaveAccessibleDescription(/65%.*Hidden from the chart/);
});
