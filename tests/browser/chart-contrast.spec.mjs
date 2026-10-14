import {test, expect} from '@playwright/test';

test.use({reducedMotion: 'reduce'});

for (const theme of ['light', 'dark']) {
  test(`${theme}: chart boundaries contrast with fills while retaining the series palette`, async ({page}) => {
    await page.addInitScript(theme => localStorage.setItem('tb-stats-theme', theme), theme);
    await page.goto('/#daily');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('#daily-history svg')).toBeVisible();
    const failures = await page.evaluate(async () => {
      const {renderChart} = await import('/media/js/chart.mjs');
      const {renderBreakdown} = await import('/media/js/breakdown.mjs');
      const {contrastRatio, compositeColor} = await import('/media/js/chart-contrast.mjs');
      const colors = ['#0B5CBD', '#2EB6FF', '#fdfdfd', '#181818', '#6e9ed6', '#888888'];
      const series = colors.map((color, index) => ({id: `test-${index}`, name: `Series ${index}`, color, opacity: index >= 4 ? 0.6 : 1,
        values: ['2026-01-01', '2026-01-02'].map(date => ({date, value: index + 1, percent: (index + 1) * 10}))}));
      const host = document.createElement('div');
      host.style.width = '800px'; document.body.append(host);
      const surface = getComputedStyle(host).getPropertyValue('--surface').trim();
      const failures = [];
      let controller;
      for (const mode of ['lines', 'area', 'count', 'percent', 'bars']) {
        if (controller) controller.update(series, {mode});
        else controller = renderChart(host, series, {mode, animate:false, annotations:[{date:'2026-01-01',label:'Release'}]});
        for (const item of series) {
          const mark = host.querySelector(`[data-series="${item.id}"]`);
          const style = getComputedStyle(mark), original = d3.color(item.color).formatRgb();
          if ((mode === 'lines' ? style.stroke : style.fill) !== original) failures.push(`${mode}: palette changed for ${item.id}`);
          if (mode === 'lines') {
            const lineColor = compositeColor(original, surface, Number(style.opacity));
            if (contrastRatio(lineColor, surface) < 3) {
              const outline = host.querySelector(`[data-outline-series="${item.id}"]`);
              const edge = outline && getComputedStyle(outline);
              if (!edge || edge.opacity !== '1' || contrastRatio(edge.stroke, surface) < 3 || contrastRatio(edge.stroke, lineColor) < 3)
                failures.push(`lines: missing contrast for ${item.id}`);
            }
          } else {
            const fill = compositeColor(style.fill, surface, Number(style.fillOpacity));
            if (style.opacity !== '1' || contrastRatio(style.stroke, fill) < 4.5) failures.push(`${mode}: boundary contrast for ${item.id}`);
            if (mode !== 'bars') {
              const outline = host.querySelector(`[data-outline-series="${item.id}"]`);
              if (!outline || contrastRatio(style.stroke, getComputedStyle(outline).stroke) !== 21)
                failures.push(`${mode}: missing dual boundary for ${item.id}`);
            }
          }
        }
        const annotation=host.querySelector('.chart-annotation');
        const outer=getComputedStyle(annotation.querySelector('.chart-annotation-outline'));
        const inner=getComputedStyle(annotation.querySelector('.chart-annotation-line'));
        if(contrastRatio(outer.stroke,inner.stroke)!==21)failures.push('Annotation boundary');
      }
      controller.destroy();
      const snapshot = renderBreakdown(host, [...series.map((item, index) => ({...item, value:index, percent:index * 10})),
        {id:'tiny', name:'Tiny', color:'#fdfdfd', value:0.0001, percent:0.0001}], {title:'Contrast fixture'});
      for (const row of host.querySelectorAll('.breakdown-row')) {
        const mark = row.querySelector('.breakdown-bar'), bar = getComputedStyle(mark);
        if (Number(mark.getAttribute('width')) < 3) {
          if (contrastRatio(bar.stroke, surface) < 3) failures.push('Thin snapshot bar contrast');
        } else if (contrastRatio(bar.fill, bar.stroke) < 4.5) failures.push('Snapshot bar boundary contrast');
      }
      const zero = host.querySelector('.breakdown-zero:not([display="none"])');
      if (contrastRatio(getComputedStyle(zero).stroke, surface) < 3) failures.push('Snapshot zero contrast');
      snapshot.destroy(); host.remove();
      return failures;
    });
    expect(failures).toEqual([]);
  });
}

test('contrast outlines update on theme changes without changing observations or line colors', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('tb-stats-theme', 'light'));
  await page.goto('/#daily');
  await page.evaluate(async () => {
    const {renderChart} = await import('/media/js/chart.mjs');
    const host = document.createElement('div'); host.id = 'contrast-fixture'; host.style.width = '800px';
    document.body.append(host);
    renderChart(host, [{id:'release',name:'Release',color:'#2EB6FF',values:[{date:'2026-01-01',value:1},{date:'2026-01-02',value:2}]}], {mode:'lines',animate:false});
  });
  const line = page.locator('#contrast-fixture path[data-series="release"]');
  const outline = page.locator('#contrast-fixture [data-outline-series="release"]');
  await expect(outline).toHaveCount(1);
  const geometry = await line.getAttribute('d');
  await page.locator('#theme').click();
  await page.getByRole('menuitemradio', {name:'Dark',exact:true}).click();
  await expect(outline).toHaveCount(0);
  await expect(line).toHaveAttribute('stroke', '#2eb6ff');
  await expect(line).toHaveAttribute('d', geometry);
  await page.locator('#theme').click();
  await page.getByRole('menuitemradio', {name:'Light',exact:true}).click();
  await expect(outline).toHaveCount(1);
  await expect(line).toHaveAttribute('stroke', '#2eb6ff');
});
