import BaseChart from '../base/base-chart.js';
import ChartBaseTemplate from '../../../html/chart-base.html?raw';
import VersionDataTransformer from '../../transformers/version-data-transformer.js';

export default class PlatformStats extends BaseChart {
  _data = {};

  _title = '% Users on Platform';

  constructor() {
    super(ChartBaseTemplate);
    this.fetchData().then(() => {
      this.create();
    });
  }

  async fetchData() {
    const response = await fetch('/data/platforms.json');
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
        stacked: true,
      },
      y: {
        stacked: true,
        min: 0.0,
        max: 100.0,
      },
    };
    const tooltip = {
      callbacks: {
        label: (context) => `${context.dataset.label}: ${context.parsed.y.toFixed(2)}%`,
      },
    };

    const data = new VersionDataTransformer(this._data)
      .toChartData({ processDataToRelativePercentages: true, keyByLastData: false });
    this._createChart('bar', data, this._title, { scales, tooltip });
  }
}

customElements.define('stats-platforms', PlatformStats);
