import BaseChart from '../base/base-chart.js';
import ChartBaseTemplate from '../../../html/chart-base.html?raw';
import {
  getFinancialScalesOptions,
  getFinancialTooltipOptions,
} from '../utils/options-util.js';

export default class MonthlyDonations extends BaseChart {
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

    if (!('donations_monthly' in json)) {
      console.error('Could not load donations_monthly from financials.json');
      return;
    }

    this._data = json.donations_monthly;
  }

  /**
   * Get the month as a short string (e.g. '04' -> 'Apr')
   * @param month : string
   * @returns {string}
   */
  #getShortMonth(month) {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
    }).format(new Date(2000, parseInt(month) - 1));
  }

  /**
   * Processes each month's dataset by the supplied year
   * @param data : Object - The scoped json data object
   * @param year : string - The year being processed (e.g. 2023)
   * @returns {{data: {x: *, y: *}[], label}}
   */
  #processDataSet(data, year) {
    return {
      label: year,
      fill: 'origin',
      data: Object.keys(data[year]).map((month) => ({ x: this.#getShortMonth(month), y: data[year][month] })),
    };
  }

  setup(data) {
    let largestYear = '2019';

    // Find our largest year
    Object.keys(data).map((year) => {
      if (
        Object.keys(data[year]).length > Object.keys(data[largestYear]).length
      ) {
        largestYear = year;
      }
    });

    // Get the labels from our largest year
    const labels = Object.keys(data[largestYear]).map((month) => this.#getShortMonth(month));

    return {
      labels,
      datasets: Object.keys(data).map((year) => this.#processDataSet(data, year)),
    };
  }

  /**
   * Creates the chart.js chart
   */
  create() {
    const data = this.setup(this._data);

    this._createChart('line', data, 'Monthly Donations', {
      tooltip: getFinancialTooltipOptions(),
      scales: getFinancialScalesOptions(),
    });
  }
}

customElements.define('stats-monthly-donations', MonthlyDonations);
