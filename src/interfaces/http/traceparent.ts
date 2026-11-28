import { randomBytes } from 'node:crypto';

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

export function buildTraceparent(incoming?: string | null): string {
  if (incoming && TRACEPARENT_RE.test(incoming)) {
    return incoming;
  }
  const traceId = randomBytes(16).toString('hex');
  const spanId = randomBytes(8).toString('hex');
  return `00-${traceId}-${spanId}-01`;
}
