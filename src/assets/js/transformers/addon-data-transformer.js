/**
 * Handles the transformation of the addon related json data
 */
export default class AddonDataTransformer {
  constructor(data) {
    this.data = data;
  }

  /**
   * Converts raw data provided to this object, and returns an object suitable for Chart.js' data object.
   */
  toChartData() {

    // First sort the rawData
    const sortedData = Object.keys(this.data)
      .sort()
      .reduce((obj, key) => {
        // eslint-disable-next-line no-param-reassign
        obj[key] = this.data[key];
        return obj;
      }, {});

    const totalUserData = {};
    const minusTop10Data = {};

    Object.keys(sortedData).forEach((date) => {
      const item = sortedData[date];
      totalUserData[date] = (item.addon_count / item.total) * 100;
      minusTop10Data[date] = (item.minustop10_count / item.total) * 100;
    });

    const datasets = [
      {
        label: 'User % of Total',
        data: totalUserData,
        fill: 'origin',
      },
      {
        label: 'User % Except Top10 Add-ons',
        data: minusTop10Data,
        fill: 'origin',
      },
    ];

    return {
      datasets,
    };
  }
}
