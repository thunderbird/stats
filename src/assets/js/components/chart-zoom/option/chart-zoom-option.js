import { buttonStyle } from '../../../utils/style-imports.js';
import ButtonStateEvent from '../../../events/button-state-event.js';

/**
 * Chart Zoom Option
 * This is placed within <chart-zoom> elements to add filtering options for a given chart
 * @property start : number - Start position
 * @property end : number - End Position
 * @property scale : relative|absolute - Whether the start and end properties are treated as relative values, or absolute values
 */
export default class ChartZoomOption extends HTMLElement {
  start = 0;

  end = 0;

  scale = 'relative';

  reset = false;

  selected = false;

  constructor() {
    super();

    this.label = this.innerText;
    this.button = document.createElement('button');
    this.button.classList.add('button');
    this.button.innerText = this.label;
    this.button.onclick = () => {
      this.select();
    };
    const shadowRoot = this.attachShadow({ mode: 'open' });
    shadowRoot.append(this.button);
    shadowRoot.append(buttonStyle());

    this.addEventListener('button-state-event', (evt) => {
      if (evt.state === 'inactive') {
        this.unselect();
      } else if (evt.state === 'active') {
        this.select();
      }
    });
  }

  select() {
    this.button.classList.add('button-selected');
    this.selected = true;
    this.dispatchEvent(new ButtonStateEvent('selected', { element: this }, { bubbles: true }));

    const detail = this.reset
      ? { reset: true }
      : {
        scale: this.scale,
        start: this.start,
        end: this.end,
      };

    this.dispatchEvent(
      new CustomEvent('filter', {
        bubbles: true,
        detail,
      }),
    );
  }

  unselect() {
    this.button.classList.remove('button-selected');
    this.selected = false;
  }

  static get observedAttributes() {
    return ['start', 'end', 'scale', 'reset'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === 'end' && newValue === '_current') {
      newValue = -1;
    }

    if (name === 'reset') {
      this.reset = true;
    } else {
      this[name] = newValue;
    }
  }
}

customElements.define('chart-zoom-option', ChartZoomOption);
