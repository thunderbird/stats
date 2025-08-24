import BaseChart from '../base/base-chart.js';
import ChartBaseTemplate from '../../../html/chart-base.html?raw';
import VersionDataTransformer from '../../transformers/version-data-transformer.js';

export default class AccountCount extends BaseChart {
  _data = {};

  _title = 'tb.account.count';

  _log = false;

  constructor() {
    super(ChartBaseTemplate);
    this.fetchData().then(() => {
      this.create();
    });
  }

  static get observedAttributes() {
    return ['log'];
  }

  attributeChangedCallback(name) {
    if (name !== 'log') {
      return;
    }
    this._log = true;
  }

  async fetchData() {
    const response = await fetch('/data/telemetry.json');
    const data = await response.json();
    this._data = data['tb.account.count'];
  }

  setupLinear() {
    return {
      x: {
        type: 'time',
        time: {
          tooltipFormat: 'MMMM do yyyy',
        },
        stacked: true,
      },
      y: {
        type: 'linear',
        min: 1,
        stacked: true,
      },
    };
  }

  setupLog() {
    return {
      x: {
        type: 'category',
        ticks: {
          display: true,
          padding: 0,
        },
        grid: {
          tickWidth: 0,
        },
      },
      y: {
        type: 'logarithmic',
        position: 'left',
      },
    };
  }

  dataOptionsLog() {
    return {
      bar: {
        barPercentage: 1,
        categoryPercentage: 0,
        barThickness: 20,
        grouped: false,

      },
    };
  }

  /**
   * Creates the chart.js chart
   */
  create() {
    const scales = this._log ? this.setupLog() : this.setupLinear();
    const datasetOptions = this._log ? this.dataOptionsLog() : {};

    const title = this._log ? `Users by ${this._title} for latest week in log scale` : `Weekly users by ${this._title}`;

    const data = new VersionDataTransformer(this._data)
      .toChartData({ processDataToRelativePercentages: false, keyByLastData: true, lastDataPointOnly: this._log });
    this._createChart('bar', data, title, { scales, datasetOptions });
  }
}

customElements.define('stats-account-count', AccountCount);
