import { Inject, Injectable } from '@nestjs/common';
import {
  RemoteJwksAccessTokenVerifier,
  type AccessTokenVerifier,
  type VerifiedAccessToken,
} from '../../shared/jwt-auth';
import type { VideoEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';

@Injectable()
export class VideoAccessTokenVerifier implements AccessTokenVerifier {
  private readonly inner: RemoteJwksAccessTokenVerifier;

  constructor(@Inject(APP_ENV_CONFIG) env: VideoEnv) {
    this.inner = new RemoteJwksAccessTokenVerifier({
      jwksUrl: env.JWKS_URL,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      cacheMaxAgeMs: 10 * 60 * 1000,
      clockToleranceSeconds: 30,
    });
  }

  verify(accessToken: string): Promise<VerifiedAccessToken> {
    return this.inner.verify(accessToken);
  }
}
