import test from 'node:test';
import assert from 'node:assert/strict';
import {assignSeriesColors, buildSeries, CHANNELS, compareVersions, colorForSeries, createPresetGroups, matchesVersionSelector, normalizeReleases, resolveLatestEsr, resolveLatestRelease} from '../../docs/media/js/explorer-model.mjs';
import {movingAverage, normalizeOverview, presetDateRange} from '../../docs/media/js/chart.mjs';

const releases = [
  {date: '2023-07-11', version: '115.0', channel: 'esr', update_channel: 'release'},
  {date: '2024-07-11', version: '128.0', channel: 'esr', update_channel: 'esr'},
  {date: '2024-08-01', version: '115.13.1', channel: 'esr', update_channel: 'release'},
  {date: '2024-08-06', version: '128.1.0', channel: 'esr', update_channel: 'esr'},
  {date: '2025-07-01', version: '140.0', channel: 'esr', update_channel: 'esr'},
];

const records = [
  {date: '2024-07-10', count: 100, channels: {release: {'115.12.2': 70, '127.0': 20}, beta: {'128.0b1': 8}, nightly: {'129.0a1': 2}}},
  {date: '2024-07-11', count: 100, channels: {esr: {'128.0': 40}, release: {'115.12.2': 30, '128.0': 20}, beta: {'129.0b1': 8}, nightly: {'130.0a1': 2}}},
  {date: '2024-08-06', count: 100, channels: {esr: {'128.0': 15, '128.1.0': 45}, release: {'115.13.1': 10, '129.0': 20}, beta: {'130.0b1': 8}, nightly: {'131.0a1': 2}}},
];

function point(result, id, date) {
  return result.series.find(series => series.id === id).values.find(value => value.date === date);
}

test('versions compare numeric parts and prerelease stages; major selectors include their family', () => {
  assert.ok(compareVersions('128.10.0', '128.9.1') > 0);
  assert.ok(compareVersions('128.0a2', '128.0a10') < 0);
  assert.ok(compareVersions('128.0b8', '128.0rc1') < 0);
  assert.ok(compareVersions('128.0rc1', '128.0esr') < 0);
  assert.equal(compareVersions('128.0', '128.0.0esr'), 0);
  assert.equal(matchesVersionSelector('115.18.3', '115'), true);
  assert.equal(matchesVersionSelector('115.18.3', '115.*'), true);
  assert.equal(matchesVersionSelector('115.18.3', '=115.0'), false);
  assert.equal(matchesVersionSelector('128.10.0', '>=115 <129'), true);
  assert.equal(matchesVersionSelector('115.18.3', '102..115'), true);
  assert.equal(matchesVersionSelector('116.0', '102..115'), false);
});

test('stage selectors match parsed version labels without treating release candidates as beta or nightly', () => {
  for (const version of ['153b1', '153.0b12', '153.0B2']) {
    assert.equal(matchesVersionSelector(version, 'stage:beta'), true);
    assert.equal(matchesVersionSelector(version, 'stage:nightly'), false);
  }
  assert.equal(matchesVersionSelector('154.0a1', 'stage:nightly'), true);
  assert.equal(matchesVersionSelector('154a2', 'STAGE:NIGHTLY'), true);
  assert.equal(matchesVersionSelector('153b1', 'stage:beta >=152 <154'), true);
  assert.equal(matchesVersionSelector('154b1', 'stage:beta >=152 <154'), true);
  assert.equal(matchesVersionSelector('155b1', 'stage:beta >=152 <154'), false);
  assert.equal(matchesVersionSelector('153.0', 'stage:release'), true);
  assert.equal(matchesVersionSelector('140.3.0esr', 'stage:release'), true);
  for (const selector of ['stage:beta', 'stage:nightly', 'stage:release']) {
    assert.equal(matchesVersionSelector('153.0rc1', selector), false);
    assert.equal(matchesVersionSelector('custom-beta-build', selector), false);
  }
  assert.equal(matchesVersionSelector('stage:unknown', 'stage:unknown'), false);
});

test('prerelease build presets expose historical version labels while retaining totals and missing days', () => {
  const historical = [
    {date: '2025-01-01', count: 100, versions: {'115.16.0': 60, '153b1': 25, '154.0a1': 10, '153.0rc1': 5}},
    {date: '2025-01-03', count: 80, versions: {'153.0b2': 20, '154a2': 15, '140.3.0': 40}},
  ];
  const original = structuredClone(historical);
  const groups = createPresetGroups('prerelease-builds');
  assert.deepEqual(groups.map(group => group.id), ['beta-builds', 'nightly-builds', 'remainder']);
  assert.ok(groups.slice(0, 2).every(group => !group.channels && /version|suffix/i.test(group.description)));
  const result = buildSeries(historical, {grouping: 'custom', groups});
  assert.equal(point(result, 'beta-builds', '2025-01-01').value, 25);
  assert.equal(point(result, 'nightly-builds', '2025-01-01').value, 10);
  assert.equal(point(result, 'remainder', '2025-01-01').value, 65);
  assert.equal(point(result, 'beta-builds', '2025-01-03').value, 20);
  assert.equal(point(result, 'nightly-builds', '2025-01-03').value, 15);
  // Five observations without even a version label stay in the remainder.
  assert.equal(point(result, 'remainder', '2025-01-03').value, 45);
  assert.equal(result.hasChannelData, false);
  assert.equal(result.overlap, false);
  for (const date of ['2025-01-01', '2025-01-03']) {
    const total = result.totals.find(point => point.date === date).value;
    assert.equal(result.series.reduce((sum, series) => sum + series.values.find(point => point.date === date).value, 0), total);
  }
  assert.deepEqual(result.totals[1], {date: '2025-01-02', value: null, missing: true});
  assert.ok(result.series.every(series => series.values[1].value === null));
  assert.deepEqual(historical, original);
  const channels = buildSeries(historical, {grouping: 'channels'});
  assert.equal(point(channels, 'channel:unknown', '2025-01-01').value, 100);
  assert.equal(point(channels, 'channel:beta', '2025-01-01').value, 0);
  assert.equal(point(channels, 'channel:nightly', '2025-01-01').value, 0);
});

