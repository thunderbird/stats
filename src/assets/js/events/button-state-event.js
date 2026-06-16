export default class ButtonStateEvent extends Event {
  constructor(state, elementInfo = {}, options = {}) {
    super('button-state-event', { ...options });
    this.state = state;

    // Optional hints for various components, but messy tbh
    const { element, elementText } = elementInfo;
    this.elementText = elementText;
    this.element = element;
  }
}
