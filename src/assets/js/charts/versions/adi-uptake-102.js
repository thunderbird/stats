import BaseChart from '../base/base-chart.js';
import ChartBaseTemplate from '../../../html/chart-base.html?raw';
import VersionDataTransformer from '../../transformers/version-data-transformer.js';

export default class ADIUptake102 extends BaseChart {
  _data = {};

  _title = 'TB102 Uptake as % of ADI';

  constructor() {
    super(ChartBaseTemplate);
    this.fetchData().then(() => {
      this.create();
    });
  }

  async fetchData() {
    const response = await fetch('/data/102uptake.json');
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
        y: {
          min: 0,
        },
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

    // const data = this._process(this._data);
    const data = new VersionDataTransformer(this._data)
      .toChartData({ processDataToRelativePercentages: true, keyByLastData: true, fillPoint: true });
    this._createChart('line', data, this._title, { scales, tooltip });
  }
}

customElements.define('stats-uptake-adi-102', ADIUptake102);
