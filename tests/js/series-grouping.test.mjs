import test from 'node:test';
import assert from 'node:assert/strict';
import {groupSmallSeries} from '../../docs/media/js/series-grouping.mjs';

const series = (id, shares, extra = {}) => ({
  id, name: id, visible: true, ...extra,
  values: shares.map((percent, index) => ({date: `2026-09-0${index + 1}`, value: percent == null ? null : percent * 1000,
    percent, total: 100000, missing: percent == null})),
});

test('groups strictly sub-0.1% series, preserving historically significant series and exact totals', () => {
  const input = [series('large', [99.8, 99.7]), series('boundary', [0.1, 0.1]),
    series('historical', [0.1, 0.05]), series('tiny-a', [0, 0.04]), series('tiny-b', [0, 0.03])];
  const original = structuredClone(input);
  const result = groupSmallSeries(input);
  assert.deepEqual(result.map(s => s.name), ['large', 'boundary', 'historical', 'Other']);
  assert.deepEqual(result.at(-1).members, ['tiny-a', 'tiny-b']);
  assert.equal(result.at(-1).values[1].value, 70);
  assert.equal(result.at(-1).values[1].percent, 0.07);
  assert.equal(result.at(-1).values[1].total, 100000);
  for (let i = 0; i < 2; i++) assert.equal(result.reduce((sum, s) => sum + s.values[i].value, 0), input.reduce((sum, s) => sum + s.values[i].value, 0));
  assert.deepEqual(input, original);
  assert.equal(groupSmallSeries(input, {enabled: false}), input);
});

test('retains source aggregates, version cutoffs and intentionally hidden series', () => {
  const input = [series('__other__', [0.03], {name: 'Other (publication aggregate)'}),
    series('versions-through:128', [0.03], {name: '128 and below'}),
    series('other-release-versions', [0.03], {name: 'Other Release versions'}),
    series('hidden', [0.03], {visible: false}), series('tiny', [0.03])];
  const result = groupSmallSeries(input);
  assert.deepEqual(result.slice(0, 4), input.slice(0, 4));
  assert.deepEqual(result.at(-1).members, ['tiny']);
});

test('missing observations stay missing, while partially published sums are explicit', () => {
  const result = groupSmallSeries([series('a', [null, 0.02, 0.02]), series('b', [null, null, 0.01])]).at(-1);
  assert.equal(result.values[0].missing, true);
  assert.equal(result.values[0].value, null);
  assert.equal(result.values[0].percent, null);
  assert.equal(result.values[1].value, 20);
  assert.equal(result.values[1].percent, 0.02);
  assert.equal(result.values[1].incomplete, true);
  assert.match(result.values[1].note, /1 grouped series is unavailable.*published values only/);
  assert.equal(result.values[2].value, 30);
  assert.equal(result.values[2].incomplete, false);
});

test('never infers a small share from a missing denominator or conflicting populations', () => {
  const unknown = series('unknown', [0.02, 0.02]);
  unknown.values[0].percent = null;
  assert.equal(groupSmallSeries([unknown])[0], unknown);
  const a = series('a', [0.01]), b = series('b', [0.01]);
  b.values[0].total = 200000;
  assert.equal(groupSmallSeries([a, b]).at(-1).values[0].total, null);
});

test('group membership can follow a new range without rewriting data outside it', () => {
  const input = [series('old', [20, 0.01]), series('small', [0.02, 0.02])];
  assert.deepEqual(groupSmallSeries(input).at(-1).members, ['small']);
  const selected = input.map(s => ({...s, values: s.values.slice(1)}));
  assert.deepEqual(groupSmallSeries(selected).at(-1).members, ['old', 'small']);
  assert.equal(input[0].values[0].value, 20000);
});

test('unknown-only series remain distinct and generated identifiers do not collide with labels', () => {
  const input = [series('__small-series__', [0.01]), series('unknown-only', [null]), series('tiny', [0.02])];
  const result = groupSmallSeries(input);
  assert.equal(result.at(-1).id, '__small-series___');
  assert.deepEqual(result.at(-1).members, ['tiny']);
  assert.equal(new Set(result.map(s => s.id)).size, result.length);
});
