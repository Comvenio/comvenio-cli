import IORedis from "ioredis";

import { RedisFairUseStore } from "./fair-use.ts";

function validateRedisUrl(value: string): string {
  const url = new URL(value);
  if (!(["redis:", "rediss:"] as string[]).includes(url.protocol) || !url.hostname || url.hash) {
    throw new Error("Die Redis-Verbindungsadresse ist ungültig.");
  }
  return value;
}

export class RedisPlatformConnections {
  readonly producer: IORedis;
  readonly worker: IORedis;
  readonly fair_use: RedisFairUseStore;

  constructor(redisUrl: string) {
    const url = validateRedisUrl(redisUrl);
    this.producer = new IORedis(url, {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.worker = new IORedis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
    this.fair_use = new RedisFairUseStore(this.producer);
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.producer.quit(), this.worker.quit()]);
  }
}
