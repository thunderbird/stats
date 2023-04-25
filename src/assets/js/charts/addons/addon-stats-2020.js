import AddonStats from './addon-stats.js';

export default class AddonStats2020 extends AddonStats {
  _data = {};

  _title = '2020 All Addon Users as % of Total Users';

  async fetchData() {
    const response = await fetch('/data/2020_addon_stats.json');
    this._data = await response.json();
  }
}

customElements.define('stats-addons-2020', AddonStats2020);
