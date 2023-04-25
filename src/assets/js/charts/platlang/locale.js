import PlatformStats from './platforms.js';

export default class LocaleStats extends PlatformStats {
  _data = {};

  _title = '% Users on Locale';

  async fetchData() {
    const response = await fetch('/data/locales.json');
    this._data = await response.json();
  }
}

customElements.define('stats-locale', LocaleStats);
