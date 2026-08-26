export class Semaphore {
  #available: number;
  readonly #queue: Array<() => void> = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Semaphore limit must be positive");
    this.#available = limit;
  }

  async use<T>(operation: () => Promise<T>): Promise<T> {
    await this.#acquire();
    try {
      return await operation();
    } finally {
      this.#release();
    }
  }

  async #acquire(): Promise<void> {
    if (this.#available > 0) {
      this.#available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.#queue.push(resolve));
  }

  #release(): void {
    const next = this.#queue.shift();
    if (next) next();
    else this.#available += 1;
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let handle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}
