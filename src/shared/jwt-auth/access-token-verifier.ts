export type VerifiedAccessToken = {
  sub: string;
  sid: string;
};

export class AccessTokenVerificationError extends Error {
  constructor(message = 'Access token verification failed') {
    super(message);
    this.name = 'AccessTokenVerificationError';
  }
}

export interface AccessTokenVerifier {
  verify(accessToken: string): Promise<VerifiedAccessToken>;
}