test('individual build presets obey explicit recorded-channel filters without inferring channel names', () => {
  const observed = [{date: '2025-01-01', count: 10, channels: {release: {'153b1': 6}, beta: {'153.0': 3}, nightly: {'154a1': 1}}}];
  const beta = buildSeries(observed, {grouping: 'custom', groups: createPresetGroups('beta-builds')});
  assert.deepEqual(beta.series.map(series => series.id), ['beta-builds', 'remainder']);
  assert.equal(point(beta, 'beta-builds', '2025-01-01').value, 6);
  assert.equal(point(beta, 'remainder', '2025-01-01').value, 4);
  const nightly = buildSeries(observed, {grouping: 'custom', groups: createPresetGroups('nightly-builds'), channels: ['release', 'beta']});
  assert.deepEqual(nightly.series.map(series => series.id), ['nightly-builds', 'remainder']);
  assert.equal(point(nightly, 'nightly-builds', '2025-01-01').value, 0);
  assert.equal(point(nightly, 'remainder', '2025-01-01').value, 9);
});

test('latest ESR uses release dates and family ordering, including older ESR patch releases', () => {
  assert.equal(resolveLatestEsr('2023-07-10', releases), null);
  assert.equal(resolveLatestEsr('2024-07-10', releases).major, 115);
  assert.equal(resolveLatestEsr('2024-07-11', releases).major, 128);
  assert.equal(resolveLatestEsr('2024-08-02', releases).version, '128.0');
  assert.equal(resolveLatestEsr('2024-08-06', releases).version, '128.1.0');
  assert.equal(resolveLatestEsr('2025-08-06', releases, {pinnedMajor: 128}).version, '128.1.0');
  assert.deepEqual(normalizeReleases([{date: '2024-02-30', version: '128.0'}, {date: '2024-02-02', version: '129.0', channel: 'beta'}]), []);
});

test('latest ESR follows dated channel metadata from historical release to actual ESR', () => {
  const result = buildSeries(records, {grouping: 'custom', groups: [{id: 'latest', latestEsr: 'historical'}]}, releases);
  assert.equal(point(result, 'latest', '2024-07-10').value, 70);
  assert.equal(point(result, 'latest', '2024-07-11').value, 40);
  assert.equal(point(result, 'latest', '2024-08-06').value, 60);
  assert.equal(point(result, 'remainder', '2024-07-11').value, 60);
});

test('latest ESR patch and pinned family operate independently', () => {
  const latest = buildSeries(records, {grouping: 'custom', groups: [{id: 'patch', latestEsr: 'historical', latestPatch: true}]}, releases);
  assert.equal(point(latest, 'patch', '2024-08-06').value, 45);
  const pinned = buildSeries(records, {grouping: 'custom', groups: [{id: 'pinned', latestEsr: 'pinned', pinnedMajor: 115}]}, releases);
  assert.equal(point(pinned, 'pinned', '2024-07-11').value, 30);
  assert.equal(point(pinned, 'pinned', '2024-08-06').value, 10);
  const missingPin = buildSeries(records, {grouping: 'custom', groups: [{id: 'pinned', latestEsr: 'pinned'}]}, releases);
  assert.equal(point(missingPin, 'pinned', '2024-08-06').value, 0);
  assert.match(missingPin.warnings.join(' '), /Choose a version family/);
});

test('stacked overlap uses first match and a complete remainder without changing percentages when hidden', () => {
  const groups = [
    {id: 'first', channels: ['esr'], versions: ['115', '128'], visible: false},
    {id: 'second', versions: ['128']},
  ];
  const result = buildSeries(records.slice(1, 2), {grouping: 'custom', groups, mode: 'percent'});
  assert.equal(result.overlap, true);
  assert.equal(result.series.find(series => series.id === 'first').visible, false);
  assert.equal(point(result, 'first', '2024-07-11').value, 40);
  assert.equal(point(result, 'second', '2024-07-11').value, 20);
  assert.equal(point(result, 'second', '2024-07-11').percent, 20);
  assert.equal(point(result, 'remainder', '2024-07-11').value, 40);
  assert.equal(result.series.reduce((sum, series) => sum + series.values[0].value, 0), 100);
  assert.equal(result.totals[0].value, 100);
});

