/** Shared, responsive D3 renderer. D3 is supplied by the self-hosted UMD asset. */
import {trackFocusInput, hasKeyboardFocus} from './focus.mjs';
import {chartBoundary, compositeColor, contrastInk, contrastRatio, observeChartTheme} from './chart-contrast.mjs';

const charts = new WeakMap();
let nextId = 0;
const utcDate = date => date instanceof Date ? date : new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
const dayString = date => date.toISOString().slice(0, 10);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const stackedMode = mode => mode === 'count' || mode === 'percent';
const percentageFormat = new Intl.NumberFormat('en', {maximumFractionDigits: 1});

/** Percent values use a 0–100 scale. Positive fractions never appear as zero. */
export function formatPercentage(value) {
  if (!finite(value)) return '—';
  if (value > 0 && value < 0.1) return '<0.1%';
  if (value < 0 && value > -0.1) return '>−0.1%';
  return `${percentageFormat.format(value)}%`;
}

/** Rank displayed values; keep ties stable and missing observations last. */
export function orderSeriesByValue(series, valueForSeries, positionForSeries = (_item, index) => index) {
  return series.map((item, index) => ({item, index: positionForSeries(item, index), value: valueForSeries(item)}))
    .sort((a, b) => finite(a.value) && finite(b.value) ? b.value - a.value || a.index - b.index : finite(a.value) ? -1 : finite(b.value) ? 1 : a.index - b.index)
    .map(({item}) => item);
}

/** Daily overview totals retain missing days as gaps, independently of the view. */
export function normalizeOverview(overview = []) {
  const byDate = new Map();
  for (const point of overview) {
    const date = utcDate(point.date);
    if (!Number.isFinite(date.valueOf())) continue;
    byDate.set(dayString(date), {date, value: finite(point.total) && point.total >= 0 ? point.total : null});
  }
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return [];
  const result = [];
  for (let time = +utcDate(dates[0]); time <= +utcDate(dates.at(-1)); time += 86_400_000) {
    const date = new Date(time);
    const point = byDate.get(dayString(date));
    result.push({date, value: point?.value ?? null, observed: finite(point?.value)});
  }
  return result;
}

/** Trailing calendar-day averages require every observation in the window. */
export function movingAverage(overview, period = 7) {
  if (!Number.isInteger(period) || period < 1) throw new Error('The averaging period must be a positive integer.');
  const points = normalizeOverview(overview);
  let sum = 0, observed = 0;
  return points.map((point, index) => {
    if (point.observed) { sum += point.value; observed++; }
    if (index >= period && points[index - period].observed) {
      sum -= points[index - period].value;
      observed--;
    }
    const value = index >= period - 1 && observed === period ? sum / period : null;
    return {date: dayString(point.date), value, missing: value === null};
  });
}

export function presetDateRange(range, first, last) {
  let startDate = first;
  if (range !== 'all') {
    const date = utcDate(last), day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - ({'1m': 1, '3m': 3, '6m': 6, '1y': 12, '5y': 60, '10y': 120}[range] || 6));
    const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, monthEnd));
    startDate = dayString(date);
  }
  return {range, startDate: startDate < first ? first : startDate, endDate: last};
}

