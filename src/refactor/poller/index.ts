class Poller {
  private timeout: NodeJS.Timeout | null = null

  constructor(
    private pollFunction: () => Promise<void>,
    private pollingInterval = 60_000,
  ) {}

  start() {
    if (this.timeout) {
      return
    }

    console.log(`Starting draft poller at ${this.pollingInterval} interval`)

    this.poll().catch((error) => {
      console.error('Error in initial poll:', error)
    });

    this.timeout = setInterval(() => {
      this.poll().catch((error) => {
        console.error('Error in polling loop:', error)
      });
    }, this.pollingInterval)
  }

  stop() {
    if (!this.timeout) {
      return
    }

    clearInterval(this.timeout)
    this.timeout = null
    console.log('Poller stopped')
  }

  private async poll() {
    console.log('Polling...')
    await this.pollFunction()
    console.log('Finished polling')
  }
}

export {
  Poller,
}