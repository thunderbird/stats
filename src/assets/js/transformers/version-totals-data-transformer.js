/**
 * Handles the transformation of the version-style json data that's common within stats.thunderbird.net
 */
export default class VersionTotalsDataTransformer {
  constructor(data) {
    this.data = data;
  }

  /**
   * Converts raw data provided to this object, and returns an object suitable for Chart.js' data object.
   * @param options
   * @param {string?} options.totalsName
   * - Name of the totals label. Defaults to 'Total'.
   * @param {boolean?} options.includeRollingAverage
   * - Determines if we calculate a 7-day rolling average. Defaults to true.
   * @param {boolean?} options.rollingAverageName
   * - If includeRollingAverage is true, the name of the rolling average label. Defaults to '7-Day Rolling Average'.
   * @returns {{datasets: []}}
   */
  toChartData(options) {
    const {
      totalsName = 'Total',
      includeRollingAverage = true,
      rollingAverageName = '7-Day Rolling Average',
    } = options;

    // First sort the rawData
    const sortedData = Object.keys(this.data)
      .sort()
      .reduce((obj, key) => {
        // eslint-disable-next-line no-param-reassign
        obj[key] = this.data[key];
        return obj;
      }, {});

    const totals = {};
    const rollingAverage = {};
    const keys = [];
    const dateLabels = {};

    Object.keys(sortedData).forEach((date, index) => {
      keys.push(date);
      dateLabels[date] = true;
      totals[date] = sortedData[date].count;

      // Calculate simple moving average
      if (includeRollingAverage && index > 7) {
        const keys7Days = keys.slice(-7);
        const sum = keys7Days.reduce((accum, key) => accum + sortedData[key].count, 0);
        rollingAverage[date] = Math.ceil(sum / 7);
      }
    });

    const datasets = [
      {
        label: totalsName,
        data: totals,
        order: 1,
      },
    ];

    if (includeRollingAverage) {
      datasets.push({
        label: rollingAverageName,
        data: rollingAverage,
        pointStyle: 'triangle',
        order: 0,
      });
    }

    return {
      labels: Object.keys(dateLabels),
      datasets,
    };
  }
}
