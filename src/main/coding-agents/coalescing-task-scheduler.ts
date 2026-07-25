type ScheduledTaskState = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
};

export class CoalescingTaskScheduler<Key> {
  private readonly states = new Map<Key, ScheduledTaskState>();

  constructor(
    private readonly delayMs: number,
    private readonly task: (key: Key) => Promise<void>,
  ) {}

  request(key: Key): void {
    const state = this.states.get(key) ?? {
      timer: null,
      running: false,
      pending: false,
    };
    state.pending = true;
    this.states.set(key, state);
    this.arm(key, state);
  }

  clear(): void {
    for (const state of this.states.values()) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      state.pending = false;
    }
    this.states.clear();
  }

  private arm(key: Key, state: ScheduledTaskState): void {
    if (state.timer || state.running || !state.pending) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.run(key, state);
    }, this.delayMs);
  }

  private async run(key: Key, state: ScheduledTaskState): Promise<void> {
    if (state.running || !state.pending) return;
    state.pending = false;
    state.running = true;
    try {
      await this.task(key);
    } finally {
      state.running = false;
      if (state.pending) {
        this.arm(key, state);
      } else if (!state.timer && this.states.get(key) === state) {
        this.states.delete(key);
      }
    }
  }
}
