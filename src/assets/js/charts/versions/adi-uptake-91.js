import ADIUptake102 from './adi-uptake-102.js';

export default class ADIUptake91 extends ADIUptake102 {
  _title = 'TB91 Uptake as % of ADI';

  _data = {};

  async fetchData() {
    const response = await fetch('/data/91uptake.json');
    this._data = await response.json();
  }
}

customElements.define('stats-uptake-adi-91', ADIUptake91);
