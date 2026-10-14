import test from 'node:test';
import assert from 'node:assert/strict';
import {annualDonationRows, monthlyComparisonSeries, monthlyDonationRows, monthlyDonationTimeline, sameMonthAnnualComparison} from '../../docs/media/js/funding-model.mjs';

test('monthly rows preserve real dates, zero observations, and input data', () => {
  const data = {donations_monthly: {'2026': {'3': 15, '1': 0}, '2025': {'12': 40, '2': 20}}};
  const before = structuredClone(data);
  assert.deepEqual(monthlyDonationRows(data), [
    ['2025-02-01', {value: 20}], ['2025-12-01', {value: 40}],
    ['2026-01-01', {value: 0}], ['2026-03-01', {value: 15}],
  ]);
  annualDonationRows(data);
  monthlyComparisonSeries(data, {cumulative: true});
  assert.deepEqual(data, before);
});

test('published annual totals remain complete despite partial monthly coverage; derived totals disclose partial years', () => {
  const data = {
    donations_yearly: {'2018': 900, '2025': 7000},
    donations_monthly: {'2025': {'1': 20, '2': 30}, '2026': {'1': 10, '2': 0, '3': 15}},
  };
  assert.deepEqual(annualDonationRows(data), [
    ['2018-01-01', {year: '2018', value: 900, months: null, throughMonth: null, partial: false, published: true}],
    ['2025-01-01', {year: '2025', value: 7000, months: 2, throughMonth: 2, partial: false, published: true}],
    ['2026-01-01', {year: '2026', value: 25, months: 3, throughMonth: 3, partial: true, published: false}],
  ]);
});

test('year comparisons align January–December, retain real source dates, and leave future months blank', () => {
  const data = {donations_monthly: {'2025': {'1': 10, '2': 20, '12': 30}, '2026': {'1': 15, '2': 25}}};
  const result = monthlyComparisonSeries(data);
  assert.equal(result.startDate, '2000-01-01');
  assert.equal(result.endDate, '2000-12-01');
  assert.deepEqual(result.series.map(s => [s.id, s.name, s.visible, s.values.length]), [
    ['2026', '2026', true, 12], ['2025', '2025', true, 12],
  ]);
  assert.deepEqual(result.series[0].values[0], {date: '2000-01-01', value: 15, sourceDate: '2026-01-01', missing: false});
  assert.deepEqual(result.series[0].values[2], {date: '2000-03-01', value: null, sourceDate: '2026-03-01', missing: true});
  assert.equal(result.series[1].values[11].value, 30);
  assert.deepEqual(result.coverage, [
    {year: '2026', months: 2, observedMonths: [1, 2], throughMonth: 2, partial: true},
    {year: '2025', months: 3, observedMonths: [1, 2, 12], throughMonth: 12, partial: true},
  ]);
});

test('cumulative comparisons never bridge missing months, including a missing January', () => {
  const data = {donations_monthly: {'2026': {'1': 10, '2': 0, '4': 30}, '2025': {'2': 20, '3': 40}}};
  const {series} = monthlyComparisonSeries(data, {cumulative: true, anchorYear: 2024});
  assert.deepEqual(series[0].values.map(p => p.value), [10, 10, null, null, null, null, null, null, null, null, null, null]);
  assert.ok(series[1].values.every(p => p.value === null && p.missing));
  assert.equal(series[0].values[0].date, '2024-01-01');
  // A reported April remains visible in monthly mode, despite the March gap.
  assert.equal(monthlyComparisonSeries(data).series[0].values[3].value, 30);
});

test('monthly timeline fills missing months and years without extending beyond published data', () => {
  const points = monthlyDonationTimeline({donations_monthly: {'2024': {'12': 10}, '2026': {'2': 0}}});
  assert.equal(points.length, 15);
  assert.deepEqual(points[0], {date: '2024-12-01', sourceDate: '2024-12-01', value: 10, missing: false});
  assert.deepEqual(points[1], {date: '2025-01-01', sourceDate: '2025-01-01', value: null, missing: true});
  assert.deepEqual(points.at(-1), {date: '2026-02-01', sourceDate: '2026-02-01', value: 0, missing: false});
  assert.deepEqual(monthlyDonationTimeline({}), []);
});

test('matched annual comparisons use exactly the reference months and exclude missing monthly detail', () => {
  const data = {
    donations_yearly: {'2018': 500, '2024': 9999},
    donations_monthly: {
      '2024': {'1': 10, '2': 20, '3': 30, '12': 400},
      '2025': {'1': 15, '2': 25},
      '2026': {'1': 20, '3': 40},
    },
  };
  const result = sameMonthAnnualComparison(data);
  assert.equal(result.referenceYear, '2026');
  assert.deepEqual(result.months, [1, 3]);
  assert.deepEqual(result.excludedYears, ['2018', '2025']);
  assert.deepEqual(result.rows.map(([, row]) => [row.year, row.value, row.months, row.partial]), [
    ['2024', 40, 2, false], ['2026', 60, 2, false],
  ]);
  assert.deepEqual(sameMonthAnnualComparison({}), {rows: [], months: [], referenceYear: null, excludedYears: []});
});

test('invalid or missing amounts cannot become fabricated zero observations', () => {
  const data = {
    donations_yearly: {'2024': Infinity, '2025': null, '2026': 0, bad: 10},
    donations_monthly: {
      bad: {'1': 50}, '0000': {'1': 50},
      '2024': {'0': 10, '13': 20, '1': NaN, '2': null, '3': '30', '4': Infinity},
      '2025': {'01': 2.5, '2': -0.5, '3': 0},
    },
  };
  assert.deepEqual(monthlyDonationRows(data), [
    ['2025-01-01', {value: 2.5}], ['2025-02-01', {value: -0.5}], ['2025-03-01', {value: 0}],
  ]);
  assert.deepEqual(annualDonationRows(data).map(([, r]) => [r.year, r.value]), [['2025', 2], ['2026', 0]]);
  assert.deepEqual(monthlyDonationRows(null), []);
  assert.deepEqual(annualDonationRows(), []);
  assert.deepEqual(monthlyComparisonSeries({}).series, []);
  assert.throws(() => monthlyComparisonSeries({}, {anchorYear: 0}), RangeError);
  assert.throws(() => monthlyComparisonSeries({}, {anchorYear: 2024.5}), RangeError);
});

test('a partial 2026 snapshot compares against seven complete years without inventing future donations', () => {
  // Freeze this scenario so a routine refresh of financials.json does not break the regression.
  const data = {
    donations_yearly: {'2017': 736285, '2018': 1205449},
    donations_monthly: Object.fromEntries(Array.from({length: 7}, (_, index) => [
      String(2019 + index),
      Object.fromEntries(Array.from({length: 12}, (_, month) => [String(month + 1), (month + 1) * 100])),
    ])),
  };
  data.donations_monthly['2026'] = {'1': 737379, '2': 482836, '3': 393261};
  const result = monthlyComparisonSeries(data);
  assert.equal(result.series.length, 8);
  assert.deepEqual(result.coverage[0], {year: '2026', months: 3, observedMonths: [1, 2, 3], throughMonth: 3, partial: true});
  assert.ok(result.coverage.slice(1).every(year => year.months === 12 && !year.partial));
  assert.equal(result.series[0].values[2].value, 393261);
  assert.ok(result.series[0].values.slice(3).every(point => point.value === null));
  const annual = annualDonationRows(data);
  assert.equal(annual.at(-1)[1].value, 1613476);
  assert.equal(annual[0][1].value, data.donations_yearly['2017']);
  assert.equal(annual[0][1].published, true);
});
