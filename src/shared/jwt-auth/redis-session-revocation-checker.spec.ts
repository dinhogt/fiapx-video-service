/* eslint-disable @typescript-eslint/require-await */
import { RedisSessionRevocationChecker } from './redis-session-revocation-checker';
import { SessionRevocationStoreUnavailableError } from './session-revocation';

describe('RedisSessionRevocationChecker', () => {
  it('reports revoked sids', async () => {
    const checker = new RedisSessionRevocationChecker({
      get: jest.fn(async (key: string) => (key.endsWith('sid-1') ? '1' : null)),
    });
    await expect(checker.isRevoked('sid-1')).resolves.toBe(true);
    await expect(checker.isRevoked('sid-2')).resolves.toBe(false);
  });

  it('fails closed when Redis is down', async () => {
    const checker = new RedisSessionRevocationChecker({
      get: jest.fn(async () => {
        throw new Error('down');
      }),
    });
    await expect(checker.isRevoked('sid')).rejects.toBeInstanceOf(
      SessionRevocationStoreUnavailableError,
    );
  });
});
