export class SharedArray extends Array {
  constructor(_name, factory) {
    super();
    this.push(...factory());
  }
}