test('comparison lines allow explicit overlapping cohorts but remainder includes only unmatched observations', () => {
  const result = buildSeries(records.slice(1, 2), {grouping: 'custom', mode: 'lines', groups: [{id: 'esr', channels: ['esr']}, {id: '128', versions: ['128']}]});
  assert.equal(result.overlap, true);
  assert.equal(point(result, 'esr', '2024-07-11').value, 40);
  assert.equal(point(result, '128', '2024-07-11').value, 60);
  assert.equal(point(result, 'remainder', '2024-07-11').value, 40);
  assert.equal(result.totals[0].value, 100);
});

test('channel filters define the denominator and preserve all selected versions', () => {
  const result = buildSeries(records.slice(1, 2), {grouping: 'major', channels: ['esr', 'beta']});
  assert.equal(result.totals[0].value, 48);
  assert.equal(point(result, 'major:128:esr', '2024-07-11').value, 40);
  assert.equal(point(result, 'major:128:esr', '2024-07-11').percent, 40 / 48 * 100);
  assert.equal(result.selectedChannels.includes('release'), false);
});

test('legacy unlabelled versions remain unknown and partial channel counts reconcile without duplication', () => {
  const result = buildSeries([
    {date: '2024-01-01', count: 100, versions: {'115.6.0': 100}},
    {date: '2024-01-02', count: 100, versions: {'115.6.0': 80, '128.0': 20}, channels: {esr: {'115.6.0': 60}, release: {'128.0': 20}}},
  ]);
  assert.equal(point(result, 'channel:unknown', '2024-01-01').value, 100);
  assert.equal(point(result, 'channel:esr', '2024-01-01').value, 0);
  assert.equal(point(result, 'channel:unknown', '2024-01-02').value, 20);
  assert.equal(result.totals[1].value, 100);
  assert.equal(result.hasChannelData, true);
  assert.match(result.warnings.join(' '), /Unknown channel/);
  assert.equal(buildSeries([{date: '2024-01-01', count: 100, versions: {'115.6.0': 100}}]).hasChannelData, false);
});

test('missing days and zero population are different observations', () => {
  const result = buildSeries([
    {date: '2024-01-01', count: 5, versions: {'115.0': 5}},
    {date: '2024-01-03', count: 0, versions: {}},
  ]);
  assert.equal(result.totals[1].date, '2024-01-02');
  assert.deepEqual(result.totals[1], {date: '2024-01-02', value: null, missing: true});
  assert.equal(point(result, 'channel:unknown', '2024-01-02').value, null);
  assert.equal(point(result, 'channel:unknown', '2024-01-03').value, 0);
  assert.equal(point(result, 'channel:unknown', '2024-01-03').missing, false);
  assert.equal(point(result, 'channel:unknown', '2024-01-03').percent, null);
});

test('channel-only views leave legacy days without recorded channels missing', () => {
  const result = buildSeries([
    {date: '2024-01-01', count: 100, versions: {'115': 100}},
    {date: '2024-01-02', count: 100, channels: {esr: {'115': 90}, release: {'115': 10}}},
  ], {grouping: 'channels', channels: ['esr']});
  assert.equal(result.totals[0].value, null);
  assert.equal(result.totals[0].missing, true);
  assert.equal(result.totals[1].value, 90);
});

test('filtered histories never join unclassified legacy totals to a different channel population', () => {
  const observations = [
    {date: '2026-07-11', count: 1000, versions: {'152.0': 400, '140.0': 600}},
    {date: '2026-07-12', count: 1000, channels: {release: {'152.0': 399}, unknown: {'152.0': 1}, esr: {'140.0': 600}}},
    {date: '2026-07-13', count: 1000, channels: {unknown: {'152.0': 1000}}},
    {date: '2026-07-14', count: 0, channels: {esr: {}, unknown: {}}},
  ];
  const source = structuredClone(observations);
  for (const grouping of ['major', 'versions', 'channels', 'custom']) for (const mode of ['count', 'percent', 'lines']) {
    const options = {grouping, mode, channels: ['esr', 'unknown'], versionCutoff: 128, combineReleaseVersions: false};
    const filtered = buildSeries(observations, options);
    assert.equal(filtered.totals[0].value, null);
    assert.equal(filtered.totals[0].missing, true);
    assert.match(filtered.totals[0].note, /Channel breakdown unavailable/);
    assert.ok(filtered.series.every(series => series.values[0].value === null && series.values[0].percent === null && series.values[0].note));
    assert.equal(filtered.totals[1].value, 601);
    assert.equal(filtered.totals[2].value, 1000); // Explicitly recorded Unknown is a valid channel observation.
    assert.equal(filtered.totals[3].value, 0);
    assert.equal(filtered.totals[3].missing, false);
    assert.match(filtered.warnings.join(' '), /Dates without channel breakdowns are hidden/);
    const full = buildSeries(observations, {...options, channels: CHANNELS});
    assert.deepEqual(full.totals.map(point => point.value), [1000, 1000, 1000, 0]);
    assert.ok(full.totals.every(point => !point.missing && !point.note));
    const none = buildSeries(observations, {...options, channels: []});
    assert.deepEqual(none.totals.map(point => point.value), [0, 0, 0, 0]);
    assert.deepEqual(none.series, []);
  }
  const unknown = buildSeries(observations, {channels: ['unknown']});
  assert.equal(unknown.totals[0].value, null);
  assert.equal(unknown.totals[1].value, 1);
  assert.equal(unknown.totals[2].value, 1000);
  assert.deepEqual(observations, source);
});

