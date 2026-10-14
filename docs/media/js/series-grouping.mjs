export const SMALL_SERIES_LABEL = 'Group series below 0.1% into Other';
export const SMALL_SERIES_HELP = 'Combines visible series that stay below 0.1% throughout the selected date range. Existing catch-all categories stay separate. Uncheck to restore the individual series.';

/** Group a disjoint breakdown without changing its denominator or source data. */
export function groupSmallSeries(series, {enabled = true, threshold = 0.1} = {}) {
  if (!enabled) return series;
  const small = series.filter(item => {
    // Preserve explicit user/source buckets, including publication suppression.
    if (item.visible === false || /^(Other\b|Everything else$)/i.test(item.name) ||
        /^(versions-through:|__other__$|other$|unreported-version$|__small-series__)/.test(item.id)) return false;
    let observed = false;
    for (const point of item.values) {
      if (point.missing || !Number.isFinite(point.value)) continue;
      if (!Number.isFinite(point.percent)) {
        if (point.value !== 0) return false;
        continue;
      }
      if (point.percent < 0 || point.percent >= threshold) return false;
      observed = true;
    }
    return observed;
  });
  if (!small.length) return series;
  const members = new Set(small);
  const dates = new Map();
  for (const item of small) for (const point of item.values) {
    if (!dates.has(point.date)) dates.set(point.date, []);
    dates.get(point.date).push(point);
  }
  let id = '__small-series__';
  while (series.some(item => item.id === id)) id += '_';
  const values = [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, points]) => {
    const published = points.filter(point => !point.missing && Number.isFinite(point.value));
    const unavailable = small.length - published.length;
    const totals = [...new Set(points.map(point => point.total).filter(Number.isFinite))];
    const notes = [...new Set(published.map(point => point.note).filter(Boolean))];
    if (unavailable) notes.unshift(`${unavailable} grouped ${unavailable === 1 ? 'series is' : 'series are'} unavailable on this date. ${published.length ? 'Other sums the published values only.' : 'No grouped values are published.'}`);
    return {
      date,
      value: published.length ? published.reduce((sum, point) => sum + point.value, 0) : null,
      percent: published.length && published.every(point => Number.isFinite(point.percent))
        ? published.reduce((sum, point) => sum + point.percent, 0) : null,
      total: totals.length === 1 ? totals[0] : null,
      missing: !published.length,
      unpublished: !published.length && points.some(point => point.unpublished),
      incomplete: unavailable > 0,
      partial: published.some(point => point.partial),
      ...(notes.length ? {note: notes.join(' ')} : {}),
    };
  });
  return [...series.filter(item => !members.has(item)), {
    id, name: 'Other', color: '#8493a7', visible: true, smallSeries: true,
    members: small.map(item => item.id), values,
  }];
}
