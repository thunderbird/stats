import RefEvent from '../events/ref-event.js';

export default class SlotRefProvider {
  targets = {};

  /**
   * @param self : Object - Object to send data back to
   * @param targetNodeClass : constructor - Constructor of class to test (e.g. DataTable, or ChartZoomOption)
   * @param slots : HTMLSlotElement[]
   */
  constructor(self, targetNodeClass, slots) {
    this.self = self;
    this.targetNodeClass = targetNodeClass;
    this.slots = slots;

    this.slots.forEach((slot) => {
      slot.addEventListener('slotchange', (evt) => this._onSlotChange(evt, slot), true);
    });
  }

  /**
   * Send the data event to each target
   * @param data
   * @private
   */
  _sendDataEvent(data) {
    this.self.dispatchEvent(new RefEvent(data, { bubbles: true }));
  }

  /**
   * Slot HTML has changed, grab a list of new targets
   * @param evt : Event
   * @param slot : HTMLSlotElement
   * @private
   */
  _onSlotChange(evt, slot) {
    if (!(slot in this.targets)) {
      this.targets[slot] = [];
    }

    slot.assignedElements().forEach((element) => {
      if (element instanceof this.targetNodeClass) {
        this.targets[slot].push(element);
      }
    });

    if (this.targets[slot].length > 0) {
      this._sendDataEvent(this.targets);
    }
  }
}
