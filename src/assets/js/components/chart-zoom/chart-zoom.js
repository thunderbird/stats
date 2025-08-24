import ChartZoomOption from './option/chart-zoom-option.js';
import SlotRefProvider from '../../providers/slot-ref-provider.js';
import ButtonStateEvent from '../../events/button-state-event.js';

/**
 *  Chart Zoom Controls
 *  This component creates a button with an event handler per option passed in setup.
 *
 *  NOTE: There's a bug where ChartZoom plugin won't work unless you include labels along-side the dataset...
 *  See: https://github.com/chartjs/chartjs-plugin-zoom/issues/728
 *  & https://stackoverflow.com/questions/75382787/chart-js-zoom-instantly-zooms-in-fully-on-first-point-no-matter-what-type-of-zoo/75387958#75387958
 */
export default class ChartZoom extends HTMLElement {
  buttons = [];

  constructor() {
    super();
    const shadowRoot = this.attachShadow({ mode: 'closed' });
    const template = document.createElement('template');
    const slot = document.createElement('slot');
    template.content.append(slot);
    shadowRoot.append(template.content);

    this.addEventListener('ref-event', (evt) => {
      if (evt.target !== this) {
        return;
      }
      // Data comes in as { [slot]: [ ...elements ], [slot2]: [ ...elements] }
      this.buttons = Object.values(evt.data).flat();
    }, true);

    /**
     * @param evt : ButtonStateEvent
     */
    this.addEventListener('button-state-event', (evt) => {
      const isSelected = evt.state === 'selected';
      const target = evt.element;

      if (!isSelected) {
        return;
      }

      this.unselect(target);
    });

    this.slotDataProvider = new SlotRefProvider(this, ChartZoomOption, [slot]);
  }

  selectByLabel(label) {
    for (const element of this.buttons) {
      if (label === element.label) {
        element.dispatchEvent(new ButtonStateEvent('active', {}, {}));
        break;
      }
    }
  }

  unselect(target = null) {
    this.buttons.forEach((element) => {
      if (target !== element) {
        // Turn off all the other buttons
        element.dispatchEvent(new ButtonStateEvent('inactive', {}, {}));
      }
    });
  }
}

customElements.define('chart-zoom', ChartZoom);