export function renderChart(container, series = [], options = {}) {
  if (typeof container === 'string') container = document.querySelector(container);
  if (!container) throw new Error('Chart container was not found.');
  trackFocusInput(container.ownerDocument);
  if (charts.has(container)) {
    const existing = charts.get(container);
    existing.update(series, options);
    return existing;
  }
  const d3 = globalThis.d3;
  if (!d3) throw new Error('The self-hosted D3 library must load before the chart.');
  let currentSeries = series, currentOptions = {mode: 'lines', ...options}, destroyed = false, focusedIndex = 0;
  let pinned = false, suppressFocus = false, suppressHover = false;
  let chartSurface = '#ffffff';
  let x, y, rows = [], visible = [], chartWidth = 0, chartHeight = 0, plotHeight = 0, margin, barWidth = 0;
  let indexedSeries = [], pointIndexes = new Map(), seriesPositions = new Map(), overviewSource, overviewPoints;
  let tooltipIndex = -1, tooltipPinned = false, hoverFrame = null, pendingHoverIndex;
  const uid = `stats-chart-${++nextId}`;
  const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  // SVG coordinates and HTML overlays share this unpadded content box.
  // The host may have padding, which clientWidth includes but SVG width does not.
  const root = d3.select(container).append('div').attr('class', 'chart-stage').style('position', 'relative');
  const svg = root.append('svg').attr('class', 'stats-chart').attr('width', '100%')
    .attr('role', 'group').attr('tabindex', 0).attr('aria-roledescription', 'interactive chart')
    .attr('aria-labelledby', `${uid}-title`).attr('aria-describedby', `${uid}-description`).style('display', 'block').style('overflow', 'visible');
  svg.append('title').attr('id', `${uid}-title`);
  svg.append('desc').attr('id', `${uid}-description`);
  const defs = svg.append('defs');
  defs.append('clipPath').attr('id', `${uid}-clip`).append('rect');
  const grid = svg.append('g').attr('class', 'chart-grid').attr('aria-hidden', 'true');
  const plot = svg.append('g').attr('clip-path', `url(#${uid}-clip)`).attr('aria-hidden', 'true');
  const paths = plot.append('g');
  const bars = plot.append('g').attr('class', 'chart-bars');
  const annotationLayer = svg.append('g').attr('class', 'chart-annotations').attr('aria-hidden', 'true').style('pointer-events', 'none');
  const xAxis = svg.append('g').attr('class', 'chart-axis chart-axis-x').attr('aria-hidden', 'true');
  const yAxis = svg.append('g').attr('class', 'chart-axis chart-axis-y').attr('aria-hidden', 'true');
  const yLabel = svg.append('text').attr('class', 'chart-axis-label').attr('aria-hidden', 'true');
  const empty = svg.append('text').attr('text-anchor', 'middle').style('fill', 'var(--text-muted, #7a859a)').style('font-size', '14px');
  // Keep pointer movement on its own composited layer, outside the large SVG.
  const hover = root.append('div').attr('class', 'chart-crosshair').attr('aria-hidden', 'true')
    .style('position', 'absolute').style('left', '0').style('top', '0').style('width', '100%')
    .style('visibility', 'hidden').style('pointer-events', 'none').style('contain', 'strict').style('transform', 'translateZ(0)');
  const hoverLine = hover.append('div').attr('class', 'chart-crosshair-line');
  const markers = hover.append('div');
  const overlay = svg.append('rect').attr('class', 'chart-interaction').attr('fill', 'transparent').attr('aria-hidden', 'true').style('touch-action', 'pan-y');
  const navigator = svg.append('g').attr('class', 'chart-navigator').attr('aria-hidden', 'true');
  const navigationPath = navigator.append('path').attr('class', 'chart-overview-path').attr('fill', 'var(--accent)').attr('fill-opacity', 0.08).attr('stroke', 'var(--accent)').attr('stroke-width', 1.5);
  const brushGroup = navigator.append('g').attr('class', 'chart-brush');
  const rangeLabel = root.append('div').attr('class', 'chart-range-label').attr('hidden', true).attr('aria-hidden', 'true')
    .style('position', 'absolute').style('pointer-events', 'none').style('transform', 'translateX(-50%)')
    .style('display', 'flex').style('align-items', 'center').style('justify-content', 'center').style('gap', '6px')
    .style('padding', '3px 8px').style('box-sizing', 'border-box').style('border-radius', '6px')
    .style('background', 'var(--surface, #fff)').style('border', '1px solid var(--accent)')
    .style('color', 'var(--text, #18253a)').style('font-size', '12px').style('line-height', '18px')
    .style('font-variant-numeric', 'tabular-nums').style('white-space', 'nowrap').style('contain', 'layout paint');
  const rangeStartLabel = rangeLabel.append('time').attr('class', 'chart-range-start');
  rangeLabel.append('span').text('–');
  const rangeEndLabel = rangeLabel.append('time').attr('class', 'chart-range-end');
  const tooltip = root.append('div').attr('class', 'chart-tooltip').attr('role', 'tooltip').attr('id', `${uid}-tooltip`).attr('hidden', true)
    .style('position', 'absolute').style('pointer-events', 'none').style('z-index', 5)
    .style('padding', '13px 15px').style('border-radius', '12px').style('border', '1px solid var(--border, #cbd5e1)')
    .style('background', 'var(--surface, #fff)').style('color', 'var(--text, #18253a)').style('box-shadow', '0 12px 38px #0002')
    .style('font-size', '12px').style('line-height', 1.6).style('min-width', '180px').style('max-width', 'min(300px, calc(100% - 8px))')
    .style('overflow-y', 'auto').style('overscroll-behavior', 'contain').style('box-sizing', 'border-box');
  const live = root.append('div').attr('aria-live', 'polite').attr('aria-atomic', 'true')
    .style('position', 'absolute').style('width', '1px').style('height', '1px').style('overflow', 'hidden').style('clip-path', 'inset(50%)');
  const integerFormat = new Intl.NumberFormat('en', {maximumFractionDigits: 0});
  const currencyFormat = new Intl.NumberFormat('en', {style: 'currency', currency: 'USD', maximumFractionDigits: 0});
  const calendarFormat = new Intl.DateTimeFormat('en', {timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric'});
  const plainNumber = value => integerFormat.format(value);
  const number = value => {
    if (currentOptions.formatValue) return currentOptions.formatValue(value);
    if (currentOptions.unit === 'percent' || currentOptions.unit === '%') return formatPercentage(value);
    if (currentOptions.unit === 'currency' || currentOptions.unit === 'USD') return currencyFormat.format(value);
    return plainNumber(value);
  };
  const pointLabel = point => !finite(point?.value) ? point?.unpublished ? 'Not published' : 'No observation' : currentOptions.mode === 'percent' ? formatPercentage(point.percent) : number(point.value);
  const dateFormat = date => currentOptions.formatDate ? currentOptions.formatDate(date) : calendarFormat.format(date);
  const dateKey = date => date instanceof Date ? dayString(date) : String(date).slice(0, 10);
  const pointAt = (item, row) => {
    const index = pointIndexes.get(item.id);
    return index instanceof Map ? index.get(row.key) : index?.[row.index];
  };

  function indexSeries() {
    if (indexedSeries.length === currentSeries.length && currentSeries.every((item, index) =>
      item.id === indexedSeries[index].id && item.values === indexedSeries[index].values && item.values?.length === indexedSeries[index].length)) return;
    indexedSeries = currentSeries.map(item => ({id: item.id, values: item.values, length: item.values?.length}));
    seriesPositions = new Map(currentSeries.map((item, index) => [item.id, index]));
    const dates = new Set();
    for (const item of currentSeries) for (const point of item.values || []) dates.add(dateKey(point.date));
    rows = [...dates].sort().flatMap(key => {
      const date = utcDate(key);
      return Number.isFinite(+date) ? [{key, date}] : [];
    });
    rows.forEach((row, index) => { row.index = index; });
    pointIndexes = new Map(currentSeries.map(item => {
      const values = item.values || [];
      const aligned = values.length === rows.length && values.every((point, index) => dateKey(point.date) === rows[index].key);
      return [item.id, aligned ? values : new Map(values.map(point => [dateKey(point.date), point]))];
    }));
  }

  function cancelHover() {
    if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
    hoverFrame = null;
    pendingHoverIndex = undefined;
  }

  function hideTooltip() {
    cancelHover();
    tooltipIndex = -1;
    pinned = false;
    tooltip.attr('hidden', true);
    hover.style('visibility', 'hidden');
    svg.attr('aria-describedby', `${uid}-description`);
  }

  // Build the tooltip shell once. Long lists use a fixed-height window of rows;
  // scrolling still exposes every series, including zeros and missing values.
  const tooltipHeader = tooltip.append('div').attr('class', 'chart-tooltip-header')
    .style('display', 'flex').style('gap', '12px').style('align-items', 'center').style('justify-content', 'space-between').style('margin-bottom', '6px');
  const tooltipTitle = tooltipHeader.append('strong').attr('id', `${uid}-tooltip-title`).style('font-size', '13px');
  const tooltipClose = tooltipHeader.append('button').attr('type', 'button').attr('aria-label', 'Close chart details').attr('class', 'chart-tooltip-close')
    .style('font', 'inherit').style('font-size', '18px').style('color', 'inherit').style('background', 'transparent').style('border', '0').style('cursor', 'pointer').text('×').on('click', closeDetails);
  const tooltipEmpty = tooltip.append('div').style('color', 'var(--text-muted, #7a859a)').text('No observation for this date');
  const tooltipList = tooltip.append('ul').attr('class', 'chart-tooltip-list')
    .style('position', 'relative').style('list-style', 'none').style('padding', '0').style('margin', '0').style('overflow-anchor', 'none');
  const tooltipTotal = tooltip.append('div').attr('class', 'chart-tooltip-total')
    .style('margin-top', '7px').style('padding-top', '6px').style('border-top', '1px solid var(--border, #cbd5e1)');
  const tooltipHelp = tooltip.append('div').style('color', 'var(--text-muted, #7a859a)').style('font-size', '11px').style('margin-top', '6px');
  const rowParts = new WeakMap();
  const tooltipRowHeight = 40;
  let tooltipPoints = [], virtualTooltip = false, tooltipMaxHeight = 300, tooltipX = 0, tooltipScrollFrame = null;
  const textIfChanged = (node, value) => { if (node.textContent !== value) node.textContent = value; };

  function renderTooltipRows(scrollTop = tooltip.node().scrollTop) {
    const windowSize = Math.ceil(tooltipMaxHeight / tooltipRowHeight) + 8;
    const start = virtualTooltip ? Math.max(0, Math.min(tooltipPoints.length - windowSize, Math.floor((scrollTop - 40) / tooltipRowHeight) - 3)) : 0;
    const end = virtualTooltip ? start + windowSize : tooltipPoints.length;
    const shown = tooltipPoints.slice(start, end);
    const items = tooltipList.selectAll('li').data(shown, item => item.series.id).join(enter => {
      const item = enter.append('li').attr('class', 'chart-tooltip-item').style('padding', '3px 0').style('box-sizing', 'border-box').style('width', '100%');
      item.each(function () {
        const row = d3.select(this);
        const entry = row.append('div').attr('class', 'chart-tooltip-entry').style('display', 'flex').style('gap', '8px').style('align-items', 'baseline');
        const swatch = entry.append('span').attr('class', 'chart-tooltip-swatch').attr('aria-hidden', 'true').style('width', '12px').style('height', '12px').style('border-radius', '50%').style('flex', '0 0 12px').style('align-self', 'center');
        const name = entry.append('span').attr('class', 'chart-tooltip-name').style('flex', '1').style('min-width', '0').style('overflow-wrap', 'anywhere');
        const value = entry.append('strong').style('font-variant-numeric', 'tabular-nums').style('white-space', 'nowrap');
        const note = row.append('div').attr('class', 'chart-tooltip-note').style('color', 'var(--text-muted, #7a859a)').style('margin-left', '20px').style('font-size', '11px').style('overflow-wrap', 'anywhere');
        rowParts.set(this, {swatch: swatch.node(), name: name.node(), value: value.node(), note: note.node()});
      });
      return item;
    }).style('position', virtualTooltip ? 'absolute' : 'relative')
      .style('top', item => virtualTooltip ? `${item.rank * tooltipRowHeight}px` : null)
      .style('height', virtualTooltip ? `${tooltipRowHeight}px` : null)
      .attr('aria-posinset', item => item.rank + 1).attr('aria-setsize', tooltipPoints.length);
    items.each(function ({series: item, point}) {
      const parts = rowParts.get(this), label = pointLabel(point);
      const color = item.color || '#8b5cf6';
      const note = [point?.partial ? 'Partial period' : '', point?.note || ''].filter(Boolean).join(' · ');
      parts.swatch.style.background = point?.partial ? 'transparent' : color;
      parts.swatch.style.border = `1px ${point?.partial ? 'dashed' : 'solid'} ${color}`;
      parts.name.style.whiteSpace = virtualTooltip ? 'nowrap' : '';
      parts.name.style.overflow = virtualTooltip ? 'hidden' : '';
      parts.name.style.textOverflow = virtualTooltip ? 'ellipsis' : '';
      textIfChanged(parts.name, item.name);
      textIfChanged(parts.value, label);
      textIfChanged(parts.note, note);
      parts.note.hidden = !note;
      parts.note.style.whiteSpace = virtualTooltip ? 'nowrap' : '';
      parts.note.style.overflow = virtualTooltip ? 'hidden' : '';
      parts.note.style.textOverflow = virtualTooltip ? 'ellipsis' : '';
      this.title = `${item.name}: ${label}${note ? ` · ${note}` : ''}`;
    });
    // A bounded set of markers follows the rows currently visible in the list.
    // The stacking positions still include every visible series.
    const markerItems = shown.filter(item => item.marker).map(item => ({...item,
      edge: chartBoundary(d3.color(item.point?.partial ? chartSurface : item.series.color || '#8b5cf6')?.formatHex() || '#8b5cf6', chartSurface)}));
    markers.selectAll('.chart-hover-marker').data(markerItems, item => item.series.id).join('span')
      .attr('class', 'chart-hover-marker').style('position', 'absolute').style('width', '10px').style('height', '10px')
      .style('box-sizing', 'border-box').style('border-radius', '50%')
      .style('transform', item => `translate(${tooltipX + item.marker.offset - 5}px,${y(item.marker.value) - 5}px)`)
      .style('background', item => item.point?.partial ? 'var(--surface, #fff)' : item.series.color || '#8b5cf6')
      .style('border', item => `2px ${item.point?.partial ? 'dashed' : 'solid'} ${item.edge.ink}`)
      .style('box-shadow', item => `0 0 0 1px ${item.edge.outer}`);
  }

  tooltip.on('scroll', () => {
    if (!virtualTooltip || tooltipIndex < 0 || tooltipScrollFrame !== null) return;
    tooltipScrollFrame = requestAnimationFrame(() => {
      tooltipScrollFrame = null;
      if (!destroyed && tooltipIndex >= 0) renderTooltipRows();
    });
  });

  function announceTooltip() {
    live.text(`${dateFormat(rows[focusedIndex].date)}. ${tooltipPoints.length ? tooltipPoints.map(({series: item, point}) => `${item.name}: ${pointLabel(point)}${point?.partial ? ', partial period' : ''}${point?.note ? `. ${point.note}` : ''}`).join('. ') : tooltipEmpty.text()}${tooltipTotal.attr('hidden') === null ? `. ${tooltipTotal.text()}` : ''}`);
  }

  function showTooltip(index, announce = false) {
    if (!rows.length) return;
    const hadTooltipFocus = tooltip.node().contains(document.activeElement);
    const previousScroll = tooltip.node().scrollTop;
    focusedIndex = Math.max(0, Math.min(rows.length - 1, index));
    if (tooltipIndex === focusedIndex && tooltipPinned === pinned) {
      if (announce) announceTooltip();
      return;
    }
    tooltipIndex = focusedIndex;
    tooltipPinned = pinned;
    const row = rows[focusedIndex];
    tooltipX = x(row.date);
    const minPercent = finite(currentOptions.tooltipMinPercent) ? Math.max(0, currentOptions.tooltipMinPercent) : 0;
    const minValue = finite(currentOptions.tooltipMinValue) ? currentOptions.tooltipMinValue : null;
    let baseline = 0, available = false, total, missingNote;
    tooltipPoints = orderSeriesByValue(visible.map((item, seriesIndex) => {
      const point = pointAt(item, row), amount = currentOptions.mode === 'percent' ? point?.percent : point?.value;
      if (point?.missing && point.note) missingNote ||= point.note;
      available ||= finite(point?.value);
      if (!finite(total) && finite(point?.total)) total = point.total;
      const value = stackedMode(currentOptions.mode) ? baseline + amount : amount;
      if (finite(amount)) baseline += amount;
      const offset = currentOptions.mode === 'bars' ? -barWidth / 2 + (seriesIndex + 0.5) * barWidth / Math.max(1, visible.length) : 0;
      return {series: item, point, marker: finite(amount) ? {value, offset} : null};
    }).filter(({series, point}) => (!minPercent || (finite(point?.percent) && (series.smallSeries || point.percent >= minPercent))) &&
      (minValue == null || (finite(point?.value) && point.value >= minValue))),
      ({point}) => currentOptions.mode === 'percent' ? point?.percent : point?.value,
      ({series}) => seriesPositions.get(series.id));
    tooltipPoints.forEach((point, rank) => { point.rank = rank; });
    virtualTooltip = tooltipPoints.length > 40;
    tooltipMaxHeight = Math.max(130, Math.min(chartHeight - 12, (globalThis.innerHeight || 700) * 0.65));
    const tooltipWidth = Math.min(300, chartWidth);
    const mobilePinned = pinned && chartWidth < 520;
    textIfChanged(tooltipTitle.node(), dateFormat(row.date));
    tooltipClose.attr('hidden', pinned ? null : true);
    tooltipEmpty.attr('hidden', available && tooltipPoints.length ? true : null);
    textIfChanged(tooltipEmpty.node(), !available ? missingNote || 'No observation for this date' : minValue != null
      ? `No values at or above ${number(minValue)} for this date`
      : `No shares at or above ${formatPercentage(minPercent)} for this date`);
    tooltipList.style('height', virtualTooltip ? `${tooltipPoints.length * tooltipRowHeight}px` : null);
    tooltipTotal.attr('hidden', currentOptions.totalLabel && finite(total) ? null : true);
    if (currentOptions.totalLabel && finite(total)) textIfChanged(tooltipTotal.node(), `${currentOptions.totalLabel}: ${(currentOptions.formatTotal || plainNumber)(total)}`);
    textIfChanged(tooltipHelp.node(), pinned ? '↑ ↓ to scroll · ← → to inspect dates · Esc to close' : 'Click to pin details');
    tooltip.attr('hidden', null).attr('tabindex', pinned ? 0 : null).attr('role', pinned ? 'dialog' : 'tooltip').attr('aria-labelledby', `${uid}-tooltip-title`)
      .attr('data-pinned', String(pinned)).attr('data-placement', mobilePinned ? 'below' : 'overlay')
      .style('contain', 'layout paint').style('position', mobilePinned ? 'relative' : 'absolute')
      .style('width', mobilePinned ? '100%' : `${tooltipWidth}px`).style('max-width', '100%')
      .style('height', virtualTooltip ? `${tooltipMaxHeight}px` : null).style('max-height', `${tooltipMaxHeight}px`)
      .style('left', '0').style('top', '0')
      .style('margin-top', mobilePinned ? '12px' : null).style('margin-bottom', mobilePinned ? '12px' : null)
      .style('pointer-events', pinned ? 'auto' : 'none');
    renderTooltipRows(previousScroll);
    // Long lists have a known fixed viewport. Short lists only measure their
    // small, contained box; no pointer update touches the chart's SVG geometry.
    const tooltipHeight = virtualTooltip ? tooltipMaxHeight : tooltip.node().offsetHeight;
    const left = tooltipX + 18 + tooltipWidth > chartWidth ? tooltipX - tooltipWidth - 18 : tooltipX + 18;
    tooltip.style('transform', mobilePinned ? null : `translate(${Math.max(0, Math.min(chartWidth - tooltipWidth, left))}px,${Math.max(0, Math.min(margin.top + 12, chartHeight - tooltipHeight))}px)`);
    hover.style('visibility', 'visible');
    hoverLine.style('transform', `translateX(${tooltipX}px)`).style('top', `${margin.top}px`).style('height', `${plotHeight}px`);
    // Keep keyboard instructions stable; the live region announces date values.
    svg.attr('aria-describedby', `${uid}-description`);
    if (hadTooltipFocus && !tooltip.node().contains(document.activeElement)) tooltip.node().focus({preventScroll: true});
    if (announce) announceTooltip();
  }

  function closeDetails() {
    suppressHover = true;
    hideTooltip();
    suppressFocus = true;
    svg.node().focus({preventScroll: true});
    suppressFocus = false;
  }

  function indexAt(event) {
    const [position] = d3.pointer(event, svg.node());
    return d3.bisector(row => row.date).center(rows, x.invert(Math.max(margin.left, Math.min(chartWidth - margin.right, position))));
  }

  overlay.on('pointermove', event => {
    if (pinned || suppressHover) return;
    pendingHoverIndex = indexAt(event);
    if (hoverFrame !== null) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = null;
      if (!destroyed && !pinned && pendingHoverIndex !== undefined) showTooltip(pendingHoverIndex);
    });
  }).on('pointerleave', () => {
    suppressHover = false;
    cancelHover();
    if (!pinned && !hasKeyboardFocus(svg.node())) hideTooltip();
  }).on('pointerdown', event => {
    suppressHover = false;
    cancelHover();
    if (!pinned) showTooltip(indexAt(event));
    if (event.pointerType === 'touch') svg.node().focus({preventScroll: true});
  }).on('click', event => {
    if (!rows.length) return;
    const index = indexAt(event);
    if (pinned && index === focusedIndex) closeDetails();
    else { pinned = true; showTooltip(index); svg.node().focus({preventScroll: true}); }
    currentOptions.onDateSelect?.(dayString(rows[index].date));
  });
  root.on('pointerleave', () => { suppressHover = false; });
  function handleKeys(event) {
    if (!rows.length) return;
    let next = focusedIndex;
    if (event.key === 'ArrowRight') next += event.shiftKey ? 7 : 1;
    else if (event.key === 'ArrowLeft') next -= event.shiftKey ? 7 : 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key === 'Escape') { event.preventDefault(); closeDetails(); return; }
    else if (pinned && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) {
      event.preventDefault(); tooltip.node().scrollTop += (event.key === 'ArrowUp' || event.key === 'PageUp' ? -1 : 1) * (event.key.startsWith('Page') ? tooltip.node().clientHeight * 0.8 : 45); return;
    }
    else if (event.key === 'Enter' || event.key === ' ') {
      if (event.target.closest?.('button')) return;
      event.preventDefault(); suppressHover = false; pinned = true; showTooltip(focusedIndex, true); currentOptions.onDateSelect?.(dayString(rows[focusedIndex].date)); return;
    }
    else return;
    event.preventDefault();
    suppressHover = false;
    showTooltip(next, true);
  }
  svg.on('focus', () => { if (!suppressFocus && hasKeyboardFocus(svg.node())) { suppressHover = false; showTooltip(focusedIndex, true); } }).on('blur', () => { if (!pinned) hideTooltip(); }).on('keydown', handleKeys);
  tooltip.on('keydown', handleKeys);
  const closeOnEscape = event => {
    if (event.key === 'Escape' && pinned) {
      event.preventDefault();
      if (container.contains(document.activeElement)) closeDetails();
      else { suppressHover = true; hideTooltip(); }
    }
  };
  document.addEventListener('keydown', closeOnEscape);

  function redraw() {
    if (destroyed) return;
    hideTooltip();
    const mode = currentOptions.mode || 'lines';
    const hasNavigator = Boolean(currentOptions.onRangeChange);
    chartWidth = Math.max(280, root.node().clientWidth || 800);
    chartHeight = Math.max(220, currentOptions.height || (chartWidth < 520 ? 350 : 430));
    margin = {left: chartWidth < 520 ? 46 : 60, right: 20, top: 27, bottom: hasNavigator ? 116 : 48};
    plotHeight = chartHeight - margin.top - margin.bottom;
    hover.style('height', `${chartHeight}px`);
    visible = currentSeries.filter(item => item.visible !== false);
    indexSeries();
    if (stackedMode(mode) || mode === 'area') {
      const firstDate = currentOptions.startDate && dateKey(currentOptions.startDate), lastDate = currentOptions.endDate && dateKey(currentOptions.endDate);
      const reference = rows.findLast(row => (!firstDate || row.key >= firstDate) &&
        (!lastDate || row.key <= lastDate) && currentSeries.some(item => finite(pointAt(item, row)?.value)));
      if (reference) visible = orderSeriesByValue(visible, item => {
        const point = pointAt(item, reference);
        return mode === 'percent' ? point?.percent : point?.value;
      });
      // Geometry accumulates upward, so the largest band is added last.
      if (stackedMode(mode)) visible.reverse();
    }
    focusedIndex = Math.min(focusedIndex, Math.max(0, rows.length - 1));
    const hasData = visible.some(item => item.values?.some(point => finite(mode === 'percent' ? point.percent : point.value)));
    const extent = d3.extent(rows, row => row.date);
    if (currentOptions.startDate) extent[0] = utcDate(currentOptions.startDate);
    if (currentOptions.endDate) extent[1] = utcDate(currentOptions.endDate);
    if (!extent[0]) extent[0] = new Date(Date.UTC(2025, 0, 1));
    const singleDate = extent[1] && +extent[0] === +extent[1];
    if (singleDate) {
      extent[1] = new Date(+extent[0] + 43_200_000);
      extent[0] = new Date(+extent[0] - 43_200_000);
    } else if (!extent[1] || +extent[1] === +extent[0]) extent[1] = new Date(+extent[0] + 86_400_000);
    x = d3.scaleUtc().domain(extent).range([margin.left, chartWidth - margin.right]);
    barWidth = 0;
    if (mode === 'bars' && rows.length) {
      const gaps = rows.slice(1).map((row, index) => x(row.date) - x(rows[index].date)).filter(gap => gap > 0);
      barWidth = Math.min(64, (d3.min(gaps) || (chartWidth - margin.left - margin.right) / 2) * 0.72);
      x.range([margin.left + barWidth / 2, chartWidth - margin.right - barWidth / 2]);
    }
    const maximum = mode === 'percent' ? 100 : d3.max(rows, row => stackedMode(mode) ? d3.sum(visible, item => pointAt(item, row)?.value || 0) : d3.max(visible, item => pointAt(item, row)?.value || 0)) || 1;
    y = d3.scaleLinear().domain([0, maximum]).nice(mode === 'percent' ? 5 : 4).range([margin.top + plotHeight, margin.top]);
    svg.attr('viewBox', `0 0 ${chartWidth} ${chartHeight}`).attr('height', chartHeight);
    svg.select('title').text(currentOptions.title || 'Statistics over time');
    svg.attr('aria-details', currentOptions.dataTableId || null);
    const description = {percent: 'Stacked percentages show each group’s share of the selected population.', count: 'Stacked counts show the combined group totals.', area: 'Overlaid areas show each series independently from a zero baseline.', bars: 'Grouped columns compare each series independently at each date.', lines: 'Comparison lines show each series independently over time.'}[mode] || 'Statistics over time.';
    const annotations = (currentOptions.annotations || []).map(annotation => ({...annotation, date: utcDate(annotation.date)}))
      .filter(annotation => Number.isFinite(+annotation.date) && annotation.date >= extent[0] && annotation.date <= extent[1]);
    const annotationText = annotations.map(annotation => `${dateFormat(annotation.date)}: ${annotation.label}.`).join(' ');
    svg.select('desc').text(`${currentOptions.description || `${description} ${visible.length} visible series. ${rows.length ? `Date range: ${dateFormat(extent[0])} to ${dateFormat(extent[1])}.` : 'No observations.'} Use left and right arrow keys to inspect dates, Shift and arrow keys to move by seven observations, Home for the first date, End for the last, and Enter to pin details. Click also pins details; Escape closes them. Pinned details scroll with up and down arrow keys. Hollow or dashed marks indicate partial periods. Missing observations remain gaps.${currentOptions.dataTableId ? ' The data table below this chart provides a text alternative; expand View data table to read it.' : ''}`} ${annotationText}`.trim());
    defs.select('clipPath rect').attr('x', margin.left).attr('y', margin.top).attr('width', chartWidth - margin.left - margin.right).attr('height', plotHeight);
    const tickCount = Math.max(3, Math.floor((chartWidth - margin.left - margin.right) / 100));
    // All data are daily. D3's default time ticks can otherwise introduce noon
    // labels in short ranges, or just two quarterly ticks on a narrow screen.
    let calendarTicks = x.ticks(tickCount).filter(date => +date === +d3.utcDay.floor(date));
    if (!singleDate && calendarTicks.length < 3) {
      calendarTicks = [...new Set([extent[0], new Date((+extent[0] + +extent[1]) / 2), extent[1]].map(date => +d3.utcDay.floor(date)))].map(time => new Date(time));
    }
    if (currentOptions.tickInterval === 'month') {
      calendarTicks = d3.utcMonth.range(d3.utcMonth.ceil(extent[0]), d3.utcMonth.offset(d3.utcMonth.floor(extent[1]), 1));
      if (!calendarTicks.length && rows.length) calendarTicks = [rows[0].date];
    } else if (currentOptions.tickInterval === 'year') {
      calendarTicks = d3.utcYear.range(d3.utcYear.ceil(extent[0]), d3.utcYear.offset(d3.utcYear.floor(extent[1]), 1));
      if (!calendarTicks.length && rows.length) calendarTicks = [rows[0].date];
    }
    // Calendar intervals can produce substantially more ticks than requested.
    // Keep labels legible on long histories and narrow viewports.
    const tickStride = Math.ceil(calendarTicks.length / tickCount);
    if (tickStride > 1) calendarTicks = calendarTicks.filter((_, index) => index % tickStride === 0);
    const spanDays = (+extent[1] - +extent[0]) / 86_400_000;
    const repeatedYears = new Set(calendarTicks.map(date => date.getUTCFullYear())).size < calendarTicks.length;
    const tickFormat = spanDays < 90 ? '%b %-d' : spanDays < 366 ? '%b' : repeatedYears ? '%b %Y' : '%Y';
    const dateAxis = d3.axisBottom(x).tickValues(calendarTicks).tickFormat(d3.utcFormat(tickFormat)).tickSize(0).tickPadding(14);
    if (singleDate && rows.length) dateAxis.tickValues([rows[0].date]).tickFormat(d3.utcFormat('%b %d, %Y'));
    if (currentOptions.formatTick) dateAxis.tickFormat(currentOptions.formatTick);
    xAxis.attr('transform', `translate(0,${margin.top + plotHeight})`).call(dateAxis);
    yAxis.attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(4).tickSize(0).tickPadding(10).tickFormat(mode === 'percent' || currentOptions.unit === 'percent' || currentOptions.unit === '%' ? formatPercentage : currentOptions.formatAxis || d3.format('~s')));
    grid.attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(chartWidth - margin.left - margin.right)).tickFormat(''));
    for (const axis of [xAxis, yAxis]) {
      // D3 adds a sans-serif family; inherit the site's text font instead.
      axis.attr('font-family', null);
      axis.select('.domain').remove();
      axis.selectAll('text').attr('fill', 'var(--text-muted, #7a859a)').style('font-family', 'inherit').style('font-size', '12px');
    }
    grid.attr('font-family', null).select('.domain').remove();
    grid.selectAll('line').attr('stroke', 'var(--chart-grid, #cbd5e1)').attr('stroke-opacity', 0.55).attr('stroke-dasharray', '3 5');
    yLabel.attr('x', margin.left).attr('y', 13).attr('fill', 'var(--text-muted, #7a859a)').style('font-family', 'inherit').style('font-size', '12px')
      .text(currentOptions.yLabel || (mode === 'percent' ? 'Share of selected population' : currentOptions.unit || 'Reported value'));
    const annotationGroups = annotationLayer.selectAll('g').data(annotations, annotation => `${dayString(annotation.date)}:${annotation.label}`).join(enter => {
      const group = enter.append('g').attr('class', 'chart-annotation');
      group.append('line').attr('class', 'chart-annotation-outline');
      group.append('line').attr('class', 'chart-annotation-line');
      group.append('text');
      return group;
    }).attr('data-date', annotation => dayString(annotation.date));
    annotationGroups.selectAll('line').attr('x1', annotation => x(annotation.date)).attr('x2', annotation => x(annotation.date))
      .attr('y1', margin.top).attr('y2', margin.top + plotHeight).attr('stroke-dasharray', '5 4');
    annotationGroups.select('.chart-annotation-outline').attr('stroke', '#000').attr('stroke-width', 3.5);
    annotationGroups.select('.chart-annotation-line').attr('stroke', '#fff').attr('stroke-width', 1.5);
    annotationGroups.select('text').attr('x', annotation => x(annotation.date) + (x(annotation.date) > chartWidth / 2 ? -6 : 6))
      .attr('text-anchor', annotation => x(annotation.date) > chartWidth / 2 ? 'end' : 'start').attr('y', (_, index) => margin.top + 15 + index % 3 * 17)
      .attr('fill', 'var(--text-muted, #7a859a)').attr('stroke', 'var(--surface, #fff)').attr('stroke-width', 3).attr('paint-order', 'stroke')
      .style('font-family', 'inherit').style('font-size', '12px').text(annotation => annotation.label);
    const surface = getComputedStyle(container).getPropertyValue('--surface').trim() || '#ffffff';
    chartSurface = surface;
    const fillOpacity = mode === 'area' ? 0.18 : 0.8;
    const data = visible.map(item => {
      const color = d3.color(item.color || '#8b5cf6')?.formatHex() || '#8b5cf6';
      const opacity = fillOpacity * (item.opacity ?? 1);
      return {...item, color, fillOpacity: opacity, ...chartBoundary(color, surface, opacity), geometry: [], type: mode === 'lines' ? 'line' : mode === 'bars' ? 'bars' : 'area'};
    });
    for (const row of rows) {
      let baseline = 0;
      for (const item of data) {
        const point = pointAt(item, row), value = mode === 'percent' ? point?.percent : point?.value;
        const bottom = stackedMode(mode) ? baseline : 0;
        item.geometry.push({date: row.date, value: finite(value) ? value : null, bottom, top: bottom + (value || 0), partial: Boolean(point?.partial), note: point?.note});
        if (stackedMode(mode) && finite(value)) baseline += value;
      }
    }
    const curve = currentOptions.curve === 'monotone' ? d3.curveMonotoneX : d3.curveLinear;
    const line = d3.line().defined(point => finite(point.value)).x(point => x(point.date)).y(point => y(point.value)).curve(curve);
    const area = d3.area().defined(point => finite(point.value)).x(point => x(point.date)).y0(point => y(point.bottom)).y1(point => y(point.top)).curve(curve);
    // Interpolating long SVG path strings can dominate a redraw even with a
    // zero-duration transition. Dense views update their geometry directly.
    const dense = rows.length * visible.length > 5000;
    const duration = motion?.matches || currentOptions.animate === false || dense ? 0 : 380;
    const transition = duration ? svg.transition().duration(duration).ease(d3.easeCubicOut) : null;
    const animate = selection => transition ? selection.transition(transition) : selection;
    // Paired black/white edges keep adjacent area bands distinct at any hue.
    // Lines keep their exact series color, with a halo only when contrast is low.
    const pathData = mode === 'bars' ? [] : data.flatMap(item => {
      const needsOutline = item.type !== 'line' || contrastRatio(compositeColor(item.color, surface, item.opacity ?? 1), surface) < 3;
      return needsOutline ? [{...item, outline: true}, item] : [item];
    });
    const pathSelection = paths.selectAll('path').data(pathData, item => `${item.id}:${item.type}:${Boolean(item.outline)}`);
    animate(pathSelection.exit().interrupt()).attr('opacity', 0).remove();
    const merged = pathSelection.enter().append('path').attr('opacity', 0).attr('d', item => transition ? (item.type === 'line' ? line(item.geometry) : area(item.geometry)) : null).merge(pathSelection).order()
      .attr('class', item => item.outline ? 'chart-outline' : 'chart-series')
      .attr('data-series', item => item.outline ? null : item.id).attr('data-outline-series', item => item.outline ? item.id : null)
      .attr('fill', item => item.outline || item.type === 'line' ? 'none' : item.color)
      .attr('fill-opacity', item => item.fillOpacity)
      .attr('stroke', item => item.type === 'line' ? item.outline ? contrastInk(surface) : item.color : item.outline ? item.outer : item.ink)
      .attr('stroke-width', item => item.type === 'line' ? (item.strokeWidth ?? 2.5) + (item.outline ? 2.5 : 0) : item.outline ? 3 : 1)
      .attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    // Dim the series fill/line, but keep its contrast boundary fully opaque.
    animate(merged.interrupt()).attr('opacity', item => item.type === 'line' && !item.outline ? item.opacity ?? 1 : 1).attr('d', item => item.type === 'line' ? line(item.geometry) : area(item.geometry));
    // Preserve isolated observations and partial periods. Zero-run boundaries
    // help sparse views; dense views already show zeros in paths and tooltips.
    const pointMarkers = mode === 'bars' ? [] : data.flatMap(item => item.geometry.flatMap((point, index, points) => {
      const isolated = !finite(points[index - 1]?.value) && !finite(points[index + 1]?.value);
      const zeroBoundary = point.value === 0 && (index === 0 || index === points.length - 1 || points[index - 1]?.value !== 0 || points[index + 1]?.value !== 0);
      return finite(point.value) && (isolated || (!dense && zeroBoundary) || point.partial) ? [{...point, id: item.id, color: item.color, isolated}] : [];
    }));
    paths.selectAll('circle.chart-point').data(pointMarkers, item => `${item.id}:${dayString(item.date)}`).join('circle')
      .attr('class', item => `chart-point${item.isolated ? ' single-observation' : ''}${item.partial ? ' partial' : ''}`)
      .attr('data-series', item => item.id).attr('data-date', item => dayString(item.date)).attr('data-partial', item => item.partial ? 'true' : null)
      .attr('cx', item => x(item.date)).attr('cy', item => y(item.top)).attr('r', item => item.value === 0 ? 2.5 : 4)
      .attr('fill', item => item.partial ? 'var(--surface, #fff)' : item.color || '#8b5cf6')
      .attr('stroke', item => item.partial ? contrastRatio(item.color, surface) >= 3 ? item.color : contrastInk(surface) : contrastInk(item.color))
      .attr('stroke-width', 1.5).attr('stroke-dasharray', item => item.partial ? '2 1' : null);
    const slotWidth = barWidth / Math.max(1, data.length);
    const barData = mode === 'bars' ? data.flatMap((item, seriesIndex) => item.geometry.filter(point => finite(point.value)).map(point => ({...point, id: item.id, color: item.color || '#8b5cf6', seriesIndex, opacity: item.opacity}))) : [];
    const barSelection = bars.selectAll('rect.chart-bar').data(barData, item => `${item.id}:${dayString(item.date)}`);
    animate(barSelection.exit().interrupt()).attr('height', 0).attr('y', y(0)).remove();
    const mergedBars = barSelection.enter().append('rect').attr('class', 'chart-bar').attr('y', y(0)).attr('height', 0).merge(barSelection)
      .attr('data-series', item => item.id).attr('data-date', item => dayString(item.date)).attr('data-partial', item => item.partial ? 'true' : null)
      .attr('fill', item => item.color).attr('fill-opacity', item => (item.partial ? 0.38 : 0.85) * (item.opacity ?? 1))
      .attr('stroke', item => slotWidth * 0.84 < 3 || Math.abs(y(0) - y(item.value)) < 3 ? contrastInk(surface)
        : chartBoundary(item.color, surface, (item.partial ? 0.38 : 0.85) * (item.opacity ?? 1)).ink)
      .attr('stroke-width', 1.5).attr('stroke-dasharray', item => item.partial ? '3 2' : null).attr('rx', 1.5);
    animate(mergedBars.interrupt()).attr('x', item => x(item.date) - barWidth / 2 + item.seriesIndex * slotWidth + slotWidth * 0.08)
      .attr('width', Math.max(0.3, slotWidth * 0.84)).attr('y', item => y(item.value) - (item.value === 0 ? 2 : 0))
      .attr('height', item => item.value === 0 ? 2 : y(0) - y(item.value)).attr('opacity', 1);
    empty.attr('x', chartWidth / 2).attr('y', margin.top + plotHeight / 2).text(hasData ? '' : currentOptions.emptyMessage || 'No observations for this selection');
    // Include the gutters so endpoint dates remain easy to select on long ranges.
    const interactionLeft = Math.max(0, margin.left - 12);
    overlay.attr('x', interactionLeft).attr('y', margin.top).attr('width', chartWidth - 4 - interactionLeft).attr('height', plotHeight);
    if (currentOptions.overview && currentOptions.overview !== overviewSource) {
      overviewSource = currentOptions.overview;
      overviewPoints = normalizeOverview(overviewSource);
    }
    const summary = currentOptions.overview ? overviewPoints : rows.map(row => ({date: row.date, value: d3.sum(visible, item => pointAt(item, row)?.value || 0), observed: visible.some(item => finite(pointAt(item, row)?.value))}));
    navigator.attr('display', hasNavigator && summary.length > 1 ? null : 'none').attr('transform', `translate(0,${chartHeight - 43})`);
    rangeLabel.attr('hidden', hasNavigator && summary.length > 1 ? null : true);
    if (hasNavigator && summary.length > 1) {
      const fullExtent = d3.extent(summary, point => point.date);
      const nx = d3.scaleUtc().domain(fullExtent).range([margin.left, chartWidth - margin.right]);
      navigator.attr('data-start', dayString(fullExtent[0])).attr('data-end', dayString(fullExtent[1]));
      const ny = d3.scaleLinear().domain([0, d3.max(summary, point => point.value) || 1]).range([30, 1]);
      navigationPath.attr('d', d3.area().defined(point => point.observed).x(point => nx(point.date)).y0(31).y1(point => ny(point.value)).curve(curve)(summary));
      const labelWidth = Math.min(250, chartWidth - 8);
      rangeLabel.style('width', `${labelWidth}px`).style('top', `${chartHeight - 75}px`);
      const brush = d3.brushX().extent([[margin.left, 0], [chartWidth - margin.right, 32]]).on('start brush end', event => {
        rangeLabel.attr('hidden', event.selection ? null : true);
        if (!event.selection) return;
        if (event.type === 'start' && event.sourceEvent) hideTooltip();
        const [start, end] = event.selection.map(position => d3.utcDay.round(nx.invert(position)));
        textIfChanged(rangeStartLabel.node(), calendarFormat.format(start));
        textIfChanged(rangeEndLabel.node(), calendarFormat.format(end));
        rangeStartLabel.attr('datetime', dayString(start));
        rangeEndLabel.attr('datetime', dayString(end));
        const center = (event.selection[0] + event.selection[1]) / 2;
        rangeLabel.style('left', `${Math.max(labelWidth / 2 + 4, Math.min(chartWidth - labelWidth / 2 - 4, center))}px`);
        if (event.type !== 'end' || !event.sourceEvent) return;
        if (+start <= +end) {
          live.text(`Selected range: ${calendarFormat.format(start)} to ${calendarFormat.format(end)}.`);
          currentOptions.onRangeChange?.([dayString(start), dayString(end)]);
        }
      });
      brushGroup.call(brush);
      const selectedStart = currentOptions.startDate ? utcDate(currentOptions.startDate) : rows[0]?.date || fullExtent[0];
      const selectedEnd = currentOptions.endDate ? utcDate(currentOptions.endDate) : rows.at(-1)?.date || fullExtent[1];
      const bounds = [selectedStart, selectedEnd].map(date => Math.max(margin.left, Math.min(chartWidth - margin.right, nx(date))));
      brushGroup.call(brush.move, bounds);
      brushGroup.selectAll('.selection').attr('fill', 'var(--accent)').attr('fill-opacity', 0.12).attr('stroke', 'var(--accent)').attr('stroke-opacity', 1);
      brushGroup.selectAll('.handle').attr('fill', 'var(--accent)').attr('rx', 2);
    }
  }

  let observedWidth;
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(entries => {
    const width = entries[0]?.contentRect.width;
    const changed = observedWidth !== undefined && Math.abs(width - observedWidth) > 0.5;
    observedWidth = width;
    if (changed) redraw();
  }) : null;
  observer?.observe(container);
  const stopObservingTheme = observeChartTheme(container, redraw);
  motion?.addEventListener?.('change', redraw);
  const controller = {
    update(nextSeries, nextOptions = {}) { currentSeries = nextSeries || []; currentOptions = {...currentOptions, ...nextOptions}; redraw(); return controller; },
    destroy() {
      destroyed = true;
      cancelHover();
      observer?.disconnect();
      stopObservingTheme();
      motion?.removeEventListener?.('change', redraw);
      document.removeEventListener('keydown', closeOnEscape);
      svg.interrupt();
      svg.selectAll('*').interrupt();
      if (tooltipScrollFrame !== null) cancelAnimationFrame(tooltipScrollFrame);
      root.remove(); charts.delete(container);
    },
    exportSVG() { return serializeSVG(svg.node(), stackedMode(currentOptions.mode) ? [...visible].reverse() : visible); },
    inspectDate(date) {
      suppressHover = false;
      if (rows.length) showTooltip(d3.bisector(row => row.date).center(rows, utcDate(date)), true);
    },
  };
  charts.set(container, controller);
  redraw();
  return controller;
}

