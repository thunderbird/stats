export default class DataEvent extends Event {
  constructor(data, options) {
    super('data-event', { ...options });
    this.data = data;
  }
}
