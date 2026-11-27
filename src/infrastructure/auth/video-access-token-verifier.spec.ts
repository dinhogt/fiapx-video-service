import { createServer, type Server } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { AccessTokenVerificationError } from '../../shared/jwt-auth';
import { VideoAccessTokenVerifier } from './video-access-token-verifier';
import type { VideoEnv } from '../config/env';

async function startJwksServer(jwk: object): Promise<{
  server: Server;
  url: string;
}> {
  const server = createServer((req, res) => {
    if (req.url === '/jwks.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind JWKS server');
  }
  return { server, url: `http://127.0.0.1:${address.port}/jwks.json` };
}

describe('VideoAccessTokenVerifier', () => {
  let server: Server;

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('verifies tokens via remote JWKS', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'vs-kid';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const started = await startJwksServer(jwk);
    server = started.server;

    const issuer = 'http://issuer.test';
    const audience = 'fiapx-api';
    const verifier = new VideoAccessTokenVerifier({
      JWKS_URL: started.url,
      JWT_ISSUER: issuer,
      JWT_AUDIENCE: audience,
    } as VideoEnv);

    const token = await new SignJWT({ sid: '33333333-3333-4333-8333-333333333333' })
      .setProtectedHeader({ alg: 'RS256', kid: 'vs-kid' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('11111111-1111-4111-8111-111111111111')
      .setExpirationTime('15m')
      .sign(privateKey);

    await expect(verifier.verify(token)).resolves.toEqual({
      sub: '11111111-1111-4111-8111-111111111111',
      sid: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('rejects invalid signatures', async () => {
    const { publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'vs-kid';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const started = await startJwksServer(jwk);
    server = started.server;

    const verifier = new VideoAccessTokenVerifier({
      JWKS_URL: started.url,
      JWT_ISSUER: 'http://issuer.test',
      JWT_AUDIENCE: 'fiapx-api',
    } as VideoEnv);

    await expect(verifier.verify('bad.token.value')).rejects.toBeInstanceOf(
      AccessTokenVerificationError,
    );
  });
});
