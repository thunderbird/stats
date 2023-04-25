import AccountCount from './account-count.js';

export default class WebsearchUsage extends AccountCount {
  _data = {};

  _title = 'tb.websearch.usage';

  async fetchData() {
    const response = await fetch('/data/telemetry.json');
    const data = await response.json();
    this._data = data['tb.websearch.usage'];
  }
}

customElements.define('stats-websearch-usage', WebsearchUsage);