function serializeSVG(node, series) {
  const clone = node.cloneNode(true);
  const originals = [node, ...node.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
  const properties = ['fill', 'stroke', 'stroke-width', 'stroke-opacity', 'fill-opacity', 'font-family', 'font-size', 'font-weight', 'color'];
  originals.forEach((original, index) => {
    const style = getComputedStyle(original);
    properties.forEach(property => copies[index].style.setProperty(property, style.getPropertyValue(property)));
  });
  const namespace = 'http://www.w3.org/2000/svg';
  const width = node.viewBox.baseVal.width, plotHeight = node.viewBox.baseVal.height;
  const style = getComputedStyle(node);
  const fontFamily = style.fontFamily || 'sans-serif';
  const textColor = style.getPropertyValue('--text').trim() || style.color || '#18253a';
  const padding = width < 520 ? 16 : 24, innerWidth = width - padding * 2;
  const exported = document.createElementNS(namespace, 'svg');
  exported.setAttribute('xmlns', namespace);
  exported.setAttribute('width', width);
  exported.setAttribute('role', 'img');
  exported.setAttribute('font-family', fontFamily);
  exported.setAttribute('fill', textColor);
  const make = (tag, attributes = {}, parent = exported) => {
    const element = document.createElementNS(namespace, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    parent.append(element);
    return element;
  };
  // Measure in the same resolved font as the plot. Split long tokens as well
  // as ordinary words so no legend entry can escape a narrow export.
  const context = document.createElement('canvas').getContext('2d');
  const measure = (text, size, weight = 400) => {
    context.font = `${weight} ${size}px ${fontFamily}`;
    return context.measureText(text).width;
  };
  const wrap = (text, limit, size, weight = 400) => {
    const lines = [];
    let line = '';
    for (const word of String(text).trim().split(/\s+/)) {
      if (line && measure(`${line} ${word}`, size, weight) <= limit) { line += ` ${word}`; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const character of word) {
        if (line && measure(line + character, size, weight) > limit) { lines.push(line); line = ''; }
        line += character;
      }
    }
    if (line || !lines.length) lines.push(line);
    return lines;
  };
  const addLines = (parent, lines, x, y, size, lineHeight, attributes = {}) => {
    const text = make('text', {x, y, 'font-size': size, ...attributes}, parent);
    lines.forEach((line, index) => { make('tspan', {x, dy: index ? lineHeight : 0}, text).textContent = line + (index < lines.length - 1 ? ' ' : ''); });
    return text;
  };
  const title = node.querySelector('title')?.textContent || 'Statistics over time';
  exported.setAttribute('aria-label', title);
  make('title').textContent = title;
  const titleLines = wrap(title, innerWidth, 18, 600);
  addLines(exported, titleLines, padding, padding + 18, 18, 24, {'class': 'chart-export-title', 'font-weight': 600});
  const headerHeight = padding + titleLines.length * 24 + 8;
  clone.setAttribute('x', 0);
  clone.setAttribute('y', headerHeight);
  clone.setAttribute('width', width);
  clone.setAttribute('height', plotHeight);
  clone.removeAttribute('tabindex');
  clone.removeAttribute('aria-describedby');
  clone.removeAttribute('aria-details');
  clone.querySelector('.chart-crosshair')?.remove();
  const visibleIds = new Set(series.map(item => String(item.id)));
  clone.querySelectorAll('[data-series]').forEach(mark => {
    if (!visibleIds.has(mark.getAttribute('data-series'))) mark.remove();
  });
  exported.append(clone);
  const legend = make('g', {'class': 'chart-export-legend', 'font-size': 12});
  const plotMarks = [...node.querySelectorAll('[data-series]')];
  let x = padding, y = headerHeight + plotHeight + 16, rowHeight = 0;
  for (const item of series) {
    const lines = wrap(item.name || item.id, innerWidth - 20, 12);
    const itemWidth = Math.min(innerWidth, 20 + Math.max(...lines.map(line => measure(line, 12))));
    if (x > padding && x + itemWidth > width - padding) { x = padding; y += rowHeight + 10; rowHeight = 0; }
    const group = make('g', {'data-series': item.id, 'aria-label': item.name || item.id}, legend);
    const mark = plotMarks.find(mark => mark.getAttribute('data-series') === String(item.id));
    const markStyle = mark && getComputedStyle(mark);
    const color = item.color || (markStyle?.fill && markStyle.fill !== 'none' ? markStyle.fill : markStyle?.stroke) || '#8b5cf6';
    make('rect', {x, y: y + 3, width: 10, height: 10, rx: 2, fill: color, stroke: textColor, 'stroke-width': 1}, group);
    addLines(group, lines, x + 20, y + 12, 12, 18, {'class': 'chart-export-legend-label'});
    rowHeight = Math.max(rowHeight, lines.length * 18);
    x += itemWidth + 24;
  }
  const height = series.length ? y + rowHeight + padding : headerHeight + plotHeight + padding;
  exported.setAttribute('height', height);
  exported.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const background = make('rect', {width, height, fill: style.getPropertyValue('--surface').trim() || '#ffffff'});
  exported.insertBefore(background, exported.firstChild);
  return new XMLSerializer().serializeToString(exported);
}

export function exportSVG(container) {
  if (typeof container === 'string') container = document.querySelector(container);
  return charts.get(container)?.exportSVG() || null;
}
