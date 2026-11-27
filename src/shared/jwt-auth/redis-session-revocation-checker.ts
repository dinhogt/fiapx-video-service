import {
  SessionRevocationStoreUnavailableError,
  type SessionRevocationChecker,
} from './session-revocation';

export type RedisGetClient = {
  get(key: string): Promise<string | null>;
};

/** Reads `revoked:sid:{sid}` from Redis; failures are fail-closed (503 via the guard). */
export class RedisSessionRevocationChecker implements SessionRevocationChecker {
  constructor(private readonly redis: RedisGetClient) {}

  async isRevoked(sid: string): Promise<boolean> {
    try {
      const value = await this.redis.get(`revoked:sid:${sid}`);
      return value !== null;
    } catch (error: unknown) {
      throw new SessionRevocationStoreUnavailableError(
        error instanceof Error ? error.message : 'Redis unavailable',
      );
    }
  }
}
