/**
 * Handles the transformation of the version-style json data that's common within stats.thunderbird.net
 */
export default class VersionDataTransformer {
  shapes = ['circle', 'rect', 'triangle', 'rectRot'];

  constructor(data) {
    this.data = data;
  }

  /**
   * Handle a specific single item case.
   * TODO: this should maybe be its own transformer
   * @param data
   * @param versionsToAllow
   * @param fillPoint
   * @param processDataToRelativePercentages
   * @returns {{datasets: [], labels: string[]}}
   */
  #singleItemChartData(data, versionsToAllow, fillPoint, processDataToRelativePercentages) {
    const datasets = {};

    const sortedVersions = Object.keys(data.versions)
      .sort((a, b) => data.versions[b] - data.versions[a]);

    sortedVersions.forEach((version) => {
      if (versionsToAllow && versionsToAllow.indexOf(version) === -1) {
        return;
      }

      datasets[version] = {
        label: version,
        data: {
          [version]: !processDataToRelativePercentages
            ? data.versions[version] : (data.versions[version] / data.count) * 100,
        },
        fill: fillPoint ? 'origin' : false,
      };
    });

    return {
      labels: sortedVersions,
      datasets: Object.values(datasets),
    };
  }

  /**
   * Converts raw data provided to this object, and returns an object suitable for Chart.js' data object.
   * @param options
   * @param {boolean?} options.processDataToRelativePercentages
   * - Determines if version counts will be processed into relative percentages. Defaults to false
   * @param {boolean?} options.keyByLastData
   * - Determines if we should filter out versions not included in last data point's version list. Defaults to false
   * @param {boolean?} options.fillPoint
   * - Should we fill the background up to this point. Defaults to false
   * @param {boolean?} options.lastDataPointOnly
   * - Each dataset only contains the last available data point (after sorting.) Defaults to false.
   * @returns {{datasets: []}}
   */
  toChartData(options) {
    const {
      processDataToRelativePercentages = false,
      keyByLastData = false,
      fillPoint = false,
      lastDataPointOnly = false,
    } = options;

    // First sort the rawData
    const sortedData = Object.keys(this.data)
      .sort()
      .reduce((obj, key) => {
        // eslint-disable-next-line no-param-reassign
        obj[key] = this.data[key];
        return obj;
      }, {});

    // Grab the last day, so we can retrieve the version allow list. (If they request one.)
    const lastKey = Object.keys(sortedData).at(-1);
    const versionsToAllow = keyByLastData ? Object.keys(sortedData[lastKey].versions) : null;

    const datasets = {};
    const dateLabels = {};

    if (lastDataPointOnly) {
      return this.#singleItemChartData(
        sortedData[lastKey],
        versionsToAllow,
        fillPoint,
        processDataToRelativePercentages,
      );
    }

    /*
     * Format: { "02-02-2023": { count: 10, versions: { "102.0": 5", "111.0": 5 } }, ... }
     */
    let shapeIndex = 0;
    Object.keys(sortedData).forEach((date) => {
      const item = lastDataPointOnly ? sortedData[lastKey] : sortedData[date];

      Object.keys(item.versions).forEach((version) => {
        if (versionsToAllow && versionsToAllow.indexOf(version) === -1) {
          return;
        }

        if (!datasets[version]) {
          datasets[version] = {
            label: version,
            data: {},
            fill: fillPoint ? 'origin' : false,
            pointStyle: this.shapes[shapeIndex],
          };
        }

        shapeIndex += 1;
        if (shapeIndex >= this.shapes.length) {
          shapeIndex = 0;
        }

        dateLabels[date] = true;

        datasets[version].data[date] = !processDataToRelativePercentages
          ? item.versions[version] : (item.versions[version] / item.count) * 100;
      });
    });

    // Re-order the datasets so the last entry is on top
    let order = Object.keys(datasets).length;
    const reOrderedDataSets = Object.keys(datasets).map((date) => {
      const data = {
        ...datasets[date],
        order,
      };
      order -= 1;

      return data;
    });

    return {
      labels: Object.keys(dateLabels),
      datasets: reOrderedDataSets,
    };
  }
}