test('include/exclude rules combine channel, version families and limits', () => {
  const result = buildSeries(records.slice(1, 2), {grouping: 'custom', groups: [{id: 'group', minVersion: '115', maxVersion: '128', excludeVersions: ['128.0b1'], excludeChannels: ['release', 'nightly']} ]});
  assert.equal(point(result, 'group', '2024-07-11').value, 40);
  assert.equal(point(result, 'remainder', '2024-07-11').value, 60);
});

test('series caps aggregate exact remaining counts and colors remain stable when filtering', () => {
  const versions = Object.fromEntries(Array.from({length: 15}, (_, index) => [`${100 + index}.0`, index + 1]));
  const record = {date: '2024-01-01', count: 120, versions};
  const result = buildSeries([record], {grouping: 'major', maxSeries: 4});
  assert.equal(result.series.length, 4);
  assert.equal(result.series.reduce((sum, series) => sum + series.values[0].value, 0), 120);
  assert.equal(point(result, 'other-versions', record.date).value, 78);
  const same = buildSeries([record], {grouping: 'major', maxSeries: 6});
  assert.equal(result.series[0].color, same.series.find(series => series.id === result.series[0].id).color);
  assert.equal(colorForSeries('major:115'), colorForSeries('major:115'));
});

test('major and full-version views expose every recorded category by default', () => {
  const versions = Object.fromEntries(Array.from({length: 24}, (_, index) => [`${100 + index}.0`, index + 1]));
  const record = {date: '2024-01-01', count: 300, versions};
  for (const grouping of ['major', 'versions']) {
    const result = buildSeries([record], {grouping});
    assert.equal(result.series.length, 24);
    assert.equal(result.series.some(series => series.id === 'other-versions'), false);
    assert.equal(result.series.reduce((sum, series) => sum + series.values[0].value, 0), record.count);
    assert.deepEqual(result.series.map(series => series.id), buildSeries([record], {grouping, maxSeries: Infinity}).series.map(series => series.id));
    for (const [version, count] of Object.entries(versions)) {
      const id = grouping === 'major' ? `major:${version.split('.')[0]}` : `version:${version}`;
      assert.equal(point(result, id, record.date).value, count);
    }
  }
});

test('uncapped categories stay individually selectable without changing totals', () => {
  const versions = Object.fromEntries(Array.from({length: 12}, (_, index) => [`128.${index}`, index + 1]));
  const record = {date: '2024-01-01', count: 83, versions};
  const result = buildSeries([record], {grouping: 'versions', hiddenSeries: ['version:128.0']});
  assert.equal(result.series.length, 13);
  assert.equal(result.series.find(series => series.id === 'version:128.0').visible, false);
  assert.equal(point(result, 'version:128.0', record.date).value, 1);
  assert.equal(point(result, 'version:', record.date).value, 5);
  assert.equal(result.totals[0].value, 83);
});

test('ESR cutoffs combine entire older families while preserving totals, gaps and unreported versions', () => {
  const history = [
    {date: '2026-01-01', count: 1000, versions: {'115.18.3': 100, '128.13.0esr': 200, '128.0b1': 50, '129.0a1': 100, '140.1': 300, 'unrecognized': 25}},
    {date: '2026-01-03', count: 40, channels: {esr: {'128.13.0': 10, '140.3.0': 20}, release: {'129.0': 5}}},
  ];
  const grouping = 'major';
  for (const mode of ['percent', 'count', 'lines']) {
    const result = buildSeries(history, {grouping, mode, versionCutoff: 128});
    assert.equal(point(result, 'versions-through:128', '2026-01-01').value, 350);
    assert.equal(point(result, 'versions-through:128', '2026-01-01').percent, 35);
    assert.equal(point(result, 'versions-through:128', '2026-01-03').value, 10);
    assert.equal(result.series.find(series => series.id === 'versions-through:128').name, '128 and below');
    assert.ok(result.series.every(series => !/^(major:|version:)(115|128)(?:[.:]|$)/.test(series.id)));
    assert.ok(result.series.some(series => series.id === 'major:129'));
    assert.ok(result.series.every(series => series.values[1].missing && series.values[1].value === null));
    for (const date of ['2026-01-01', '2026-01-03']) {
      assert.equal(result.series.reduce((sum, series) => sum + point(result, series.id, date).value, 0), result.totals.find(point => point.date === date).value);
    }
    assert.equal(result.overlap, false);
    const higher = buildSeries(history, {grouping, versionCutoff: 140});
    assert.equal(point(higher, 'versions-through:140', '2026-01-01').value, 750);
    assert.equal(point(higher, 'versions-through:140', '2026-01-03').value, 35);
    const all = buildSeries(history, {grouping, versionCutoff: null});
    assert.ok(all.series.every(series => !series.id.startsWith('versions-through:')));
    assert.equal(point(all, 'major:128', '2026-01-01').value, 50);
    assert.equal(point(all, 'major:128:esr', '2026-01-01').value, 200);
  }
  const filtered = buildSeries(history, {grouping: 'major', versionCutoff: 128, channels: ['esr'], hiddenSeries: ['versions-through:128']});
  assert.equal(filtered.totals[0].value, null);
  assert.equal(filtered.totals[2].value, 30);
  assert.equal(point(filtered, 'versions-through:128', '2026-01-03').value, 10);
  assert.equal(filtered.series.find(series => series.id === 'versions-through:128').visible, false);
});

