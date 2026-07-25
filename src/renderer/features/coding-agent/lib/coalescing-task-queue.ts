export class CoalescingTaskQueue {
  private requested = false;
  private active: Promise<void> | null = null;

  constructor(private readonly task: () => Promise<void>) {}

  request(): Promise<void> {
    this.requested = true;
    if (!this.active) {
      const draining = this.drain();
      this.active = draining;
      const clearActive = (): void => {
        if (this.active === draining) this.active = null;
      };
      void draining.then(clearActive, clearActive);
    }
    return this.active;
  }

  private async drain(): Promise<void> {
    while (this.requested) {
      this.requested = false;
      await this.task();
    }
  }
}
