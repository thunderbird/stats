import {assignSeriesColors} from './explorer-model.mjs';
import {annualDonationRows, monthlyComparisonSeries, monthlyDonationTimeline, sameMonthAnnualComparison} from './funding-model.mjs';
import {contrastInk} from './chart-contrast.mjs';

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const describeMonths = months => {
  if (!months.length) return 'No reported months';
  if (months.length === 1) return monthNames[months[0] - 1];
  return months.every((month, index) => !index || month === months[index - 1] + 1)
    ? `${monthNames[months[0] - 1]}–${monthNames[months.at(-1) - 1]}`
    : months.map(month => monthNames[month - 1]).join(', ');
};
const withColors = series => {
  const colors = assignSeriesColors(series);
  return series.map((item, index) => ({...item, color: colors[index]}));
};

/** Render funding with the dashboard's shared chart/card controller. */
export function renderFunding(data, {container, card, destroyCharts, announce = () => {}}) {
  if (typeof container === 'string') container = document.querySelector(container);
  if (!container || typeof card !== 'function' || typeof destroyCharts !== 'function') {
    throw new TypeError('Funding requires a container and the shared card/chart lifecycle.');
  }
  container.replaceChildren();
  const controls = document.createElement('article');
  controls.className = 'chart-card secondary-card funding-controls';
  controls.innerHTML = `<label class="funding-control" for="funding-view">View<select id="funding-view"><option value="compare">Compare years</option><option value="timeline">Timeline</option></select></label><label class="funding-control" for="funding-period">Values<select id="funding-period"><option value="monthly">Monthly donations</option><option value="cumulative">Cumulative donations</option></select></label><label class="funding-control" for="funding-annual-comparison">Annual comparison<select id="funding-annual-comparison"><option value="totals">Reported totals</option><option value="same-months">Same reported months</option></select></label>`;
  const chartHost = document.createElement('div');
  chartHost.id = 'funding-charts';
  chartHost.className = 'funding-charts';
  container.append(controls, chartHost);

  const viewSelect = controls.querySelector('#funding-view');
  const periodSelect = controls.querySelector('#funding-period');
  const annualSelect = controls.querySelector('#funding-annual-comparison');
  const monthlyCoverage = monthlyComparisonSeries(data).coverage;
  const coverageByYear = new Map(monthlyCoverage.map(item => [item.year, item]));
  const annualRows = annualDonationRows(data);
  const matched = sameMonthAnnualComparison(data);
  annualSelect.querySelector('[value="same-months"]').disabled = !matched.rows.length;

  const attachCard = (...args) => {
    const article = card(...args);
    chartHost.append(article);
    return article;
  };
  const coverageNote = (article, text) => {
    const note = document.createElement('p');
    note.className = 'funding-coverage-note';
    note.setAttribute('role', 'note');
    note.textContent = text;
    const toolbar = article.querySelector('.chart-toolbar');
    if (toolbar) toolbar.after(note);
    else article.prepend(note);
  };
  function renderCharts() {
    destroyCharts();
    chartHost.replaceChildren();
    const compare = viewSelect.value === 'compare';
    periodSelect.closest('label').hidden = !compare;
    if (compare) {
      const cumulative = periodSelect.value === 'cumulative';
      const result = monthlyComparisonSeries(data, {cumulative});
      const partial = result.coverage.filter(year => year.partial)
        .map(year => `${year.year}: ${describeMonths(year.observedMonths)} only (${year.months} of 12 months)`).join('; ');
      const article = attachCard('monthly-donations', cumulative ? 'Cumulative donations by year' : 'Monthly donations by year',
        'Compare the same months across years · USD', withColors(result.series), {
          mode: 'area', modes: ['area', 'lines', 'bars'], monthComparison: true, unit: 'currency',
          stateKey: `funding-compare-${periodSelect.value}`,
          startDate: result.startDate, endDate: result.endDate,
          meta: `Source: existing published financial data. Years are overlaid independently, never stacked. ${cumulative ? 'Cumulative totals stop at the first unreported month. ' : ''}Missing and future months remain gaps.`,
        });
      if (partial) coverageNote(article, partial + '.');
    } else {
      attachCard('monthly-donations', 'Monthly donations', 'Community contributions over time · USD', withColors([{
        id: 'donations', name: 'Donations', visible: true, values: monthlyDonationTimeline(data),
      }]), {
        mode: 'area', modes: ['area', 'lines', 'bars'], unit: 'currency', stateKey: 'funding-timeline',
        meta: 'Source: existing published financial data. Unreported months remain gaps; no future months are projected.',
      });
    }

    const sameMonths = annualSelect.value === 'same-months';
    const selectedRows = sameMonths ? matched.rows : annualRows;
    const partial = sameMonths ? [] : selectedRows.filter(([, row]) => row.partial);
    const partialDescriptions = partial.map(([, row]) => `${row.year}: ${describeMonths(coverageByYear.get(row.year)?.observedMonths || [])} only (${row.months} of 12 months)`);
    const matchedDescription = `${describeMonths(matched.months)}, matching ${matched.referenceYear}'s reported months`;
    const excluded = matched.excludedYears.length ? ` Years without all matching monthly observations are excluded: ${matched.excludedYears.join(', ')}.` : '';
    const article = attachCard('annual-funding', sameMonths ? 'Donations for the same reported months' : 'Annual donations',
      sameMonths ? `Each year: ${matchedDescription} · USD` : 'Published annual totals and available monthly sums · USD', withColors([{
        id: 'donations', name: 'Donations', visible: true,
        values: selectedRows.map(([date, row]) => ({
          date, sourceDate: date, value: row.value, missing: false, partial: row.partial,
          note: sameMonths ? `${row.year}: ${describeMonths(matched.months)} (${matched.months.length} matched months)`
            : row.partial ? partialDescriptions.find(text => text.startsWith(`${row.year}:`))
              : row.published ? `${row.year}: published annual total` : `${row.year}: all 12 months`,
        })),
      }]), {
        mode: 'bars', modes: ['bars', 'lines', 'area'], unit: 'currency', tickInterval: 'year', rangePresets: ['5y','10y','all'], stateKey: `funding-annual-${annualSelect.value}`,
        meta: sameMonths
          ? `Every included year contains all the same reported months. This comparison uses monthly data, not full-year totals.${excluded}`
          : 'Source: existing published financial data. Explicit published annual totals take precedence over monthly sums.',
      });
    if (sameMonths) coverageNote(article, `Matched-period comparison: ${matchedDescription}.${excluded}`);
    else if (partialDescriptions.length) coverageNote(article, `${partialDescriptions.join('; ')}. Incomplete years are not comparable with full-year totals. Choose “Same reported months” for a fair comparison.`);
  }
  for (const select of [viewSelect, periodSelect, annualSelect]) select.addEventListener('change', () => {
    renderCharts();
    announce(`Funding charts updated. ${select.selectedOptions[0].textContent}.`);
  });
  renderCharts();

  const allocation = document.createElement('article');
  allocation.className = 'chart-card secondary-card';
  allocation.innerHTML = '<div class="card-top"><div><h3>Where support goes</h3><p>Latest published spending allocation</p></div></div><div class="spending-allocation"></div>';
  const periods = Object.keys(data || {}).filter(key => /^spending_\d{4}$/.test(key)).sort().reverse();
  function renderAllocation(period) {
    allocation.querySelector('.card-top p').textContent = period === 'spending' ? 'Latest published spending allocation · reporting year not supplied' : `Spending allocation · ${period.slice(-4)}`;
    const items = (data?.[period]?.[0]?.data || []).filter(item => typeof item.name === 'string' && Number.isFinite(Number(item.y)));
    const colors = assignSeriesColors(items.map(item => ({id: `spending:${item.name}`})));
    const rows = items.map((item, index) => {
      const row = document.createElement('div');
      row.className = 'spending-row';
      const label = document.createElement('span');
      label.textContent = item.name;
      const track = document.createElement('div');
      track.className = 'spending-track';
      const fill = document.createElement('div');
      fill.style.width = `${Math.max(0, Math.min(100, Number(item.y)))}%`;
      fill.style.background = colors[index];
      fill.style.boxShadow = `inset 0 0 0 1.25px ${contrastInk(colors[index])}`;
      track.append(fill);
      const amount = document.createElement('strong');
      amount.textContent = `${Number(item.y)}%`;
      row.append(label, track, amount);
      return row;
    });
    allocation.querySelector('.spending-allocation').replaceChildren(...rows);
  }
  if (periods.length) {
    const label = document.createElement('label');
    label.className = 'allocation-period';
    label.append('Reporting period ');
    const select = document.createElement('select');
    select.add(new Option('Latest published · year not supplied', 'spending'));
    for (const period of periods) select.add(new Option(period.slice(-4), period));
    label.append(select);
    allocation.querySelector('.card-top').append(label);
    select.addEventListener('change', () => renderAllocation(select.value));
  }
  renderAllocation('spending');
  container.append(allocation);
  return {redraw: renderCharts};
}
