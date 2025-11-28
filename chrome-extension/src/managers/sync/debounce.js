export class EventDebouncer {
  constructor(delayMs = 200) {
    this.delayMs = delayMs;
    this.timer = null;
    this.events = new Set();
  }
  add(eventType) {
    this.events.add(eventType);
  }
  schedule(fn) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
       // Clear events after callback runs (callback reads this.events directly)
       this.events.clear();
    }, this.delayMs);
  }
  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.events.clear();
  }
}
