import ADIUptake102 from './adi-uptake-102.js';

export default class ADIUptake60 extends ADIUptake102 {
  _title = 'TB60 Uptake as % of ADI';

  _data = {};

  async fetchData() {
    const response = await fetch('/data/60uptake.json');
    this._data = await response.json();
  }
}

customElements.define('stats-uptake-adi-60', ADIUptake60);
