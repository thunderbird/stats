import test from 'node:test';
import assert from 'node:assert/strict';
import {formatPercentage, presetDateRange, orderSeriesByValue} from '../../docs/media/js/chart.mjs';

test('percentage labels retain tiny nonzero values instead of rounding to zero', () => {
  assert.equal(formatPercentage(0), '0%');
  assert.equal(formatPercentage(0.000001), '<0.1%');
  assert.equal(formatPercentage(0.049), '<0.1%');
  assert.equal(formatPercentage(0.1), '0.1%');
  assert.equal(formatPercentage(12.34), '12.3%');
  assert.equal(formatPercentage(100), '100%');
  assert.equal(formatPercentage(null), '—');
  assert.equal(formatPercentage(NaN), '—');
});

test('annual chart presets cover five and ten calendar years, clamped to history', () => {
  assert.deepEqual(presetDateRange('5y', '2000-01-01', '2026-10-13'), {
    range: '5y', startDate: '2021-10-13', endDate: '2026-10-13',
  });
  assert.deepEqual(presetDateRange('10y', '2000-01-01', '2026-10-13'), {
    range: '10y', startDate: '2016-10-13', endDate: '2026-10-13',
  });
  assert.deepEqual(presetDateRange('10y', '2020-01-01', '2026-10-13'), {
    range: '10y', startDate: '2020-01-01', endDate: '2026-10-13',
  });
  assert.equal(presetDateRange('5y', '2000-01-01', '2024-02-29').startDate, '2019-02-28');
});

test('series ranking preserves tied categories and distinguishes zero from unavailable values', () => {
  const series = [
    {id: 'missing', value: null}, {id: 'small', value: 20.7},
    {id: 'large', value: 62.5}, {id: 'tie', value: 20.7},
    {id: 'zero', value: 0}, {id: 'invalid', value: NaN},
  ];
  const original = [...series];
  assert.deepEqual(orderSeriesByValue(series, item => item.value).map(item => item.id), ['large', 'small', 'tie', 'zero', 'missing', 'invalid']);
  assert.deepEqual(series, original);
});
