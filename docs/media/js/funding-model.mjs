/** Pure transformations of the published financial data; no rendering or mutation. */
const validYear = value => /^\d{4}$/.test(value) && Number(value) > 0;
const finiteAmount = value => typeof value === 'number' && Number.isFinite(value);
const monthDate = (year, month) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;

function monthlyObservations(data) {
  const years = new Map();
  for (const [year, entries] of Object.entries(data?.donations_monthly || {})) {
    if (!validYear(year) || !entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    const months = new Map();
    for (const [key, value] of Object.entries(entries)) {
      if (!/^(?:0?[1-9]|1[0-2])$/.test(key) || !finiteAmount(value)) continue;
      months.set(Number(key), value);
    }
    if (months.size) years.set(year, new Map([...months].sort(([a], [b]) => a - b)));
  }
  return years;
}

function monthCoverage(year, observations) {
  const observedMonths = [...observations.keys()];
  return {
    year,
    months: observedMonths.length,
    observedMonths,
    throughMonth: observedMonths.at(-1) ?? null,
    partial: observedMonths.length < 12,
  };
}

/** Monthly observations on their real dates. Missing months are not invented. */
export function monthlyDonationRows(data) {
  return [...monthlyObservations(data)]
    .flatMap(([year, months]) => [...months].map(([month, value]) => [monthDate(year, month), {value}]))
    .sort(([a], [b]) => a.localeCompare(b));
}

/** Fill calendar-month gaps only between the first and last reported month. */
export function monthlyDonationTimeline(data) {
  const rows = monthlyDonationRows(data);
  if (!rows.length) return [];
  const values = new Map(rows.map(([date, {value}]) => [date, value]));
  const points = [];
  const [firstYear, firstMonth] = rows[0][0].split('-').map(Number);
  const [lastYear, lastMonth] = rows.at(-1)[0].split('-').map(Number);
  for (let cursor = firstYear * 12 + firstMonth - 1; cursor <= lastYear * 12 + lastMonth - 1; cursor++) {
    const date = monthDate(Math.floor(cursor / 12), cursor % 12 + 1);
    const value = values.get(date) ?? null;
    points.push({date, sourceDate: date, value, missing: value === null});
  }
  return points;
}

/** Compare exactly the months reported for the latest year with monthly detail. */
export function sameMonthAnnualComparison(data) {
  const monthly = monthlyObservations(data);
  const referenceYear = [...monthly.keys()].sort().at(-1) ?? null;
  const months = referenceYear ? [...monthly.get(referenceYear).keys()] : [];
  const excludedYears = [];
  const rows = [];
  for (const [date, annual] of annualDonationRows(data)) {
    const observations = monthly.get(annual.year);
    if (!months.length || !observations || !months.every(month => observations.has(month))) {
      excludedYears.push(annual.year);
      continue;
    }
    rows.push([date, {
      year: annual.year,
      value: months.reduce((sum, month) => sum + observations.get(month), 0),
      months: months.length,
      throughMonth: months.at(-1),
      partial: false,
      published: false,
    }]);
  }
  return {rows, months, referenceYear, excludedYears};
}

/**
 * Published annual figures take precedence over sums of monthly observations.
 * Published-only years have unknown monthly coverage, rather than zero months.
 * A published annual total is complete even when monthly detail is incomplete.
 */
export function annualDonationRows(data) {
  const monthly = monthlyObservations(data);
  const published = new Map(Object.entries(data?.donations_yearly || {})
    .filter(([year, value]) => validYear(year) && finiteAmount(value)));
  const years = [...new Set([...monthly.keys(), ...published.keys()])].sort();
  return years.map(year => {
    const observations = monthly.get(year);
    const coverage = observations ? monthCoverage(year, observations) : {
      year, months: null, throughMonth: null, partial: false,
    };
    const value = published.has(year)
      ? published.get(year)
      : [...observations.values()].reduce((sum, amount) => sum + amount, 0);
    return [monthDate(year, 1), {
      value,
      year,
      months: coverage.months,
      partial: !published.has(year) && coverage.partial,
      throughMonth: coverage.throughMonth,
      published: published.has(year),
    }];
  });
}

/**
 * Align years to January–December as in the original monthly area comparison.
 * Series remain independent: consumers must use overlaid, never stacked, years.
 * Cumulative totals require every month from January through the plotted month.
 */
export function monthlyComparisonSeries(data, {cumulative = false, anchorYear = 2000} = {}) {
  if (!Number.isInteger(anchorYear) || anchorYear < 1 || anchorYear > 9999) {
    throw new RangeError('The comparison anchor year must be an integer from 1 to 9999.');
  }
  const years = [...monthlyObservations(data)].sort(([a], [b]) => b.localeCompare(a));
  const coverage = years.map(([year, months]) => monthCoverage(year, months));
  const series = years.map(([year, months]) => {
    let runningTotal = 0;
    let complete = true;
    const values = Array.from({length: 12}, (_, index) => {
      const month = index + 1;
      const reported = months.has(month);
      complete &&= reported;
      if (reported) runningTotal += months.get(month);
      const value = cumulative
        ? complete ? runningTotal : null
        : reported ? months.get(month) : null;
      return {
        date: monthDate(anchorYear, month),
        value,
        sourceDate: monthDate(year, month),
        missing: value === null,
      };
    });
    return {id: year, name: year, visible: true, values};
  });
  return {
    series,
    startDate: monthDate(anchorYear, 1),
    endDate: monthDate(anchorYear, 12),
    coverage,
  };
}
