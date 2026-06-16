import { sub } from 'date-fns';
import BaseChart from '../base/base-chart.js';
import ChartBaseTemplate from '../../../html/chart-base.html?raw';
import VersionTotalsDataTransformer from '../../transformers/version-totals-data-transformer.js';

export default class ADI extends BaseChart {
  _data = {};

  _title = 'Daily Active Installations for Release channel';

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
    const response = await fetch('/data/thunderbird_adi.json');
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
    };

    const data = new VersionTotalsDataTransformer(this._data).toChartData({});
    this._createChart('line', data, this._title, { scales, tooltip });
  }
}

customElements.define('stats-adi', ADI);
