import BetaADI102 from './beta-adi-102.js';

export default class BetaADI78 extends BetaADI102 {
  _title = '79-91 Beta History';

  _data = {};

  async fetchData() {
    const response = await fetch('/data/78beta_nightly_adi.json');
    this._data = await response.json();
  }
}

customElements.define('stats-beta-adi-78', BetaADI78);
