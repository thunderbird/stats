import {test, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.use({reducedMotion:'reduce'});

for (const theme of ['light','dark']) {
  test(`${theme}: hidden-series labels and active controls retain contrast`, async ({page}) => {
    await page.addInitScript(value=>localStorage.setItem('tb-stats-theme',value),theme);
    await page.goto('/#explore');
    await page.locator('.channel-set input').first().uncheck();
    await page.locator('#explorer-legend .legend-item').first().click();
    await expect(page.locator('#explorer-legend .legend-item.off')).toHaveCount(1);
    await page.mouse.move(0,0);
    const result=await new AxeBuilder({page}).withRules(['color-contrast']).analyze();
    expect(result.violations).toEqual([]);
    const failures=await page.evaluate(async()=>{
      const {contrastRatio}=await import('/media/js/chart-contrast.mjs');
      const failures=[];
      for(const selector of ['.channel-set input:not(:checked)','#bucket-old-releases','input[type="date"]','#legend-search','#grouping','#theme']) {
        const el=document.querySelector(selector);if(!el)continue;
        const style=getComputedStyle(el);
        const surface=style.getPropertyValue('--surface').trim();
        const background=style.backgroundColor==='rgba(0, 0, 0, 0)'?surface:style.backgroundColor;
        if(contrastRatio(style.borderColor,surface)<3||contrastRatio(style.borderColor,background)<3)failures.push(selector);
      }
      for(const el of document.querySelectorAll('.legend-item.off'))
        if(getComputedStyle(el).opacity!=='1')failures.push('Dimmed legend text');
      for(const el of document.querySelectorAll('input[placeholder]')) {
        if(!el.getClientRects().length||el.disabled)continue;
        const style=getComputedStyle(el,'::placeholder'),background=getComputedStyle(el).backgroundColor;
        if(style.opacity!=='1'||contrastRatio(style.color,background)<4.5)failures.push('Placeholder text');
      }
      return failures;
    });
    expect(failures).toEqual([]);
    await page.goto('/#platforms');
    await page.locator('article:has(#glean-platforms) .legend-item').first().click();
    await page.mouse.move(0,0);
    const secondary=await new AxeBuilder({page}).withRules(['color-contrast']).analyze();
    expect(secondary.violations).toEqual([]);
  });

  test(`${theme}: range selector and crosshair contrast with their surroundings`, async ({page}) => {
    await page.addInitScript(value=>localStorage.setItem('tb-stats-theme',value),theme);
    await page.goto('/#explore');
    const chart=page.locator('#explorer-chart');
    await expect(chart.locator('.chart-range-label')).toBeVisible();
    await chart.locator('svg.stats-chart').focus();
    await page.keyboard.press('End');
    await expect(chart.locator('.chart-hover-marker').first()).toBeVisible();
    const failures=await chart.evaluate(async host=>{
      const {contrastRatio,compositeColor}=await import('/media/js/chart-contrast.mjs');
      const surface=getComputedStyle(host).getPropertyValue('--surface').trim();
      const selected=getComputedStyle(host.querySelector('.selection'));
      const fill=compositeColor(selected.fill,surface,Number(selected.fillOpacity));
      const stroke=compositeColor(selected.stroke,surface,Number(selected.strokeOpacity));
      const overview=getComputedStyle(host.querySelector('.chart-overview-path'));
      const failures=[];
      if(contrastRatio(stroke,surface)<3||contrastRatio(stroke,fill)<3)failures.push('Range selection edge');
      if(contrastRatio(overview.stroke,fill)<3)failures.push('Overview stroke');
      const handle=getComputedStyle(host.querySelector('.handle'));
      if(contrastRatio(handle.fill,surface)<3||contrastRatio(handle.fill,fill)<3)failures.push('Range handle');
      const crosshair=getComputedStyle(host.querySelector('.chart-crosshair-line'));
      if(contrastRatio(crosshair.borderLeftColor,crosshair.backgroundColor)!==21)failures.push('Crosshair edge');
      for(const marker of host.querySelectorAll('.chart-hover-marker')) {
        const style=getComputedStyle(marker);
        if(contrastRatio(style.borderColor,style.backgroundColor)<4.5)failures.push('Hover marker edge');
        const shadow=style.boxShadow.match(/rgba?\([^)]+\)/)?.[0];
        if(!shadow||contrastRatio(style.borderColor,shadow)!==21)failures.push('Hover marker outer edge');
      }
      return failures;
    });
    expect(failures).toEqual([]);
  });

  test(`${theme}: mobile summary and footer text contrast even over extreme artwork colors`, async ({page}) => {
    await page.setViewportSize({width:375,height:812});
    await page.addInitScript(value=>localStorage.setItem('tb-stats-theme',value),theme);
    await page.goto('/#explore');
    await expect(page.locator('#daily-caption')).not.toContainText('Loading');
    const failures=await page.evaluate(async()=>{
      const {contrastRatio,compositeColor}=await import('/media/js/chart-contrast.mjs');
      const failures=[];
      const backgroundFor=(element,backdrop)=>{
        const layers=[];
        for(let node=element;node;node=node.parentElement) {
          // The body's artwork is the unknown backdrop being tested.
          if(node===document.body)break;
          const bg=getComputedStyle(node).backgroundColor,channels=bg.match(/[\d.]+/g);
          if(!channels)continue;
          const alpha=channels.length>3?Number(channels[3]):1;
          if(alpha>0)layers.push({bg,alpha});
          if(alpha===1)break;
        }
        return layers.reverse().reduce((color,{bg,alpha})=>compositeColor(bg,color,alpha),backdrop);
      };
      for(const el of document.querySelectorAll('.site-title,.text-link,.stat-label,.stat-caption,.stat-value,.stat-explore-link,.gradient-text')) {
        if(!el.getClientRects().length)continue;
        const s=getComputedStyle(el);
        const gradient=s.backgroundImage.startsWith('linear-gradient');
        const colors=gradient?s.backgroundImage.match(/rgb\([^)]+\)/g):[s.color];
        for(const backdrop of ['#000','#fff']) {
          const bg=backgroundFor(el,backdrop);
          // Every interpolated gradient color must pass, including between stops.
          for(let i=0;i<colors.length;i++)for(let step=0;step<=20;step++) {
            const color=i===colors.length-1?colors[i]:compositeColor(colors[i],colors[i+1],step/20);
            if(contrastRatio(color,bg)<4.5)failures.push(el.className||el.id);
          }
        }
      }
      return [...new Set(failures)];
    });
    expect(failures).toEqual([]);
  });
}
