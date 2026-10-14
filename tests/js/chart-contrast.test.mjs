import test from 'node:test';
import assert from 'node:assert/strict';
import {contrastRatio, contrastInk, compositeColor, chartBoundary} from '../../docs/media/js/chart-contrast.mjs';

test('contrast ratios use WCAG linearized sRGB luminance', () => {
  assert.equal(contrastRatio('#000', '#fff'), 21);
  assert.equal(contrastRatio('#123456', '#123456'), 1);
  assert.equal(contrastRatio('rgb(255, 255, 255)', '#000000'), 21);
  assert.ok(contrastRatio('#2EB6FF', '#fff') < 3);
  assert.ok(contrastRatio('#0B5CBD', '#1a192a') < 3);
});

test('outlines contrast with composited area fills without changing source colors', () => {
  for (const surface of ['#fff', '#1a192a']) for (const opacity of [0.18, 0.8, 1]) {
    for (const color of ['#0B5CBD', '#2EB6FF', '#8493a7', '#ffffff', '#000000', '#7d48d5']) {
      const boundary = chartBoundary(color, surface, opacity);
      assert.ok(contrastRatio(boundary.ink, compositeColor(color, surface, opacity)) >= 4.5);
      assert.equal(contrastRatio(boundary.ink, boundary.outer), 21);
    }
  }
});

test('black or white has sufficient contrast across the RGB range', () => {
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const color = `rgb(${r},${g},${b})`;
    assert.ok(contrastRatio(color, contrastInk(color)) >= 4.5);
  }
});
