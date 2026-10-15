/** Pure data model for the static ADI explorer. No browser or D3 dependency. */
export const CHANNELS = Object.freeze(['esr', 'release', 'beta', 'nightly', 'unknown']);
export const CHANNEL_COLORS = Object.freeze({esr: '#0B5CBD', release: '#2EB6FF', beta: '#ec9a32', nightly: '#df5da0', unknown: '#8493a7'});
const DAY = 86_400_000;
const FAMILY_COLORS = {'major:78': '#9f7957', 'major:91': '#b176a1', 'major:102': '#cf8b3f', 'major:115': '#647c9c', 'major:128': '#3c9bdc', 'major:140': '#8962db', 'major:153': '#20a995'};

function hueToHex(hue, saturation = 0.67, lightness = 0.48) {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const component = offset => {
    const k = (offset + hue / 30) % 12;
    const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${component(0)}${component(8)}${component(4)}`;
}

export function parseVersion(version) {
  const match = String(version ?? '').trim().match(/^(\d+(?:\.\d+)*)(?:(a|b|rc)(\d*))?(?:esr)?$/i);
  if (!match) return null;
  return {parts: match[1].split('.').map(Number), major: Number(match[1].split('.')[0]), stage: ({a: 0, b: 1, rc: 2})[match[2]?.toLowerCase()] ?? 3, prerelease: Number(match[3] || 0)};
}

export function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) return String(a).localeCompare(String(b), 'en', {numeric: true});
  for (let index = 0; index < Math.max(left.parts.length, right.parts.length); index += 1) {
    const difference = (left.parts[index] || 0) - (right.parts[index] || 0);
    if (difference) return difference;
  }
  return left.stage - right.stage || left.prerelease - right.prerelease;
}

export function colorForSeries(id, {currentEsrMajor, currentReleaseMajor} = {}) {
  id = String(id);
  if (CHANNEL_COLORS[id]) return CHANNEL_COLORS[id];
  if (id.startsWith('channel:') && CHANNEL_COLORS[id.slice(8)]) return CHANNEL_COLORS[id.slice(8)];
  const identity = /^(?:major|version):(.+?)(:esr)?$/.exec(id);
  const version = identity && parseVersion(identity[1]);
  if (version?.stage === 3) {
    if (identity[2] && version.major === currentEsrMajor) return CHANNEL_COLORS.esr;
    if (!identity[2] && version.major === currentReleaseMajor) return CHANNEL_COLORS.release;
  }
  // Keep commonly compared ESR families distinct across presets and date ranges.
  if (FAMILY_COLORS[id]) return FAMILY_COLORS[id];
  // Donation years need separated hues too: adjacent numeric hashes collide visually.
  if (/^(19|20)\d{2}$/.test(id)) return hueToHex((Number(id) * 137.507764 + 201) % 360, 0.6, 0.48);
  const major = /^major:(\d+)$/.exec(id);
  // Adjacent version numbers are far apart in hue. The calculation depends only
  // on identity, so filters, date ranges, order, and reloads cannot recolor them.
  if (major) return hueToHex((Number(major[1]) * 137.507764 + 201) % 360);
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hueToHex((hash >>> 0) % 360, 0.62 + ((hash >>> 8) % 10) / 100, 0.46 + ((hash >>> 16) % 7) / 100);
}

export function assignSeriesColors(groups, currentVersions) {
  return groups.map(group => group.color || (group.remainder ? '#8493a7' : colorForSeries(group.id, currentVersions)));
}

function dateString(value) {
  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? value.toISOString().slice(0, 10) : null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const text = value.slice(0, 10);
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : null;
}

export function normalizeReleases(releases = [], {channel = 'esr'} = {}) {
  const input = Array.isArray(releases) ? releases : channel === 'release' ? (releases.release_releases || []) : (releases.esr || releases.releases || []);
  return input.flatMap(release => {
    const date = dateString(release.date || release.releaseDate || release.release_date);
    const version = String(release.version || '');
    const releaseChannel = release.channel || channel;
    const update_channel = channel === 'release' || release.update_channel === 'release' ? 'release' : 'esr';
    return date && parseVersion(version) && releaseChannel === channel ? [{date, version, major: parseVersion(version).major, update_channel}] : [];
  }).sort((a, b) => a.date.localeCompare(b.date) || compareVersions(a.version, b.version));
}

/** Resolve from dated release metadata, never from the versions observed in ADI. */
export function resolveLatestEsr(date, releases, {pinnedMajor} = {}) {
  return resolveLatestRelease(date, releases, {pinnedMajor, channel: 'esr'});
}

export function resolveLatestRelease(date, releases, {pinnedMajor, channel = 'release'} = {}) {
  const available = normalizeReleases(releases, {channel}).filter(release => release.date <= date && (pinnedMajor == null || release.major === Number(pinnedMajor)) && parseVersion(release.version).stage === 3);
  if (!available.length) return null;
  return available.reduce((latest, release) => compareVersions(release.version, latest.version) > 0 ? release : latest);
}

function array(value) {
  if (Array.isArray(value)) return value;
  return typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
}

/** Bare majors select their family; stage:* selects a version label, never a channel. */
export function matchesVersionSelector(version, selector) {
  const pattern = String(selector).trim();
  if (!pattern) return false;
  if (pattern === '*') return true;
  if (/^stage:\w+$/i.test(pattern)) {
    const stage = {'stage:nightly': 0, 'stage:beta': 1, 'stage:release': 3}[pattern.toLowerCase()];
    return stage != null && parseVersion(version)?.stage === stage;
  }
  if (/^\d+$/.test(pattern)) return parseVersion(version)?.major === Number(pattern);
  if (pattern.endsWith('.*')) return version === pattern.slice(0, -2) || version.startsWith(pattern.slice(0, -1));
  const range = pattern.match(/^(.+?)\s*\.\.\s*(.+)$/);
  if (range) return aboveLower(version, range[1]) && belowUpper(version, range[2]);
  const conditions = pattern.split(/\s+(?=[<>]=?)/);
  if (conditions.length > 1) return conditions.every(condition => matchesVersionSelector(version, condition));
  const comparator = pattern.match(/^(>=|<=|>|<|=)\s*(.+)$/);
  if (comparator) {
    const order = compareVersions(version, comparator[2]);
    return ({'>=': order >= 0, '<=': order <= 0, '>': order > 0, '<': order < 0, '=': order === 0})[comparator[1]];
  }
  return compareVersions(version, pattern) === 0;
}

function aboveLower(version, minimum) {
  return minimum == null || minimum === '' || compareVersions(version, minimum) >= 0;
}

function belowUpper(version, maximum) {
  if (maximum == null || maximum === '') return true;
  if (/^\d+$/.test(String(maximum))) return parseVersion(version)?.major <= Number(maximum);
  return compareVersions(version, maximum) <= 0;
}

export function matchesGroup(version, channel, date, group, releases = []) {
  if (group.remainder) return false;
  if (array(group.channels).length && !array(group.channels).includes(channel)) return false;
  if (array(group.excludeChannels).includes(channel)) return false;
  const selected = array(group.versions || group.includeVersions);
  if (selected.length && !selected.some(selector => matchesVersionSelector(version, selector))) return false;
  if (array(group.excludeVersions).some(selector => matchesVersionSelector(version, selector))) return false;
  if (!aboveLower(version, group.minVersion) || !belowUpper(version, group.maxVersion)) return false;
  const parsed = parseVersion(version);
  if (group.minMajor != null && (!parsed || parsed.major < Number(group.minMajor))) return false;
  if (group.maxMajor != null && (!parsed || parsed.major > Number(group.maxMajor))) return false;
  if (group.latestEsr) {
    if (group.latestEsr === 'pinned' && group.pinnedMajor == null) return false;
    const latest = resolveLatestEsr(date, releases, {pinnedMajor: group.latestEsr === 'pinned' ? group.pinnedMajor : undefined});
    if (!latest || channel !== latest.update_channel || parsed?.major !== latest.major) return false;
    if (group.latestPatch && compareVersions(version, latest.version) !== 0) return false;
  }
  return true;
}

export function createPresetGroups(name = 'latest-esr', releases = [], currentVersions) {
  const remainder = {id: 'remainder', name: 'Everything else', color: '#8493a7', remainder: true};
  if (['prerelease-builds', 'beta-builds', 'nightly-builds'].includes(name)) {
    const groups = [
      {id: 'beta-builds', name: 'Beta builds', versions: ['stage:beta'], color: CHANNEL_COLORS.beta,
        description: 'Versions with a beta (b) suffix, independent of the recorded update channel.'},
      {id: 'nightly-builds', name: 'Nightly builds', versions: ['stage:nightly'], color: CHANNEL_COLORS.nightly,
        description: 'Versions with a nightly (a) suffix, independent of the recorded update channel.'},
    ];
    return [...groups.filter(group => name === 'prerelease-builds' || group.id === name), remainder];
  }
  if (name === 'esr-families') {
    const families = [...new Set(normalizeReleases(releases).map(r => parseVersion(r.version).major))].sort((a, b) => b - a).slice(0, 5);
    return [...(families.length ? families : [153, 140, 128, 115]).map(major => ({id: `esr:${major}`, name: `${major} ESR`, latestEsr: 'pinned', pinnedMajor: major, color: colorForSeries(`major:${major}:esr`, currentVersions)})), remainder];
  }
  if (name === 'selected-versions') return [{id: 'selected', name: 'Selected versions', versions: ['115', '128'], color: '#8b5cf6'}, remainder];
  if (name === 'legacy') return [{id: 'legacy-115', name: '115 and below', maxMajor: 115, color: '#8493a7'}, {id: 'modern', name: '116 and above', minMajor: 116, color: '#8b5cf6'}];
  if (name === 'channels') return CHANNELS.filter(channel => channel !== 'unknown').map(channel => ({id: `channel:${channel}`, name: channel === 'esr' ? 'ESR' : channel[0].toUpperCase() + channel.slice(1), channels: [channel], color: CHANNEL_COLORS[channel]}));
  if (name === 'latest-esr-patch') return [{id: 'latest-esr-patch', name: 'Latest ESR patch', latestEsr: 'historical', latestPatch: true, color: CHANNEL_COLORS.esr}, remainder];
  return [{id: 'latest-esr', name: 'Latest ESR family', latestEsr: 'historical', color: CHANNEL_COLORS.esr}, remainder];
}

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeRecord(record) {
  const contributions = new Map();
  const versionTotals = new Map();
  let observed = count(record.count) != null, hasChannelData = false;
  const add = (channel, version, value) => {
    if (count(value) == null) return;
    observed = true;
    const key = `${channel}\0${version}`;
    const existing = contributions.get(key);
    if (existing) existing.value += value;
    else contributions.set(key, {channel, version, value});
    versionTotals.set(version, (versionTotals.get(version) || 0) + value);
  };
  for (const [rawChannel, versions] of Object.entries(record.channels || {})) {
    if (!versions || typeof versions !== 'object') continue;
    const channel = CHANNELS.includes(rawChannel.toLowerCase()) ? rawChannel.toLowerCase() : 'unknown';
    for (const [version, value] of Object.entries(versions)) {
      if (count(value) != null) hasChannelData ||= channel !== 'unknown';
      add(channel, version, value);
    }
  }
  for (const [version, value] of Object.entries(record.versions || {})) {
    if (count(value) == null) continue;
    observed = true;
    const known = versionTotals.get(version) || 0;
    if (value > known) add('unknown', version, value - known);
  }
  let total = [...contributions.values()].reduce((sum, item) => sum + item.value, 0);
  if (count(record.count) != null && record.count > total) {
    add('unknown', '', record.count - total);
    total = record.count;
  }
  return {contributions: [...contributions.values()], observed, hasChannelData, mismatch: count(record.count) != null && total > record.count};
}

function versionIdentity(releases) {
  const families = new Map();
  for (const release of releases) if (!families.has(release.major)) families.set(release.major, release);
  const cache = new Map();
  return ({version, channel, date}) => {
    const key = `${channel}\0${version}`;
    if (!cache.has(key)) {
      const parsed = parseVersion(version);
      const family = families.get(parsed?.major);
      // A recorded channel takes precedence over family metadata. Historical
      // ESR builds used Release before the separate ESR update channel existed.
      // Unclassified stable builds can only use the dated published ESR family.
      const since = /esr$/i.test(version) || channel === 'esr' ? ''
        : parsed?.stage === 3 && family && (channel === 'unknown' || channel === family.update_channel) ? family.date : null;
      const descriptor = esrVersion => {
        const label = esrVersion ? version.replace(/esr$/i, '') : version;
        const suffix = esrVersion ? ':esr' : '';
        return {id: `version:${label}${suffix}`, version: label, esrVersion, major: parsed?.major,
          majorId: `major:${parsed?.major}${suffix}`, name: label ? `${label}${esrVersion ? ' ESR' : ''}` : 'Unreported version',
          majorName: `${parsed?.major}${esrVersion ? ' ESR' : ''}`};
      };
      cache.set(key, {since, plain: descriptor(false), esr: descriptor(true)});
    }
    const identity = cache.get(key);
    return identity.since != null && date >= identity.since ? identity.esr : identity.plain;
  };
}

/**
 * options: grouping channels|major|versions|custom; mode percent|count|lines;
 * channels, groups, hiddenSeries, startDate, endDate, remainder (default true).
 * currentEsrMajor/currentReleaseMajor identify the families with fixed colors.
 * Major views combine older families using versionCutoff and Release activity
 * outside currentReleaseMajor unless combineReleaseVersions is false. Unknown
 * stable builds use dated Release families, excluding known ESR families.
 * Detailed versions retain every label.
 * Major and full-version groups are unlimited unless maxSeries is explicit.
 * Every date in range is retained. Missing days have null values, never zero.
 */
export function buildSeries(records = [], options = {}, releases = []) {
  const mode = ['percent', 'count', 'lines'].includes(options.mode) ? options.mode : 'percent';
  const grouping = options.grouping || 'channels';
  const selectedChannels = CHANNELS.filter(channel => !Array.isArray(options.channels) || options.channels.includes(channel));
  const requiresChannelData = selectedChannels.length > 0 && selectedChannels.length < CHANNELS.length;
  const unavailableChannelNote = 'Channel breakdown unavailable for this date. Include all channels to view the total.';
  const normalizedReleases = normalizeReleases(releases);
  const identifyVersion = versionIdentity(normalizedReleases);
  const byDate = new Map();
  const requestedStart = dateString(options.startDate), requestedEnd = dateString(options.endDate);
  let hasChannelData = false, unknownData = false, mismatch = false;
  for (const record of records) {
    const date = dateString(record.date);
    if (!date || (requestedStart && date < requestedStart) || (requestedEnd && date > requestedEnd)) continue;
    const normalized = normalizeRecord(record);
    hasChannelData ||= normalized.hasChannelData;
    unknownData ||= normalized.contributions.some(item => item.channel === 'unknown' && item.value > 0);
    mismatch ||= normalized.mismatch;
    if (!byDate.has(date)) byDate.set(date, {observed: false, contributions: [], channelUnavailable: false});
    // Legacy totals cannot establish a filtered population, even when Unknown
    // is selected. Joining them to later filtered counts fabricates a drop.
    const channelUnavailable = normalized.observed && requiresChannelData &&
      !(record.channels && Object.keys(record.channels).length > 0);
    byDate.get(date).channelUnavailable ||= channelUnavailable;
    byDate.get(date).observed ||= normalized.observed && !channelUnavailable;
    for (const item of normalized.contributions) if (selectedChannels.includes(item.channel)) {
      // These are private normalized contributions, not the source records.
      item.date = date;
      item.identity = identifyVersion(item);
      byDate.get(date).contributions.push(item);
    }
  }
  const allDates = [...byDate.keys()].sort();
  const start = requestedStart || allDates[0], end = requestedEnd || allDates.at(-1);
  const days = [];
  if (start && end && start <= end) {
    for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += DAY) days.push(new Date(time).toISOString().slice(0, 10));
  }
  const entries = days.flatMap(date => byDate.get(date)?.contributions || []);
  const versionChoices = [...new Map(entries.map(item => [item.identity.id, item.identity])).values()]
    .sort((a, b) => compareVersions(b.version, a.version) || Number(b.esrVersion) - Number(a.esrVersion));
  const cutoff = grouping === 'major' && Number.isInteger(options.versionCutoff) && options.versionCutoff > 0 ? options.versionCutoff : null;
  const currentReleaseMajor = grouping === 'major' && options.combineReleaseVersions !== false && Number.isInteger(options.currentReleaseMajor) && options.currentReleaseMajor > 0 ? options.currentReleaseMajor : null;
  const releaseFamilyDates = new Map();
  if (currentReleaseMajor != null) {
    const esrFamilies = new Set(normalizedReleases.map(release => release.major));
    for (const release of normalizeReleases(releases, {channel: 'release'})) {
      if (!esrFamilies.has(release.major) && parseVersion(release.version).stage === 3 && !releaseFamilyDates.has(release.major))
        releaseFamilyDates.set(release.major, release.date);
    }
  }
  const releaseMembership = new Map();
  const otherRelease = item => {
    if (currentReleaseMajor == null || item.identity.esrVersion) return false;
    const key = `${item.channel}\0${item.version}`;
    if (!releaseMembership.has(key)) {
      const parsed = parseVersion(item.version);
      let since = null;
      if (parsed && parsed.major !== currentReleaseMajor && (cutoff == null || parsed.major > cutoff)) {
        if (item.channel === 'release') since = '';
        // Legacy totals lack channels. Only infer published stable Release
        // families; recorded ESR/Beta/Nightly activity always stays separate.
        else if (item.channel === 'unknown' && parsed.stage === 3 && !/esr$/i.test(item.version))
          since = releaseFamilyDates.get(parsed.major) ?? null;
      }
      releaseMembership.set(key, since);
    }
    const since = releaseMembership.get(key);
    return since != null && (!since || item.date >= since);
  };
  let groups;
  if (grouping === 'custom') {
    groups = (options.groups || createPresetGroups()).map((group, index) => ({...group, id: String(group.id || `custom-${index}`), name: group.name || `Group ${index + 1}`}));
    // Duplicate user ids would collapse D3 joins and misroute per-group values.
    const used = new Set();
    groups = groups.map(group => {
      let id = group.id, suffix = 2;
      while (used.has(id)) id = `${group.id}-${suffix++}`;
      used.add(id);
      return {...group, id};
    });
    const remainderIndex = groups.findIndex(group => group.remainder);
    groups = groups.filter((group, index) => !group.remainder || index === remainderIndex);
    if (remainderIndex === -1 && options.remainder !== false) groups.push({id: used.has('remainder') ? '__remainder' : 'remainder', name: 'Everything else', remainder: true, color: '#8493a7'});
  } else if (grouping === 'major') {
    const identities = [...new Map(entries.filter(item => !otherRelease(item) && item.identity.major != null)
      .map(item => [item.identity.majorId, item.identity])).values()]
      .sort((a, b) => b.major - a.major || Number(b.esrVersion) - Number(a.esrVersion));
    groups = identities.map(identity => ({id: identity.majorId, name: identity.majorName,
      minMajor: identity.major, maxMajor: identity.major, esrVersion: identity.esrVersion}));
    if (entries.some(item => !parseVersion(item.version))) groups.push({id: 'unreported-version', name: 'Unreported version', remainder: true});
  } else if (grouping === 'versions') {
    groups = versionChoices.map(identity => ({id: identity.id, name: identity.name, exactVersion: identity.version, esrVersion: identity.esrVersion}));
  } else {
    groups = selectedChannels.map(channel => ({id: `channel:${channel}`, name: channel === 'esr' ? 'ESR' : channel === 'unknown' ? 'Unknown channel' : channel[0].toUpperCase() + channel.slice(1), channels: [channel]}));
  }
  if (cutoff != null) {
    groups = groups.filter(group => group.maxMajor == null || group.maxMajor > cutoff);
    groups.push({id: `versions-through:${cutoff}`, name: `${cutoff} and below`, maxMajor: cutoff, color: '#8493a7'});
  }
  if (currentReleaseMajor != null && entries.some(otherRelease))
    groups.push({id: 'other-release-versions', name: 'Other Release versions', otherRelease: true, color: '#bb7a45'});
  // Clearing channels also clears fixed cutoff and custom groups, which would
  // otherwise leave zero-valued series drawn in count and line views.
  if (!selectedChannels.length) groups = [];
  // Expose every recorded category by default. An explicitly requested cap
  // includes its remainder, so an optional top-N view preserves the population.
  if (grouping === 'major' || grouping === 'versions') {
    const maxSeries = options.maxSeries == null ? Infinity : Math.max(2, Number(options.maxSeries));
    if (groups.length > maxSeries) {
      const weights = new Map();
      const lastObservation = allDates.at(-1);
      const recentStart = lastObservation ? new Date(Date.parse(`${lastObservation}T00:00:00Z`) - 29 * DAY).toISOString().slice(0, 10) : '';
      const recent = days.filter(date => date >= recentStart).flatMap(date => byDate.get(date)?.contributions || []);
      const weightedEntries = recent.some(item => item.value > 0) ? recent : entries;
      for (const item of weightedEntries) {
        const key = grouping === 'major' ? item.identity.majorId : item.identity.id;
        weights.set(key, (weights.get(key) || 0) + item.value);
      }
      const included = new Set([...groups].filter(group => !group.remainder).sort((a, b) => (weights.get(b.id) || 0) - (weights.get(a.id) || 0)).slice(0, maxSeries - 1).map(group => group.id));
      groups = groups.filter(group => included.has(group.id));
      groups.push({id: 'other-versions', name: 'Other versions', remainder: true, color: '#8493a7'});
    }
  }
  const hidden = new Set(options.hiddenSeries || []);
  const colors = assignSeriesColors(groups, options);
  const series = groups.map((group, index) => ({id: group.id, name: group.name, color: colors[index], visible: group.visible !== false && !hidden.has(group.id), values: []}));
  const totals = [];
  let overlap = false;
  const cachedReleases = new Map();
  const matchingCache = new Map();
  const hasDatedRules = groups.some(group => group.latestEsr);
  // Resolution is cached per day/pinned family to avoid scanning release metadata
  // once for every version in a long ADI history.
  const matches = (item, date, group, isOtherRelease) => {
    if (group.otherRelease) return isOtherRelease;
    if (isOtherRelease) return false;
    if (group.esrVersion != null && group.esrVersion !== item.identity.esrVersion) return false;
    if ('exactVersion' in group) return item.identity.version === group.exactVersion;
    if (!group.latestEsr) return matchesGroup(item.version, item.channel, date, group, normalizedReleases);
    if (group.latestEsr === 'pinned' && group.pinnedMajor == null) return false;
    const cacheKey = `${date}:${group.latestEsr === 'pinned' ? group.pinnedMajor : '*'}`;
    if (!cachedReleases.has(cacheKey)) cachedReleases.set(cacheKey, resolveLatestEsr(date, normalizedReleases, {pinnedMajor: group.latestEsr === 'pinned' ? group.pinnedMajor : undefined}));
    const latest = cachedReleases.get(cacheKey);
    return matchesGroup(item.version, item.channel, date, {...group, latestEsr: false}, normalizedReleases) && latest != null && item.channel === latest.update_channel && parseVersion(item.version)?.major === latest.major && (!group.latestPatch || compareVersions(item.version, latest.version) === 0);
  };
  for (const date of days) {
    const record = byDate.get(date);
    const missing = !record?.observed || Boolean(record?.channelUnavailable);
    const total = missing ? null : record.contributions.reduce((sum, item) => sum + item.value, 0);
    const availability = record?.channelUnavailable ? {note: unavailableChannelNote} : {};
    totals.push({date, value: total, missing, ...availability});
    const values = new Array(groups.length).fill(0);
    if (!missing) for (const item of record.contributions) {
      const isOtherRelease = otherRelease(item);
      // Inferred membership changes only at publication, so cache that outcome
      // rather than adding every legacy date to the version-matching cache.
      const key = `${hasDatedRules && (item.channel === 'esr' || item.channel === 'release') ? date : ''}\0${item.channel}\0${item.version}\0${item.identity.esrVersion}\0${isOtherRelease}`;
      if (!matchingCache.has(key)) matchingCache.set(key, groups.flatMap((group, index) => !group.remainder && matches(item, date, group, isOtherRelease) ? [index] : []));
      const matching = matchingCache.get(key);
      if (matching.length > 1 && item.value > 0) overlap = true;
      if (matching.length) {
        for (const index of mode === 'lines' ? matching : matching.slice(0, 1)) values[index] += item.value;
      } else {
        const remainder = groups.findIndex(group => group.remainder);
        if (remainder !== -1) values[remainder] += item.value;
      }
    }
    series.forEach((item, index) => item.values.push({date, value: missing ? null : values[index], percent: missing || total === 0 ? null : values[index] / total * 100, total, missing, ...availability}));
  }
  const warnings = [];
  if (unknownData) warnings.push('Some observations have no recorded channel. They remain in Unknown channel.');
  if (totals.some(point => point.note === unavailableChannelNote)) warnings.push('Dates without channel breakdowns are hidden while channel filters are active. Include all channels to view the full version history.');
  if (mismatch) warnings.push('Some detailed counts exceed their supplied daily total; detailed observations are used.');
  if (groups.some(group => group.latestEsr) && !normalizedReleases.length) warnings.push('Dated ESR release metadata is unavailable; latest-ESR groups cannot be resolved.');
  if (groups.some(group => group.latestEsr === 'pinned' && group.pinnedMajor == null)) warnings.push('Choose a version family for each pinned ESR group.');
  if (overlap) warnings.push(mode === 'lines' ? 'Groups overlap; the same observation can appear in more than one comparison line.' : 'Groups overlap; the first matching group receives each observation.');
  return {series, totals, overlap, mode, grouping, selectedChannels, hasChannelData, warnings, versionChoices};
}
