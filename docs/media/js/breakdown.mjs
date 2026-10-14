/** Latest-period categorical rankings, using the site's self-hosted D3 bundle. */
import {formatPercentage} from "./chart.mjs";
import {trackFocusInput, hasKeyboardFocus} from "./focus.mjs";
import {chartBoundary, contrastInk, contrastRatio, observeChartTheme} from "./chart-contrast.mjs";
const charts = new WeakMap();
const finite = value => typeof value === 'number' && Number.isFinite(value);
let nextId = 0;

/**
 * Render every supplied category without grouping or truncating the dataset.
 * `height` limits the scrolling viewport, rather than the number of categories.
 */
export function renderBreakdown(container, items = [], options = {}) {
  if (typeof container === 'string') container = document.querySelector(container);
  if (!container) throw new Error('Breakdown container was not found.');
  trackFocusInput(container.ownerDocument);
  if (charts.has(container)) return charts.get(container).update(items, options);
  const d3 = globalThis.d3;
  if (!d3) throw new Error('The self-hosted D3 library must load before the breakdown.');

  const uid = `stats-breakdown-${++nextId}`;
  let currentItems = items, currentOptions = {scale: 'linear', ...options};
  let rows = [], width = 0, rowHeight = 0, focusedId = null, destroyed = false;
  const root = d3.select(container).append('div').attr('class', 'breakdown-chart')
    .style('position', 'relative').style('min-width', '0').style('font-family', 'inherit');
  const axis = root.append('svg').attr('class', 'breakdown-axis').attr('aria-hidden', 'true')
    .attr('width', '100%').attr('height', 36).style('display', 'block').style('overflow', 'hidden');
  const axisGroup = axis.append('g');
  const categoryCount = root.append('p').attr('class', 'breakdown-count')
    .style('margin', '2px 0 8px').style('font-size', '12px').style('color', 'var(--text-muted, #64748b)');
  const viewport = root.append('div').attr('class', 'breakdown-viewport')
    .style('overflow-y', 'auto').style('overflow-x', 'hidden').style('overscroll-behavior', 'contain')
    .style('scrollbar-gutter', 'stable').style('border-radius', '6px');
  const svg = viewport.append('svg').attr('class', 'stats-breakdown').attr('width', '100%')
    .attr('role', 'group').attr('aria-labelledby', `${uid}-title`).attr('aria-describedby', `${uid}-description`)
    .style('display', 'block').style('font-family', 'inherit');
  svg.append('title').attr('id', `${uid}-title`);
  svg.append('desc').attr('id', `${uid}-description`);
  const grid = svg.append('g').attr('aria-hidden', 'true');
  const plot = svg.append('g');
  const empty = svg.append('text').attr('text-anchor', 'middle').attr('fill', 'var(--text-muted, #64748b)')
    .style('font-size', '13px');
  const note = root.append('p').attr('class', 'breakdown-note')
    .style('margin', '10px 0 0').style('font-size', '12px').style('line-height', '1.5')
    .style('color', 'var(--text-muted, #64748b)');
  const tooltip = root.append('div').attr('class', 'chart-tooltip breakdown-tooltip')
    .attr('id', `${uid}-tooltip`).attr('role', 'tooltip').attr('hidden', true)
    .style('position', 'absolute').style('z-index', '5').style('pointer-events', 'none')
    .style('padding', '10px 12px').style('border', '1px solid var(--line, #cbd5e1)')
    .style('border-radius', '8px').style('background', 'var(--surface, #fff)')
    .style('color', 'var(--text, #18253a)').style('box-shadow', '0 8px 28px #0002')
    .style('font-size', '12px').style('line-height', '1.6').style('overflow-wrap', 'anywhere');

  const formatValue = value => currentOptions.formatValue
    ? currentOptions.formatValue(value)
    : new Intl.NumberFormat('en', {maximumFractionDigits: 2}).format(value);
  const formatTotal = value => currentOptions.formatTotal ? currentOptions.formatTotal(value) : formatValue(value);
  const percentLabel = formatPercentage;
  const available = item => finite(item.value);
  const numberLabel = item => available(item) ? String(formatValue(item.value)) : 'Unavailable';
  const unitLabel = () => currentOptions.unit ? ` ${currentOptions.unit}` : '';
  function accessibleLabel(item) {
    let label = `${item.name}: ${numberLabel(item)}${available(item) ? unitLabel() : ''}`;
    if (finite(item.percent)) label += `; ${percentLabel(item.percent)}`;
    if (finite(item.total)) label += `; ${currentOptions.totalLabel || 'Total'}: ${formatTotal(item.total)}`;
    if (currentOptions.scale === 'log' && available(item) && item.value < 0) label += '; negative value cannot be plotted on a logarithmic scale';
    return label;
  }

  function hideTooltip() {
    tooltip.attr('hidden', true);
    plot.selectAll('.breakdown-row').attr('aria-describedby', null);
  }

  function showTooltip(item, node) {
    if (!item || !node) return;
    tooltip.selectAll('*').remove();
    tooltip.append('strong').style('display', 'block').text(item.name);
    tooltip.append('div').text(`${numberLabel(item)}${available(item) ? unitLabel() : ''}`);
    if (finite(item.percent)) tooltip.append('div').text(`${percentLabel(item.percent)} of the published category total`);
    if (finite(item.total)) tooltip.append('div').text(`${currentOptions.totalLabel || 'Total'}: ${formatTotal(item.total)}`);
    if (currentOptions.scale === 'log' && item.value === 0) tooltip.append('div').text('Zero: shown at the baseline, outside the logarithmic scale.');
    if (currentOptions.scale === 'log' && available(item) && item.value < 0) tooltip.append('div').text('Negative value: unavailable on a logarithmic scale.');
    tooltip.style('max-width', `${Math.max(80, Math.min(320, width - 24))}px`).attr('hidden', null);
    const bounds = root.node().getBoundingClientRect(), rowBounds = node.getBoundingClientRect();
    const tipBounds = tooltip.node().getBoundingClientRect();
    const viewBounds = viewport.node().getBoundingClientRect();
    const below = rowBounds.bottom - bounds.top + 5;
    const above = rowBounds.top - bounds.top - tipBounds.height - 5;
    const top = below + tipBounds.height <= viewBounds.bottom - bounds.top ? below : Math.max(0, above);
    tooltip.style('left', `${Math.max(8, width - tipBounds.width - 8)}px`).style('top', `${top}px`);
    plot.selectAll('.breakdown-row').attr('aria-describedby', null);
    d3.select(node).attr('aria-describedby', `${uid}-tooltip`);
  }

  function focusRow(index) {
    if (!rows.length) return;
    const item = rows[Math.max(0, Math.min(rows.length - 1, index))];
    focusedId = item.key;
    const selection = plot.selectAll('.breakdown-row').attr('tabindex', row => row.key === focusedId ? 0 : -1);
    const node = selection.filter(row => row.key === focusedId).node();
    const top = rows.indexOf(item) * rowHeight, bottom = top + rowHeight, view = viewport.node();
    if (top < view.scrollTop) view.scrollTop = top;
    else if (bottom > view.scrollTop + view.clientHeight) view.scrollTop = bottom - view.clientHeight;
    node?.focus({preventScroll: true});
    showTooltip(item, node);
  }

  viewport.on('scroll', () => {
    const focused = plot.selectAll('.breakdown-row').filter(item => item.key === focusedId).node();
    if (focused && hasKeyboardFocus(focused)) {
      const bounds = focused.getBoundingClientRect(), view = viewport.node().getBoundingClientRect();
      if (bounds.top >= view.top && bounds.bottom <= view.bottom) {
        showTooltip(rows.find(item => item.key === focusedId), focused);
        return;
      }
    }
    hideTooltip();
  });
  plot.on('keydown', event => {
    let index = rows.findIndex(item => item.key === focusedId);
    if (event.key === 'ArrowDown') index++;
    else if (event.key === 'ArrowUp') index--;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = rows.length - 1;
    else if (event.key === 'Escape') { hideTooltip(); return; }
    else return;
    event.preventDefault();
    focusRow(index);
  });

  function fitText(selection, text, maxWidth) {
    selection.text(text);
    if (selection.node().getComputedTextLength() <= maxWidth) return;
    let low = 0, high = text.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      selection.text(`${text.slice(0, middle)}…`);
      if (selection.node().getComputedTextLength() <= maxWidth) low = middle;
      else high = middle - 1;
    }
    selection.text(`${text.slice(0, low)}…`);
  }

  function redraw() {
    if (destroyed) return;
    hideTooltip();
    const surface = getComputedStyle(container).getPropertyValue('--surface').trim() || '#ffffff';
    rows = (currentItems || []).map((item, index) => ({
      ...item, name: String(item.name ?? item.id ?? 'Unnamed category'), key: `${item.id ?? item.name ?? index}\u0000${index}`,
    })).sort((a, b) => available(a) && available(b) ? b.value - a.value : available(a) ? -1 : available(b) ? 1 : 0);
    if (!rows.some(item => item.key === focusedId)) focusedId = rows[0]?.key ?? null;
    const outerWidth = Math.max(1, container.clientWidth || 800);
    const maxHeight = Math.max(120, Number(currentOptions.height) || 440);
    viewport.style('max-height', `${maxHeight}px`);
    width = Math.max(1, viewport.node().clientWidth || outerWidth);
    const compact = width < 560;
    rowHeight = compact ? 58 : 42;
    const height = Math.max(90, rows.length * rowHeight);
    categoryCount.text(`${rows.length} selected categories${height > maxHeight ? ". Scroll to see all; ↑/↓ to inspect, Home/End for first/last." : ". All categories shown."}`);
    const valuesWidth = Math.min(width * 0.35, Math.max(88, ...rows.map(item => numberLabel(item).length * 7 + 18)));
    const labelWidth = Math.min(230, Math.max(130, width * 0.27));
    const left = compact ? 12 : labelWidth + 12, right = compact ? width - 12 : width - valuesWidth;
    const plotWidth = Math.max(1, right - left), log = currentOptions.scale === 'log';
    const integerValues = currentOptions.integerValues ?? !['percent', '%'].includes(currentOptions.unit);
    const numeric = rows.filter(available).map(item => item.value), positives = numeric.filter(value => value > 0);
    let scale;
    if (log) {
      const minimum = d3.min(positives) || 1, maximum = d3.max(positives) || 10;
      // Counts begin at one. Fractional metrics retain a lower positive decade;
      // zero is a separate baseline mark, never a fabricated count of one.
      const decade = 10 ** (Math.floor(Math.log10(minimum)) - 1);
      const lower = integerValues ? Math.max(1, decade) : decade;
      const upper = maximum > lower ? maximum : lower * 10;
      scale = d3.scaleLog().domain([lower, upper]).nice().range([left, right]);
    } else {
      const minimum = Math.min(0, d3.min(numeric) || 0), maximum = Math.max(0, d3.max(numeric) || 0);
      scale = d3.scaleLinear().domain([minimum, minimum === maximum ? maximum + 1 : maximum]).nice().range([left, right]);
    }
    const baseline = log ? left : scale(0);
    const ticks = scale.ticks(Math.max(2, Math.floor(plotWidth / 90))).filter(value => !log || !integerValues || value >= 1);
    axis.attr('viewBox', `0 0 ${width} 36`).style('width', `${width}px`).style('max-width', '100%');
    axisGroup.attr('transform', 'translate(0,29)').call(d3.axisTop(scale).tickValues(ticks).tickSize(0).tickPadding(8).tickFormat(log ? scale.tickFormat(Math.max(2, Math.floor(plotWidth / 90)), '~s') : d3.format('~s')));
    axisGroup.attr('font-family', null).select('.domain').remove();
    axisGroup.selectAll('text').style('font-family', 'inherit').style('font-size', '11px').attr('fill', 'var(--text-muted, #64748b)');
    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('height', height);
    svg.select('title').text(currentOptions.title || 'Latest categorical breakdown');
    svg.attr('aria-details', currentOptions.dataTableId || null);
    svg.select('desc').text(`${rows.length} categories, ranked by value. ${log ? 'Logarithmic' : 'Linear'} scale. Use up and down arrows to inspect categories, Home for the first and End for the last. Missing values are unavailable. Every supplied category is included.`);
    grid.selectAll('line').data(ticks).join('line').attr('x1', value => scale(value)).attr('x2', value => scale(value))
      .attr('y1', 0).attr('y2', height).attr('stroke', 'var(--chart-grid, #e2e8f0)').attr('stroke-dasharray', '3 5');
    const row = plot.selectAll('.breakdown-row').data(rows, item => item.key).join(enter => {
      const group = enter.append('g').attr('class', 'breakdown-row').attr('role', 'img');
      group.append('title');
      group.append('rect').attr('class', 'breakdown-hit').attr('fill', 'transparent');
      group.append('rect').attr('class', 'breakdown-bar').attr('rx', 3).attr('aria-hidden', 'true');
      group.append('line').attr('class', 'breakdown-zero').attr('aria-hidden', 'true');
      group.append('circle').attr('class', 'breakdown-point').attr('aria-hidden', 'true');
      group.append('text').attr('class', 'breakdown-label').attr('aria-hidden', 'true');
      group.append('text').attr('class', 'breakdown-value').attr('aria-hidden', 'true');
      return group;
    }).attr('id', (_, index) => `${uid}-row-${index}`).attr('transform', (_, index) => `translate(0,${index * rowHeight})`)
      .attr('tabindex', item => item.key === focusedId ? 0 : -1).attr('aria-label', accessibleLabel)
      .on('pointerenter', function(event, item) { showTooltip(item, this); })
      .on('pointerleave', function() { if (!hasKeyboardFocus(this)) hideTooltip(); })
      .on('focus', function(event, item) {
        focusedId = item.key;
        plot.selectAll('.breakdown-row').attr('tabindex', other => other.key === focusedId ? 0 : -1);
        if (hasKeyboardFocus(this)) showTooltip(item, this);
      }).on('blur', hideTooltip);
    row.select('title').text(accessibleLabel);
    // Keep the keyboard stroke inside the scrolling SVG instead of clipping it.
    row.select('.breakdown-hit').attr('x', 1).attr('y', 1)
      .attr('width', Math.max(0, width - 2)).attr('height', rowHeight - 2).attr('rx', 5);
    const barY = compact ? 35 : 13, barHeight = compact ? 9 : 16;
    row.select('.breakdown-bar')
      .attr('display', item => available(item) && (log ? item.value > 0 : item.value !== 0) ? null : 'none')
      .attr('x', item => available(item) && (!log || item.value > 0) ? Math.min(baseline, scale(item.value)) : baseline)
      .attr('width', item => available(item) && (!log || item.value > 0) ? Math.abs(scale(item.value) - baseline) : 0)
      .attr('y', barY).attr('height', barHeight).attr('fill', item => item.color || 'var(--accent, #1373d9)')
      .attr('stroke', item => Math.abs(scale(item.value) - baseline) < 3 ? contrastInk(surface)
        : chartBoundary(d3.color(item.color || '#1373d9').formatHex(), surface).ink).attr('stroke-width', 1.25);
    row.select('.breakdown-point')
      .attr('display', item => log && available(item) && item.value > 0 && Math.abs(scale(item.value) - baseline) < 0.01 ? null : 'none')
      .attr('cx', item => available(item) && item.value > 0 ? scale(item.value) : baseline)
      .attr('cy', barY + barHeight / 2).attr('r', 3)
      .attr('fill', item => item.color || 'var(--accent, #1373d9)')
      .attr('stroke', item => contrastInk(d3.color(item.color || '#1373d9').formatHex())).attr('stroke-width', 1.25);
    row.select('.breakdown-zero').attr('display', item => item.value === 0 ? null : 'none')
      .attr('x1', baseline).attr('x2', baseline).attr('y1', barY - 2).attr('y2', barY + barHeight + 2)
      .attr('stroke', item => {
        const color = d3.color(item.color || '#1373d9').formatHex();
        return contrastRatio(color, surface) >= 3 ? color : contrastInk(surface);
      }).attr('stroke-width', 2);
    row.select('.breakdown-label').attr('x', compact ? 12 : left - 12).attr('y', compact ? 20 : 25)
      .attr('text-anchor', compact ? 'start' : 'end').attr('fill', 'var(--text, #18253a)')
      .style('font-size', '12px').style('font-family', 'inherit')
      .each(function(item) { fitText(d3.select(this), item.name, compact ? Math.max(20, width - valuesWidth - 24) : labelWidth - 10); });
    row.select('.breakdown-value').attr('x', width - 12).attr('y', compact ? 20 : 25).attr('text-anchor', 'end')
      .attr('fill', item => available(item) ? 'var(--text, #18253a)' : 'var(--text-muted, #64748b)')
      .style('font-size', '12px').style('font-family', 'inherit').style('font-variant-numeric', 'tabular-nums')
      .each(function(item) { fitText(d3.select(this), numberLabel(item), valuesWidth - 8); });
    empty.attr('x', width / 2).attr('y', 48).attr('display', rows.length ? 'none' : null).text('No categories are available for this period.');
    note.text(log ? 'Logarithmic scale compares orders of magnitude. Zero values use a baseline mark outside the log scale; missing or negative values have no bar.' : '')
      .attr('hidden', log ? null : true);
  }

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(redraw);
  observer?.observe(container);
  const stopObservingTheme = observeChartTheme(container, redraw);
  document.fonts?.ready.then(() => { if (!destroyed) redraw(); });
  const controller = {
    update(nextItems = [], nextOptions = {}) {
      currentItems = nextItems || [];
      currentOptions = {...currentOptions, ...nextOptions};
      redraw();
      return controller;
    },
    destroy() {
      destroyed = true;
      observer?.disconnect();
      stopObservingTheme();
      root.remove();
      charts.delete(container);
    },
    exportSVG() {
      const clone = svg.node().cloneNode(true), axisClone = axis.node().cloneNode(true);
      // Resolve inherited fonts and theme variables before exporting a standalone SVG.
      for (const [original, copy] of [[svg.node(), clone], [axis.node(), axisClone]]) {
        const originals = [original, ...original.querySelectorAll('*')], copies = [copy, ...copy.querySelectorAll('*')];
        originals.forEach((node, index) => {
          const style = getComputedStyle(node);
          for (const property of ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight']) {
            copies[index].style.setProperty(property, style.getPropertyValue(property));
          }
        });
      }
      const namespace = 'http://www.w3.org/2000/svg', output = document.createElementNS(namespace, 'svg');
      const noteLines = [], noteStyle = getComputedStyle(note.node());
      if (currentOptions.scale === 'log') {
        const context = document.createElement('canvas').getContext('2d');
        context.font = `12px ${noteStyle.fontFamily}`;
        for (const word of note.text().split(' ')) {
          const index = noteLines.length - 1, candidate = index < 0 ? word : `${noteLines[index]} ${word}`;
          if (index < 0 || context.measureText(candidate).width > width - 16) noteLines.push(word);
          else noteLines[index] = candidate;
        }
      }
      const rowsHeight = Number(clone.getAttribute('height')), height = rowsHeight + 36 + noteLines.length * 18;
      output.setAttribute('xmlns', namespace);
      output.setAttribute('width', width);
      output.setAttribute('height', height);
      output.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const background = document.createElementNS(namespace, 'rect');
      background.setAttribute('width', '100%');
      background.setAttribute('height', '100%');
      background.setAttribute('fill', getComputedStyle(root.node()).getPropertyValue('--surface').trim() || '#fff');
      output.append(background);
      axisClone.setAttribute('x', 0);
      axisClone.setAttribute('y', 0);
      axisClone.setAttribute('width', width);
      clone.setAttribute('x', 0);
      clone.setAttribute('y', 36);
      output.append(axisClone, clone);
      for (const [index, line] of noteLines.entries()) {
        const text = document.createElementNS(namespace, 'text');
        text.setAttribute('x', 8);
        text.setAttribute('y', 36 + rowsHeight + 14 + index * 18);
        text.setAttribute('fill', getComputedStyle(note.node()).color);
        text.setAttribute('font-family', getComputedStyle(note.node()).fontFamily);
        text.setAttribute('font-size', 12);
        text.textContent = line;
        output.append(text);
      }
      output.querySelectorAll('[tabindex]').forEach(node => node.removeAttribute('tabindex'));
      output.querySelectorAll('[aria-describedby]').forEach(node => node.removeAttribute('aria-describedby'));
      output.querySelectorAll('[aria-details]').forEach(node => node.removeAttribute('aria-details'));
      output.querySelectorAll('.breakdown-hit').forEach(node => {
        node.setAttribute('fill', 'transparent');
        node.style.setProperty('fill', 'transparent');
      });
      return new XMLSerializer().serializeToString(output);

    },
  };
  charts.set(container, controller);
  redraw();
  return controller;
}
