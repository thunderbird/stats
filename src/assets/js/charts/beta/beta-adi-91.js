import BetaADI102 from './beta-adi-102.js';

export default class BetaADI91 extends BetaADI102 {
  _title = '92-102 Beta History';

  _data = {};

  async fetchData() {
    const response = await fetch('/data/91beta_nightly_adi.json');
    this._data = await response.json();
  }
}

customElements.define('stats-beta-adi-91', BetaADI91);
