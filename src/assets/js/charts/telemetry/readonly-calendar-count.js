import AccountCount from './account-count.js';

export default class ReadonlyCalendarCount extends AccountCount {
  _data = {};

  _title = 'tb.calendar.read_only_calendar_count';

  async fetchData() {
    const response = await fetch('/data/telemetry.json');
    const data = await response.json();
    this._data = data['tb.calendar.read_only_calendar_count'];
  }
}

customElements.define('stats-readonly-calendar-count', ReadonlyCalendarCount);
