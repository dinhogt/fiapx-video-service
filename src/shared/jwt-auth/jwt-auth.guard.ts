import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  AccessTokenVerificationError,
  type AccessTokenVerifier,
} from './access-token-verifier';
import { IS_PUBLIC_KEY } from './public.decorator';
import {
  SessionRevocationStoreUnavailableError,
  type SessionRevocationChecker,
} from './session-revocation';
import { JWT_AUTH_REVOCATION, JWT_AUTH_VERIFIER } from './tokens';

export type AuthenticatedRequest = Request & {
  user?: { sub: string; sid: string };
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(JWT_AUTH_VERIFIER) private readonly verifier: AccessTokenVerifier,
    @Inject(JWT_AUTH_REVOCATION) private readonly revocation: SessionRevocationChecker,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token ausente ou inválido.');
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0) {
      throw new UnauthorizedException('Token ausente ou inválido.');
    }

    let verified: { sub: string; sid: string };
    try {
      verified = await this.verifier.verify(token);
    } catch (error: unknown) {
      if (error instanceof AccessTokenVerificationError) {
        throw new UnauthorizedException('Token ausente ou inválido.');
      }
      throw error;
    }

    try {
      const revoked = await this.revocation.isRevoked(verified.sid);
      if (revoked) {
        throw new UnauthorizedException('Sessão inválida.');
      }
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      if (error instanceof SessionRevocationStoreUnavailableError) {
        throw new ServiceUnavailableException(
          'Serviço de autenticação temporariamente indisponível.',
        );
      }
      throw error;
    }

    req.user = verified;
    return true;
  }
}
