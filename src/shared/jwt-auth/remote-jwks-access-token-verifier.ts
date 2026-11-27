import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import {
  AccessTokenVerificationError,
  type AccessTokenVerifier,
  type VerifiedAccessToken,
} from './access-token-verifier';

export type RemoteJwksVerifierOptions = {
  jwksUrl: string;
  issuer: string;
  audience: string;
  /** JWKS HTTP cache lifetime (spec: 10 minutes). */
  cacheMaxAgeMs?: number;
  clockToleranceSeconds?: number;
};

/**
 * Verifies RS256 access tokens against a remote JWKS.
 * jose caches keys for `cacheMaxAgeMs` and refetches when a kid is unknown (after cooldown).
 */
export class RemoteJwksAccessTokenVerifier implements AccessTokenVerifier {
  private readonly getKey: JWTVerifyGetKey;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly clockToleranceSeconds: number;

  constructor(options: RemoteJwksVerifierOptions) {
    this.issuer = options.issuer;
    this.audience = options.audience;
    this.clockToleranceSeconds = options.clockToleranceSeconds ?? 30;
    this.getKey = createRemoteJWKSet(new URL(options.jwksUrl), {
      cacheMaxAge: options.cacheMaxAgeMs ?? 10 * 60 * 1000,
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    });
  }

  async verify(accessToken: string): Promise<VerifiedAccessToken> {
    try {
      const { payload } = await jwtVerify(accessToken, this.getKey, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['RS256'],
        clockTolerance: this.clockToleranceSeconds,
      });

      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new AccessTokenVerificationError('Missing sub claim');
      }
      if (typeof payload.sid !== 'string' || payload.sid.length === 0) {
        throw new AccessTokenVerificationError('Missing sid claim');
      }

      return { sub: payload.sub, sid: payload.sid };
    } catch (error: unknown) {
      if (error instanceof AccessTokenVerificationError) {
        throw error;
      }
      throw new AccessTokenVerificationError(
        error instanceof Error ? error.message : 'Access token verification failed',
      );
    }
  }
}
