import BaseChart from '../base/base-chart.js';
import ChartBaseTemplate from '../../../html/chart-base.html?raw';
import AddonDataTransformer from '../../transformers/addon-data-transformer.js';

export default class AddonStats extends BaseChart {
  _data = {};

  _title = 'All Addon Users as % of Total Users';

  constructor() {
    super(ChartBaseTemplate);
    this.fetchData().then(() => {
      this.create();
    });
  }

  async fetchData() {
    const response = await fetch('/data/addon_stats.json');
    this._data = await response.json();
  }

  /**
   * Creates the chart.js chart
   */
  create() {
    const scales = {
      x: {
        type: 'time',
        time: {
          tooltipFormat: 'MMMM do yyyy',
        },
      },
      y: {
        min: 0.0,
        max: 100.0,
      },
    };
    const tooltip = {
      // We want descending
      itemSort: (a, b) => b.parsed.y - a.parsed.y,
      intersect: false,
      callbacks: {
        label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(2)}%`,
      },
    };

    const data = new AddonDataTransformer(this._data).toChartData();
    this._createChart('line', data, this._title, { scales, tooltip });
  }
}

customElements.define('stats-addons', AddonStats);
