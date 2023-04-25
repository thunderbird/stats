import { buttonStyle } from '../../utils/style-imports.js';

export default class Pagination extends HTMLElement {
  data = [];

  template = '';

  paginationData = [];

  page = 1;

  constructor() {
    super();

    this.template = document.createElement('template');
    const list = document.createElement('ul');
    list.style = 'display: flex; list-style: none;';
    list.id = 'list';
    this.template.content.append(list);
    this.template.content.append(buttonStyle());

    this._shadowRoot = this.attachShadow({ mode: 'closed' });
    this._shadowRoot.appendChild(this.template.content);

    this._list = this._shadowRoot.getElementById('list');
  }

  #createPageButton(index) {
    const button = document.createElement('button');
    button.innerText = `${index + 1}`;
    button.classList.add('button');
    button.addEventListener('click', () => this.dispatchEvent(
      new CustomEvent('pageChange', { detail: { index } }),
    ));

    const listItem = document.createElement('li');
    listItem.append(button);

    return listItem;
  }

  setup(options) {
    const { pages, page } = options;

    this.paginationData = [];

    if (page) {
      this.page = page;
    }

    const maxLength = 6;
    const start = this.page > maxLength ? this.page - maxLength / 2 : 0;
    const end = pages < maxLength ? pages : start + maxLength;

    if (start !== 0) {
      this.paginationData.push(this.#createPageButton(0));
      const sep = document.createElement('li');
      sep.innerText = '...';
      this.paginationData.push(sep);
    }

    for (let i = start; i < end; i += 1) {
      this.paginationData.push(this.#createPageButton(i));
    }

    if (end !== pages) {
      const sep = document.createElement('li');
      sep.innerText = '...';
      this.paginationData.push(sep);
      this.paginationData.push(this.#createPageButton(pages));
    }

    this.render();
  }

  render() {
    this._list.innerHTML = '';
    this._list.append(...this.paginationData);
  }
}

customElements.define('data-pagination', Pagination);
