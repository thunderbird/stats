import BaseChart from '../base/base-chart.js';
import ChartBaseTemplate from '../../../html/chart-base.html?raw';

export default class ExpenseBreakdown extends BaseChart {
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

    if (!('spending' in json)) {
      console.error('Could not load spending from financials.json');
      return;
    }

    this._data = json.spending;
  }

  /**
   * Creates the chart.js chart
   */
  create() {
    /*
     * Break down our nicely laid out json data into multiple datasets by year
     */
    const financialData = this._data[0].data;
    const data = {
      labels: financialData.map((expense) => expense.name),
      datasets: [
        {
          data: this._data[0].data.map((expense) => expense.y),
        },
      ],
    };
    const tooltip = {
      intersect: true,
      callbacks: {
        label: (context) => {
          const yValue = context.parsed;
          return `${yValue}%`;
        },
      },
    };
    const interaction = {
      intersect: true,
    };

    this._createChart('pie', data, 'Expenses Breakdown', { tooltip, interaction });
  }
}

customElements.define('stats-expenses-breakdown', ExpenseBreakdown);
