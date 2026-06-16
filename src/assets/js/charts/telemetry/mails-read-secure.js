import AccountCount from './account-count.js';

export default class MailsReadSecure extends AccountCount {
  _data = {};

  _title = 'tb.mails.read_secure';

  async fetchData() {
    const response = await fetch('/data/telemetry.json');
    const data = await response.json();
    this._data = data['tb.mails.read_secure'];
  }
}

customElements.define('stats-mails-read-secure', MailsReadSecure);
