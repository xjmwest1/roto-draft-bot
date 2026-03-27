export class IntervalPoller {
  private timeout: NodeJS.Timeout | null = null;

  constructor(private pollFunction: () => Promise<void>, private pollingInterval = 60_000) {}

  start() {
    if (this.timeout) return;
    this.poll().catch((error) => console.error('Error in initial poll:', error));
    this.timeout = setInterval(() => {
      this.poll().catch((error) => console.error('Error in polling loop:', error));
    }, this.pollingInterval);
  }

  stop() {
    if (!this.timeout) return;
    clearInterval(this.timeout);
    this.timeout = null;
  }

  private async poll() {
    await this.pollFunction();
  }
}

