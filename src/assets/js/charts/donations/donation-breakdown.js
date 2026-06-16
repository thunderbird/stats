import ChartBaseTemplate from '../../../html/chart-base.html?raw';
import BaseChart from '../base/base-chart.js';
import {
  getFinancialScalesOptions,
  getFinancialTooltipOptions,
} from '../utils/options-util.js';

export default class DonationBreakdown extends BaseChart {
  _data = {};

  constructor() {
    super(ChartBaseTemplate);

    this.fetchData().then(() => {
      this.create();
    });
  }

  async fetchData() {
    const response = await fetch('/data/financials.json');
    const json = await response.json();

    if (!('donations_yearly' in json)) {
      console.error('Could not load donations_yearly  from financials.json');
      return;
    }

    this._data = {
      yearly: json.donations_yearly,
      monthly: json.donations_monthly,
    };
  }

  /**
   * Creates the chart.js chart
   */
  create() {
    /*
     * Break down our nicely laid out json data into multiple datasets by year
     */

    // First sum up the monthly amounts into a yearly total
    const monthlyData = {};
    for (const year in this._data.monthly) {
      monthlyData[year] = Object.values(this._data.monthly[year]).reduce(
        (previousValue, currentValue) => parseInt(previousValue) + parseInt(currentValue),
        0,
      );
    }

    const financialData = {
      ...this._data.yearly,
      ...monthlyData,
    };

    const data = {
      labels: Object.keys(financialData).map((year) => year),
      datasets: [
        {
          data: Object.keys(financialData).map((year) => financialData[year]),
        },
      ],
    };

    this._createChart('bar', data, 'Donation Totals', {
      tooltip: getFinancialTooltipOptions(),
      scales: getFinancialScalesOptions(),
      legend: { display: false },
    });
  }
}

customElements.define('stats-donation-breakdown', DonationBreakdown);
