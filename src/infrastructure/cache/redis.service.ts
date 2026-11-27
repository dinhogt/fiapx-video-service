import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { VideoEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(APP_ENV_CONFIG) env: VideoEnv) {
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      connectTimeout: 1_000,
      retryStrategy: () => null,
      lazyConnect: false,
    });
    this.client.on('error', () => {
      // Fail-closed callers handle errors; avoid unhandled 'error' crash.
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
