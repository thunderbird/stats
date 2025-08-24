import AccountCount from './account-count.js';

export default class AddressbookCount extends AccountCount {
  _data = {};

  _title = 'tb.addressbook.addressbook_count';

  async fetchData() {
    const response = await fetch('/data/telemetry.json');
    const data = await response.json();
    this._data = data['tb.addressbook.addressbook_count'];
  }
}

customElements.define('stats-addressbook-count', AddressbookCount);
