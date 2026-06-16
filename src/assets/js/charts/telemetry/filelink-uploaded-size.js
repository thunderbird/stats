import AccountCount from './account-count.js';

export default class FilelinkUploadedSize extends AccountCount {
  _data = {};

  _title = 'tb.filelink.uploaded_size';

  async fetchData() {
    const response = await fetch('/data/telemetry.json');
    const data = await response.json();
    this._data = data['tb.filelink.uploaded_size'];
  }
}

customElements.define('stats-filelink-uploaded-size', FilelinkUploadedSize);
