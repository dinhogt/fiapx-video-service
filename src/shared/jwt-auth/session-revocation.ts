export class SessionRevocationStoreUnavailableError extends Error {
  constructor(message = 'Session revocation store unavailable') {
    super(message);
    this.name = 'SessionRevocationStoreUnavailableError';
  }
}

/** Fast-path revocation lookup used by JwtAuthGuard (fail-closed). */
export interface SessionRevocationChecker {
  isRevoked(sid: string): Promise<boolean>;
}
