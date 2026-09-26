export const samples = [];
class Metric {
  constructor(name) { this.name = name; }
  add(value, tags) { samples.push({ name: this.name, value, tags }); }
}
export class Counter extends Metric {}
export class Rate extends Metric {}
export class Trend extends Metric {}