test('current Release uses dated publications rather than newer observed or prerelease labels', () => {
  const history = {releases, release_releases: [
    {date: '2026-09-01', version: '155.0', channel: 'release'},
    {date: '2026-09-30', version: '157.0', channel: 'release'},
    {date: '2026-10-05', version: '157.0.1', channel: 'release'},
    {date: '2026-10-10', version: '153.4.0', channel: 'release'},
    {date: '2026-10-12', version: '160.0b1', channel: 'release'},
    {date: '2026-10-28', version: '158.0', channel: 'release'},
  ]};
  assert.equal(resolveLatestRelease('2026-08-31', history), null);
  assert.equal(resolveLatestRelease('2026-09-29', history).major, 155);
  assert.equal(resolveLatestRelease('2026-10-12', history).version, '157.0.1');
  assert.equal(resolveLatestRelease('2026-10-28', history).major, 158);
  assert.equal(resolveLatestEsr('2026-10-12', history).major, 140);
});

test('ESR identities separate identical version numbers, preserve totals and use dated historical metadata', () => {
  const history = {releases: [
    {date: '2023-07-11', version: '115.0', channel: 'esr', update_channel: 'release'},
    {date: '2026-07-21', version: '153.0', channel: 'esr', update_channel: 'esr'},
  ]};
  const observations = [
    {date: '2026-07-20', count: 100, versions: {'153.0': 70, '157.0': 30}},
    {date: '2026-07-21', count: 100, channels: {
      esr: {'153.0': 40}, release: {'153.0': 20}, beta: {'153.0': 10},
      nightly: {'153.0a1': 5}, unknown: {'153.0': 25},
    }},
    {date: '2026-07-22', count: 100, channels: {
      esr: {'153.0': 10}, unknown: {'153.0esr': 10}, release: {'157.0': 80},
    }},
  ];
  const source = structuredClone(observations);
  for (const mode of ['count', 'percent', 'lines']) {
    const result = buildSeries(observations, {grouping: 'major', mode, currentReleaseMajor: 157, combineReleaseVersions: false}, history);
    assert.equal(result.series.find(series => series.id === 'major:153:esr').name, '153 ESR');
    assert.equal(result.series.find(series => series.id === 'major:153').name, '153');
    assert.notEqual(result.series.find(series => series.id === 'major:153:esr').color, result.series.find(series => series.id === 'major:153').color);
    assert.equal(point(result, 'major:153:esr', '2026-07-20').value, 0);
    assert.equal(point(result, 'major:153', '2026-07-20').value, 70);
    assert.equal(point(result, 'major:153:esr', '2026-07-21').value, 65);
    assert.equal(point(result, 'major:153', '2026-07-21').value, 35);
    assert.equal(point(result, 'major:153:esr', '2026-07-22').value, 20);
    for (let index = 0; index < result.totals.length; index++)
      assert.equal(result.series.reduce((sum, series) => sum + series.values[index].value, 0), 100);
    const detailed = buildSeries(observations, {grouping: 'versions', mode}, history);
    assert.equal(detailed.series.find(series => series.id === 'version:153.0:esr').name, '153.0 ESR');
    assert.equal(point(detailed, 'version:153.0:esr', '2026-07-21').value, 65);
    assert.equal(point(detailed, 'version:153.0', '2026-07-21').value, 30);
    assert.equal(point(detailed, 'version:153.0:esr', '2026-07-22').value, 20);
    const combined = buildSeries(observations, {grouping: 'major', mode, currentReleaseMajor: 157}, history);
    assert.equal(point(combined, 'other-release-versions', '2026-07-21').value, 20);
    assert.equal(point(combined, 'major:153:esr', '2026-07-21').value, 65);
    const custom = buildSeries(observations, {grouping: 'custom', mode, groups: [
      {id: 'esr', versions: ['=153.0'], esrVersion: true},
      {id: 'plain', versions: ['=153.0'], esrVersion: false},
    ]}, history);
    assert.equal(point(custom, 'esr', '2026-07-21').value, 65);
    assert.equal(point(custom, 'plain', '2026-07-21').value, 30);
  }
  const historical = buildSeries([{date: '2024-01-01', count: 80, channels: {
    release: {'115.6.0': 50}, unknown: {'115.6.0': 20}, beta: {'115.0b1': 10},
  }}], {grouping: 'major'}, history);
  assert.equal(point(historical, 'major:115:esr', '2024-01-01').value, 70);
  assert.equal(point(historical, 'major:115', '2024-01-01').value, 10);
  assert.deepEqual(observations, source);
});

