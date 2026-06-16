import DataEvent from '../events/data-event.js';

export default class SlotDataProvider {
  targets = {};

  storedData = {};

  /**
   *
   * @param targetNodeClass : constructor - Constructor of class to test (e.g. DataTable, or ChartZoomOption)
   * @param slots : HTMLSlotElement[]
   */
  constructor(targetNodeClass, slots) {
    this.targetNodeClass = targetNodeClass;
    this.slots = slots;

    this.slots.forEach((slot) => {
      slot.addEventListener('slotchange', (evt) => this._onSlotChange(evt, slot), true);
    });
  }

  /**
   * Send a data update
   *
   * If the slot targets aren't loaded, we hold onto the data
   * and the _onSlotChange function will trigger the DataEvents when it's ready.
   * @param data
   */
  update(data) {
    this.storedData = data;

    if (Object.keys(this.targets).length > 0) {
      this._sendDataEvent(data);
    }
  }

  /**
   * Send the data event to each target
   * @param data
   * @private
   */
  _sendDataEvent(data) {
    Object.values(this.targets).forEach((targets) => {
      targets.forEach((element) => {
        element.dispatchEvent(new DataEvent(data));
      });
    });
  }

  /**
   * Slot HTML has changed, grab a list of new targets
   * @param evt : Event
   * @param slot : HTMLSlotElement
   * @private
   */
  _onSlotChange(evt, slot) {
    this.targets[slot] = [];

    slot.assignedElements().forEach((element) => {
      if (element instanceof this.targetNodeClass) {
        this.targets[slot].push(element);
      }
    });

    if (Object.keys(this.storedData).length > 0) {
      this._sendDataEvent(this.storedData);
    }
  }
}
