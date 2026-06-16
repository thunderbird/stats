import AccountCount from './account-count.js';

export default class AccountSuccessfulEmailSetup extends AccountCount {
  _data = {};

  _title = 'tb.account.successful_email_account_setup';

  async fetchData() {
    const response = await fetch('/data/telemetry.json');
    const data = await response.json();
    this._data = data['tb.account.successful_email_account_setup'];
  }
}

customElements.define('stats-account-successful-email-setup', AccountSuccessfulEmailSetup);