test('Major-only Release buckets partition channels and ESR cutoffs without changing counts or detailed versions', () => {
  const observations = [{date: '2026-10-01', count: 120, channels: {
    release: {'157.0.1': 30, '157.0': 10, '156.0.1': 20, '144.0.1': 10, '128.14.0': 5},
    esr: {'153.4.0': 15, '156.0.1': 6}, beta: {'158.0': 8}, nightly: {'160.0a1': 4}, unknown: {'144.0.1': 7},
  }}, {date: '2026-10-03', count: 120, channels: {release: {'157.0.1': 120}}}];
  const options = {currentReleaseMajor: 157, versionCutoff: 128};
  for (const mode of ['percent', 'count', 'lines']) {
    const result = buildSeries(observations, {...options, grouping: 'major', mode});
    assert.equal(point(result, 'other-release-versions', '2026-10-01').value, 30);
    assert.equal(point(result, 'major:157', '2026-10-01').value, 40);
    assert.equal(point(result, 'versions-through:128', '2026-10-01').value, 5);
    assert.equal(point(result, 'major:156:esr', '2026-10-01').value, 6);
    assert.equal(point(result, 'major:144', '2026-10-01').value, 7);
    assert.equal(point(result, 'major:158', '2026-10-01').value, 8);
    assert.equal(point(result, 'major:160', '2026-10-01').value, 4);
    assert.equal(point(result, 'unreported-version', '2026-10-01').value, 5);
    assert.equal(result.series.reduce((sum, series) => sum + series.values[0].value, 0), 120);
    assert.equal(result.overlap, false);
    assert.ok(result.series.every(series => series.values[1].missing && series.values[1].value === null));
    const expanded = buildSeries(observations, {...options, grouping: 'major', mode, combineReleaseVersions: false});
    assert.ok(expanded.series.every(series => series.id !== 'other-release-versions'));
    assert.equal(point(expanded, 'major:156', '2026-10-01').value, 20);
    assert.equal(point(expanded, 'major:156:esr', '2026-10-01').value, 6);
    assert.equal(point(expanded, 'major:144', '2026-10-01').value, 17);
    assert.equal(point(expanded, 'major:157', '2026-10-01').value, 40);
    assert.equal(point(expanded, 'versions-through:128', '2026-10-01').value, 5);
    assert.equal(expanded.overlap, false);
    assert.deepEqual(expanded.totals, result.totals);
    for (const [index, total] of expanded.totals.entries()) {
      if (!total.missing) assert.equal(expanded.series.reduce((sum, series) => sum + series.values[index].value, 0), total.value);
      else assert.ok(expanded.series.every(series => series.values[index].missing && series.values[index].value === null));
    }
    const detailed = buildSeries(observations, {...options, grouping: 'versions', mode});
    assert.ok(detailed.series.every(series => !series.id.startsWith('versions-through:') && series.id !== 'other-release-versions'));
    assert.equal(point(detailed, 'version:156.0.1', '2026-10-01').value, 20);
    assert.equal(point(detailed, 'version:156.0.1:esr', '2026-10-01').value, 6);
    assert.equal(point(detailed, 'version:128.14.0', '2026-10-01').value, 5);
    assert.equal(detailed.series.reduce((sum, series) => sum + series.values[0].value, 0), 120);
    assert.deepEqual(buildSeries(observations, {...options, grouping: 'versions', mode, combineReleaseVersions: false}), detailed);
  }
  const all = buildSeries(observations, {...options, versionCutoff: null, grouping: 'major'});
  assert.equal(point(all, 'other-release-versions', '2026-10-01').value, 35);
  const esr = buildSeries(observations, {...options, grouping: 'major', channels: ['esr']});
  assert.ok(esr.series.every(series => series.id !== 'other-release-versions'));
  assert.equal(esr.totals[0].value, 21);
});

