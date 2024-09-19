import { sub } from 'date-fns';
import ChartBaseTemplate from '../../../html/chart-base.html?raw';
import BaseChart from '../base/base-chart.js';
import VersionDataTransformer from '../../transformers/version-data-transformer.js';

export default class BetaADI102 extends BaseChart {
  _data = {};

  _title = 'Active Beta and Nightly Installations after 102';

  constructor() {
    super(ChartBaseTemplate);

    this.fetchData().then(() => {
      this.create();
    });
  }

  #getDate(timestamp, modifier) {
    return sub(new Date(timestamp), { months: modifier }).valueOf();
  }

  async fetchData() {
    const response = await fetch('/data/beta_nightly_adi.json');
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
    };
    const tooltip = {
      intersect: false,
    };

    const data = new VersionDataTransformer(this._data).toChartData({ keyByLastData: true });
    this._createChart('line', data, this._title, { scales, tooltip });
  }
}

customElements.define('stats-beta-adi-102', BetaADI102);
