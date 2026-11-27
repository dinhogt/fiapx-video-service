import { createServer, type Server } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { AccessTokenVerificationError } from './access-token-verifier';
import { RemoteJwksAccessTokenVerifier } from './remote-jwks-access-token-verifier';

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

describe('RemoteJwksAccessTokenVerifier', () => {
  let server: Server;

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('verifies a token against a remote JWKS (10 min cache settings)', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-kid';
    jwk.alg = 'RS256';
    jwk.use = 'sig';

    const started = await startJwksServer(jwk);
    server = started.server;

    const issuer = 'http://issuer.test';
    const audience = 'fiapx-api';
    const verifier = new RemoteJwksAccessTokenVerifier({
      jwksUrl: started.url,
      issuer,
      audience,
      cacheMaxAgeMs: 10 * 60 * 1000,
    });

    const token = await new SignJWT({ sid: '33333333-3333-4333-8333-333333333333' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
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

  it('rejects forged tokens', async () => {
    const { publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    jwk.kid = 'test-kid';
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const started = await startJwksServer(jwk);
    server = started.server;

    const verifier = new RemoteJwksAccessTokenVerifier({
      jwksUrl: started.url,
      issuer: 'http://issuer.test',
      audience: 'fiapx-api',
    });

    await expect(verifier.verify('not.a.jwt')).rejects.toBeInstanceOf(AccessTokenVerificationError);
  });
});
