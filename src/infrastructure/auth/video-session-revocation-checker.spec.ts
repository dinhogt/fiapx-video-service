/* eslint-disable @typescript-eslint/require-await */
import { VideoSessionRevocationChecker } from './video-session-revocation-checker';
import { SessionRevocationStoreUnavailableError } from '../../shared/jwt-auth';
import type { RedisService } from '../cache/redis.service';

describe('VideoSessionRevocationChecker', () => {
  it('delegates to Redis revoked:sid keys', async () => {
    const redis = {
      client: {
        get: jest.fn(async (key: string) => (key === 'revoked:sid:s1' ? '1' : null)),
      },
    } as unknown as RedisService;
    const checker = new VideoSessionRevocationChecker(redis);
    await expect(checker.isRevoked('s1')).resolves.toBe(true);
    await expect(checker.isRevoked('s2')).resolves.toBe(false);
  });

  it('fails closed when Redis errors', async () => {
    const redis = {
      client: {
        get: jest.fn(async () => {
          throw new Error('down');
        }),
      },
    } as unknown as RedisService;
    const checker = new VideoSessionRevocationChecker(redis);
    await expect(checker.isRevoked('s1')).rejects.toBeInstanceOf(
      SessionRevocationStoreUnavailableError,
    );
  });
});
