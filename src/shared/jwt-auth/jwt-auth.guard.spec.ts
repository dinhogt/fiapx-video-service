/* eslint-disable @typescript-eslint/require-await */
import { Reflector } from '@nestjs/core';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AccessTokenVerificationError } from './access-token-verifier';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SessionRevocationStoreUnavailableError } from './session-revocation';

function makeContext(headers: Record<string, string> = {}, isPublic = false) {
  const req = { headers, user: undefined as undefined | { sub: string; sid: string } };
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => (key === IS_PUBLIC_KEY ? isPublic : false)),
  } as unknown as Reflector;
  return {
    req,
    reflector,
    context: {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => req }),
    },
  };
}

describe('JwtAuthGuard (shared lib on video-service)', () => {
  it('allows public routes and rejects missing/invalid/revoked tokens', async () => {
    const publicCtx = makeContext({}, true);
    const publicGuard = new JwtAuthGuard(
      publicCtx.reflector,
      { verify: jest.fn() },
      { isRevoked: jest.fn() },
    );
    await expect(publicGuard.canActivate(publicCtx.context as never)).resolves.toBe(true);

    const missing = makeContext({});
    const missingGuard = new JwtAuthGuard(
      missing.reflector,
      { verify: jest.fn() },
      { isRevoked: jest.fn() },
    );
    await expect(missingGuard.canActivate(missing.context as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const invalid = makeContext({ authorization: 'Bearer bad' });
    const invalidGuard = new JwtAuthGuard(
      invalid.reflector,
      {
        verify: jest.fn(async () => {
          throw new AccessTokenVerificationError();
        }),
      },
      { isRevoked: jest.fn() },
    );
    await expect(invalidGuard.canActivate(invalid.context as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const revoked = makeContext({ authorization: 'Bearer good' });
    const revokedGuard = new JwtAuthGuard(
      revoked.reflector,
      { verify: jest.fn(async () => ({ sub: 'u1', sid: 's1' })) },
      { isRevoked: jest.fn(async () => true) },
    );
    await expect(revokedGuard.canActivate(revoked.context as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns 503 when Redis revocation lookup fails', async () => {
    const { reflector, context } = makeContext({ authorization: 'Bearer good' });
    const guard = new JwtAuthGuard(
      reflector,
      { verify: jest.fn(async () => ({ sub: 'u1', sid: 's1' })) },
      {
        isRevoked: jest.fn(async () => {
          throw new SessionRevocationStoreUnavailableError();
        }),
      },
    );
    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
