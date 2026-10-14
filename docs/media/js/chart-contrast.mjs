function rgb(color) {
  const hex = /^#([a-f\d]{3}|[a-f\d]{6})$/i.exec(color);
  if (hex) {
    const value = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
    return [0, 2, 4].map(start => parseInt(value.slice(start, start + 2), 16));
  }
  const channels = /^rgba?\(([^)]+)\)/i.exec(color)?.[1].match(/[\d.]+/g);
  if (channels?.length >= 3) return channels.slice(0, 3).map(Number);
  throw new TypeError(`Unsupported chart color: ${color}`);
}

function luminance(color) {
  const linear = rgb(color).map(value => {
    value /= 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function contrastRatio(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function compositeColor(color, background, opacity = 1) {
  const surface = rgb(background);
  return `rgb(${rgb(color).map((channel, index) => Math.round(channel * opacity + surface[index] * (1 - opacity))).join(', ')})`;
}

/** Black or white always provides at least 4.58:1 against an opaque color. */
export function contrastInk(color) {
  return contrastRatio('#000', color) >= contrastRatio('#fff', color) ? '#000000' : '#ffffff';
}

export function chartBoundary(color, background, opacity = 1) {
  const ink = contrastInk(compositeColor(color, background, opacity));
  return {ink, outer: ink === '#000000' ? '#ffffff' : '#000000'};
}

/** Theme-sensitive outlines update for explicit themes and OS theme changes. */
export function observeChartTheme(element, redraw) {
  const document = element.ownerDocument;
  const observer = new MutationObserver(redraw);
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
  const media = document.defaultView.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if (!document.documentElement.dataset.theme) redraw(); };
  media.addEventListener('change', onChange);
  return () => { observer.disconnect(); media.removeEventListener('change', onChange); };
}