test('Release buckets remain consistent when legacy versions gain recorded channels', () => {
  const history = {
    releases: [
      {date: '2024-07-11', version: '128.0', channel: 'esr'},
      {date: '2025-07-02', version: '140.0', channel: 'esr'},
      {date: '2026-07-21', version: '153.0', channel: 'esr'},
    ],
    release_releases: [
      {date: '2026-07-01', version: '152.0.1', channel: 'release'},
      {date: '2026-06-16', version: '152.0', channel: 'release'},
      {date: '2025-07-02', version: '140.0', channel: 'release'},
      {date: '2026-07-21', version: '153.0', channel: 'release'},
      {date: '2026-09-30', version: '157.0', channel: 'release'},
      {date: '2026-10-28', version: '158.0', channel: 'release'},
      {date: '2026-05-01', version: '154.0a1', channel: 'release'},
    ],
  };
  const versions = {'152.0.1': 270, '152.0.5': 10, '152.0a1': 2, '152.0esr': 3,
    '140.12.0': 500, '128.14.0': 100, '157.0': 60, '158.0': 20, '153.0': 10, '154.0': 5, unparseable: 20};
  const observations = [
    {date: '2026-06-15', count: 1000, versions},
    {date: '2026-07-11', count: 1000, versions},
    {date: '2026-07-12', count: 1000, versions, channels: {
      release: {'152.0.1': 270, '152.0.5': 10, '157.0': 60, '128.14.0': 100},
      esr: {'140.12.0': 500, '152.0esr': 3}, beta: {'158.0': 20}, nightly: {'152.0a1': 2},
      unknown: {'153.0': 10, '154.0': 5, unparseable: 20},
    }},
  ];
  const source = structuredClone(observations);
  const options = {grouping: 'major', currentReleaseMajor: 157, versionCutoff: 128};
  for (const mode of ['percent', 'count', 'lines']) {
    const combined = buildSeries(observations, {...options, mode}, history);
    assert.equal(point(combined, 'other-release-versions', '2026-06-15').value, 0);
    assert.equal(point(combined, 'major:152', '2026-06-15').value, 282);
    assert.equal(point(combined, 'major:152:esr', '2026-06-15').value, 3);
    for (const date of ['2026-07-11', '2026-07-12']) {
      assert.equal(point(combined, 'other-release-versions', date).value, 280);
      assert.equal(point(combined, 'major:152', date).value, 2);
      assert.equal(point(combined, 'major:152:esr', date).value, 3);
      assert.equal(point(combined, 'major:140:esr', date).value, 500);
      assert.equal(point(combined, 'major:153', date).value, 10);
      assert.equal(point(combined, 'major:157', date).value, 60);
      assert.equal(point(combined, 'major:158', date).value, 20);
      assert.equal(point(combined, 'major:154', date).value, 5);
      assert.equal(point(combined, 'versions-through:128', date).value, 100);
      const index = combined.totals.findIndex(total => total.date === date);
      assert.equal(combined.series.reduce((sum, series) => sum + series.values[index].value, 0), 1000);
    }
    const expanded = buildSeries(observations, {...options, mode, combineReleaseVersions: false}, history);
    for (const date of ['2026-07-11', '2026-07-12']) {
      assert.equal(point(expanded, 'major:152', date).value, 282);
      assert.equal(point(expanded, 'major:152:esr', date).value, 3);
    }
    assert.ok(expanded.series.every(series => series.id !== 'other-release-versions'));
    assert.deepEqual(expanded.totals, combined.totals);
    const detailed = buildSeries(observations, {...options, mode, grouping: 'versions'}, history);
    for (const date of ['2026-07-11', '2026-07-12']) assert.equal(point(detailed, 'version:152.0.1', date).value, 270);
    assert.deepEqual(buildSeries(observations, {...options, mode, grouping: 'versions', combineReleaseVersions: false}, history), detailed);
  }
  // A filtered population is unknown before channel coverage; it must not be
  // compared to an earlier total that included all channels.
  const filtered = buildSeries(observations, {...options, channels: ['esr', 'beta', 'nightly', 'unknown']}, history);
  assert.equal(point(filtered, 'other-release-versions', '2026-07-11').value, null);
  assert.equal(point(filtered, 'other-release-versions', '2026-07-12').value, 0);
  assert.equal(filtered.totals.at(-1).value, 560);
  const recorded = buildSeries([{date: '2026-10-01', count: 30, channels: {
    release: {'153.0': 10}, esr: {'153.0': 10}, unknown: {'153.0': 10},
  }}], options, history);
  assert.equal(point(recorded, 'other-release-versions', '2026-10-01').value, 10);
  assert.equal(point(recorded, 'major:153:esr', '2026-10-01').value, 20);
  assert.deepEqual(observations, source);
});

test('duplicate group ids are made unique and empty channel selection cannot invent a population', () => {
  const options = {grouping: 'custom', groups: [{id: 'duplicate'}, {id: 'duplicate'}]};
  const withChannels = buildSeries(records.slice(0, 1), options);
  assert.equal(new Set(withChannels.series.map(series => series.id)).size, withChannels.series.length);
  const result = buildSeries(records.slice(0, 1), {...options, channels: []});
  assert.equal(new Set(result.series.map(series => series.id)).size, result.series.length);
  assert.equal(result.totals[0].value, 0);
  assert.equal(result.series.every(series => series.values[0].percent === null), true);
});

test('historical ESR presets use dated release membership and never relabel other release versions', () => {
  const groups = createPresetGroups('esr-families', releases);
  const result = buildSeries(records, {grouping: 'custom', groups}, releases);
  assert.equal(point(result, 'esr:115', '2024-07-10').value, 70);
  assert.equal(point(result, 'esr:115', '2024-08-06').value, 10);
  assert.equal(point(result, 'esr:128', '2024-07-11').value, 40);
  assert.equal(point(result, 'remainder', '2024-07-10').value, 30);
  const withPatch = buildSeries([
    {date: '2024-08-01', count: 100, channels: {release: {'115.13.1': 60, '115.12.2': 10, '129.0': 30}}},
  ], {grouping: 'custom', groups: [{id: 'patch', latestEsr: 'pinned', pinnedMajor: 115, latestPatch: true}]}, releases);
  assert.equal(point(withPatch, 'patch', '2024-08-01').value, 60);
});

