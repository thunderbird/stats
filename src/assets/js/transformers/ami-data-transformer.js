/**
 * Handles the transformation of the ami json data (this one is very specific)
 */
export default class AmiDataTransformer {
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

    const ami = Object.keys(sortedData).reduce((obj, key) => {
      // eslint-disable-next-line no-param-reassign
      obj[key] = sortedData[key].ami / sortedData[key]['78'];
      return obj;
    }, {});

    const datasets = [
      {
        label: 'AMI',
        data: ami,
        fill: 'origin',
      },
    ];

    return {
      datasets,
    };
  }
}
