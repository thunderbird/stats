import BetaADI102 from './beta-adi-102.js';

export default class BetaADI68 extends BetaADI102 {
  _title = '69-78 Beta History';

  _data = {};

  async fetchData() {
    const response = await fetch('/data/68beta_nightly_adi.json');
    this._data = await response.json();
  }
}

customElements.define('stats-beta-adi-68', BetaADI68);