test('default colors are distinct, preserve fixed families, and ignore visibility', () => {
  const versions = Object.fromEntries([115, 128, 140, 149, 150, 151, 152, 153, 154].map(major => [`${major}.0`, 10]));
  const record = {date: '2026-10-01', count: 90, versions};
  const result = buildSeries([record], {grouping: 'major'});
  assert.equal(new Set(result.series.map(series => series.color)).size, result.series.length);
  assert.equal(result.series.find(series => series.id === 'major:140').color, colorForSeries('major:140'));
  const hidden = buildSeries([record], {grouping: 'major', hiddenSeries: ['major:154', 'major:140']});
  assert.deepEqual(hidden.series.map(series => series.color), result.series.map(series => series.color));
});

test('series colors survive channel filters, changed dates, ordering, and fresh allocation', () => {
  const observations = [
    {date: '2026-10-01', count: 100, channels: {release: {'156.0': 60}, beta: {'157.0b1': 40}}},
    {date: '2026-10-02', count: 60, channels: {release: {'156.0': 60}}},
  ];
  const combined = buildSeries(observations, {grouping: 'major'});
  const onlyRelease = buildSeries(observations, {grouping: 'major', channels: ['release']});
  const nextDay = buildSeries(observations, {grouping: 'major', startDate: '2026-10-02'});
  const expected = combined.series.find(series => series.id === 'major:156').color;
  assert.equal(onlyRelease.series.find(series => series.id === 'major:156').color, expected);
  assert.equal(nextDay.series.find(series => series.id === 'major:156').color, expected);
  assert.equal(assignSeriesColors([{id: 'major:156'}])[0], expected);
  assert.deepEqual(assignSeriesColors([{id: 'major:157'}, {id: 'major:156'}]).reverse(), assignSeriesColors([{id: 'major:156'}, {id: 'major:157'}]));
  assert.deepEqual(assignSeriesColors([{id: 'custom', color: '#123456'}, {id: 'remainder', remainder: true}]), ['#123456', '#8493a7']);
  assert.notEqual(colorForSeries('major:156'), colorForSeries('major:157'));
  assert.deepEqual(assignSeriesColors([{id: 'imap'}, {id: 'smtp'}]).reverse(), assignSeriesColors([{id: 'smtp'}, {id: 'imap'}]));
});

test('top version cap prefers recent observations without losing old populations', () => {
  const result = buildSeries([
    {date: '2026-01-01', count: 2000, versions: {'115.0': 1000, '128.0': 1000}},
    {date: '2026-10-01', count: 100, versions: {'153.0': 60, '154.0': 40}},
  ], {grouping: 'major', maxSeries: 3});
  assert.deepEqual(result.series.map(series => series.id), ['major:154', 'major:153', 'other-versions']);
  assert.equal(point(result, 'other-versions', '2026-01-01').value, 2000);
  assert.equal(point(result, 'other-versions', '2026-10-01').value, 0);
});

test('overview totals cover the full history and distinguish missing from zero', () => {
  const result = normalizeOverview([
    {date: '2026-01-01', total: 12},
    {date: '2026-01-03', total: 0},
    {date: '2026-01-04', total: null},
  ]);
  assert.deepEqual(result.map(point => [point.date.toISOString().slice(0, 10), point.value, point.observed]), [
    ['2026-01-01', 12, true], ['2026-01-02', null, false], ['2026-01-03', 0, true], ['2026-01-04', null, false],
  ]);
});

test('moving averages use seven complete calendar days and recover after gaps', () => {
  const totals = Array.from({length: 16}, (_, i) => ({date: `2026-10-${String(i + 1).padStart(2, '0')}`, total: i + 1}));
  totals.splice(7, 1);
  const values = movingAverage(totals.reverse());
  assert.ok(values.slice(0, 6).every(point => point.value === null));
  assert.equal(values[6].value, 4);
  assert.ok(values.slice(7, 14).every(point => point.value === null));
  assert.equal(values[14].value, 12);
  assert.equal(values[15].value, 13);
  assert.equal(movingAverage(Array.from({length: 7}, (_, i) => ({date: `2026-10-0${i + 1}`, total: 0}))).at(-1).value, 0);
});

test('date presets clamp month ends and stay within the available history', () => {
  assert.deepEqual(presetDateRange('1m', '2025-01-01', '2025-03-31'), {range: '1m', startDate: '2025-02-28', endDate: '2025-03-31'});
  assert.equal(presetDateRange('1m', '2024-01-01', '2024-03-31').startDate, '2024-02-29');
  assert.equal(presetDateRange('6m', '2026-09-01', '2026-09-30').startDate, '2026-09-01');
  assert.equal(presetDateRange('all', '2020-01-01', '2026-09-30').startDate, '2020-01-01');
});
