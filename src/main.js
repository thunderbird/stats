/* eslint no-unused-vars: 0 */
// import './style.css';
import './assets/css/app.css';

// Third Party
import Chart from 'chart.js/auto';
import { Interaction, Tooltip } from 'chart.js';

import zoomPlugin from 'chartjs-plugin-zoom';
import annotationPlugin from 'chartjs-plugin-annotation';
// Auto registered
import 'chartjs-adapter-date-fns';

// Components
import './assets/js/components/index.js';

// Charts
import './assets/js/charts/index.js';
import * as components from 'chart.js';

// See: https://www.chartjs.org/chartjs-plugin-zoom/latest/
Chart.register(zoomPlugin);
// See: https://www.chartjs.org/chartjs-plugin-annotation/latest/
Chart.register(annotationPlugin);

// Ensure point borders are white
const overrideBorderColorPlugin = {
  id: 'zzz_override_border_color',
  beforeLayout: (chart, args, options) => {
    const { datasets } = chart.config.data;
    Object.keys(datasets).forEach((key) => {
      datasets[key].pointBorderColor = '#fff';
    });
  },
};

Chart.register(overrideBorderColorPlugin);

// Needs to use function in order to access `this`.
// eslint-disable-next-line func-names
Tooltip.positioners.constant = function (elements, eventPosition) {
  // A reference to the tooltip model
  const tooltip = this;
  if (!tooltip) {
    return {
      x: 0,
      y: 0,
    };
  }

  // Grab the calculated average between points
  const pos = Tooltip.positioners.average(elements);

  const tooltipWidth = tooltip.width;
  const mouseX = eventPosition.x;
  const padding = 20;

  const positionRight = mouseX < tooltipWidth + padding;

  // eslint-disable-next-line consistent-return
  return {
    // Apply padding so the tooltip isn't in the data point's face
    x: positionRight ? pos.x + padding : pos.x - padding,
    y: pos.y,
    // Where the little arrow points to
    xAlign: positionRight ? 'left' : 'right',
    yAlign: 'center',
  };
};
