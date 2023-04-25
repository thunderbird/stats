import AccountCount from './account-count.js';

export default class CalendarCount extends AccountCount {
  _data = {};

  _title = 'tb.calendar.calendar_count';

  async fetchData() {
    const response = await fetch('/data/telemetry.json');
    const data = await response.json();
    this._data = data['tb.calendar.calendar_count'];
  }
}

customElements.define('stats-calendar-count', CalendarCount);
