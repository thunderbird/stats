import {selectReport, selectMetric} from "./navigation.mjs";
import {test, expect} from '@playwright/test';

test.use({reducedMotion: 'reduce'});

for (const width of [1440, 375, 320]) {
  test(`shared chart controls keep consistent positions across tabs at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await page.goto('/#explore');

    async function checkLayout(card) {
      await expect(card.locator('svg.stats-chart')).toBeVisible();
      const header = card.locator('.card-top');
      const toolbar = card.locator('.chart-toolbar');
      const range = toolbar.locator('.range-toolbar');
      const styles = toolbar.getByRole('group', {name: 'Chart style', exact: true});
      const exports = header.locator('.chart-exports');
      await expect(range).toBeVisible();
      await expect(styles).toBeVisible();
      await expect(exports.getByText('Download SVG', {exact: true})).toBeVisible();
      await expect(exports.getByText('Download CSV', {exact: true})).toBeVisible();
      await expect(range.locator('.date-fields input, .date-fields select')).toHaveCount(2);
      await expect(styles.locator('[aria-pressed="true"]')).toHaveCount(1);

      const boxes = await Promise.all([header, toolbar, range, styles, exports].map(node => node.boundingBox()));
      const [headingBox, toolbarBox, rangeBox, stylesBox, exportsBox] = boxes;
      const padding = width > 600 ? 28 : 17;
      expect(headingBox.y + headingBox.height).toBeLessThanOrEqual(toolbarBox.y + 1);
      expect(rangeBox.x - toolbarBox.x).toBeCloseTo(padding, 0);
      if (width > 1100) {
        // Dates stay on the left; style and header actions share the right edge.
        expect(rangeBox.x + rangeBox.width).toBeLessThan(stylesBox.x);
        expect(stylesBox.x + stylesBox.width).toBeCloseTo(exportsBox.x + exportsBox.width, 0);
        expect(toolbarBox.x + toolbarBox.width - stylesBox.x - stylesBox.width).toBeCloseTo(padding, 0);
      } else {
        // The same two controls stack in the same order on narrow screens.
        expect(rangeBox.y + rangeBox.height).toBeLessThanOrEqual(stylesBox.y);
        expect(stylesBox.x).toBeCloseTo(rangeBox.x, 0);
      }
      const specific = card.locator('.chart-specific-controls');
      if (await specific.count()) {
        const specificBox = await specific.boundingBox();
        expect(specificBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height - 1);
      }
      const plot = await card.locator('.chart-main, .secondary-chart').boundingBox();
      expect(plot.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height - 1);
      const dataTable = card.locator('.chart-data-table');
      await expect(dataTable.locator('summary')).toHaveText('View data table');
      const legend = await card.locator('.series-legend, .secondary-legend').boundingBox();
      expect((await dataTable.boundingBox()).y).toBeGreaterThanOrEqual(legend.y + legend.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }

    await checkLayout(page.locator('#explore-view .chart-card'));
    const tabs = {
      daily: ['daily-history'], mau: ['monthly-history'], telemetry: ['feature-usage'],
      platforms: ['glean-locales', 'glean-platforms'], addons: ['addon-adoption'],
      financials: ['monthly-donations', 'annual-funding'], support: ['support-questions'],
    };
    for (const [tab, ids] of Object.entries(tabs)) {
      await selectReport(page, tab);
      for (const id of ids) await checkLayout(page.locator(`.chart-card:has(#${id})`));
      if (tab === 'telemetry') {
        await page.locator('#archive').selectOption('legacy');
        await checkLayout(page.locator('.chart-card:has(#feature-usage)'));
        await page.locator('#archive').selectOption('current');
        await selectMetric(page, "oauth-providers");
        for (const id of ['oauth-authentication-current-issuer', 'oauth-accounts']) {
          await checkLayout(page.locator(`.chart-card:has(#${id})`));
        }
      }
      if (tab === 'financials') {
        await page.locator('#funding-view').selectOption('timeline');
        await checkLayout(page.locator('.chart-card:has(#monthly-donations)'));
      }
    }
  });
}
