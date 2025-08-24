import templateHtml from '../../../html/data-table.html?raw';

export default class DataTable extends HTMLElement {
  title = '';

  header = {};

  data = [];

  template = '';

  tableData = [];

  perPage = 10;

  page = 1;

  constructor() {
    super();

    this._template = document.createElement('template');
    this._template.innerHTML = templateHtml;

    this._shadowRoot = this.attachShadow({ mode: 'open' });
    this._shadowRoot.appendChild(this._template.content);

    this._title = this._shadowRoot.getElementById('title');
    this._tableHead = this._shadowRoot.getElementById('table-head');
    this._tableBody = this._shadowRoot.getElementById('table-body');
    this._pagination = this._shadowRoot.getElementById('pagination');
    this._search = this._shadowRoot.getElementById('search');
    this._search.addEventListener('input', (evt) => this.onSearch(evt, this.data));
    this._pagination.addEventListener('pageChange', (evt) => this.onPageChange(evt, this.data));

    this.addEventListener('data-event', (evt) => {
      this.setup(evt.data);
    }, true);
  }

  static get observedAttributes() {
    return ['title', 'header'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    const processedValue = name === 'header' ? JSON.parse(newValue) : newValue;

    if (name === 'header') {
      this.buildTableHeader(processedValue);
    } else if (name === 'title') {
      this._title.innerText = processedValue;
    }

    this[name] = processedValue;
  }

  /**
   *
   * @param evt : InputEvent
   * @param data
   */
  onSearch(evt, data) {
    const filter = evt.target.value;
    const filtered = Object.keys(this.data)
      .filter((key) => key.indexOf(filter) !== -1)
      .reduce((obj, key) => {
        // eslint-disable-next-line no-param-reassign
        obj[key] = data[key];
        return obj;
      }, {});

    this.buildTableBody(filtered);
    this.render();
  }

  /**
   *
   * @param evt : CustomEvent
   * @param data
   */
  onPageChange(evt, data) {
    this.page = evt.detail.index + 1;

    // Only support the first dataset for now...
    this.buildTableBody(data);
    this.render();
  }

  setup(options) {
    const { datasets } = options;
    const { data } = datasets[0];

    this.data = data;

    // Only support the first dataset for now...
    this.buildTableBody(data);
    this.render();
  }

  buildTableHeader(header) {
    this._tableHead.innerHTML = '';

    const dateHeader = document.createElement('th');
    const countHeader = document.createElement('th');

    dateHeader.innerText = header.date;
    countHeader.innerText = header.count;

    this._tableHead.append(dateHeader);
    this._tableHead.append(countHeader);
  }

  buildTableBody(data) {
    this.tableData = [];

    const startIndex = (this.page - 1) * this.perPage;
    const pages = Math.ceil(Object.entries(data).length / this.perPage);

    this._pagination.setup({ pages, page: this.page });

    Object.entries(data)
      .slice(startIndex, startIndex + this.perPage)
      .forEach(([date, count]) => {
        const row = document.createElement('tr');
        const dateCol = document.createElement('td');
        const countCol = document.createElement('td');

        dateCol.innerText = date;
        countCol.innerText = count;

        row.append(dateCol, countCol);
        this.tableData.push(row);
      });
  }

  render() {
    this._tableBody.innerHTML = '';
    this._tableBody.append(...this.tableData);
  }
}

customElements.define('data-table', DataTable);
