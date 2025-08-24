export default class RefEvent extends Event {
  constructor(data, options) {
    super('ref-event', { ...options });
    this.data = data;
  }
}
