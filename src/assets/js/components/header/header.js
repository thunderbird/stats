import templateHtml from '../../../html/header.html?raw';

export default class Header extends HTMLElement {
  constructor() {
    super();

    this._template = document.createElement('template');
    this._template.innerHTML = templateHtml;

    this._shadowRoot = this.attachShadow({ mode: 'closed' });
    this._shadowRoot.appendChild(this._template.content);

    this.headerLinks = {
      addons: this._shadowRoot.getElementById('addons'),
      ami: this._shadowRoot.getElementById('ami'),
      adi: this._shadowRoot.getElementById('adi'),
      beta: this._shadowRoot.getElementById('beta'),
      financials: this._shadowRoot.getElementById('financials'),
      platlang: this._shadowRoot.getElementById('platlang'),
      telemetry: this._shadowRoot.getElementById('telemetry'),
      version: this._shadowRoot.getElementById('version'),
    };

    const page = window.document.documentElement.dataset?.page ?? null;
    const activeLink = this.headerLinks[page] ?? null;

    if (activeLink) {
      activeLink.classList.add('active');
    }
  }
}

customElements.define('stats-header', Header);
