import { context, propagation } from '@opentelemetry/api';

/**
 * Continues the W3C trace from a message envelope `traceparent` (ADR-011).
 * No-op when the carrier is missing/invalid or OTel is not configured.
 */
export async function withMessageTraceparent<T>(
  traceparent: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!traceparent || typeof traceparent !== 'string') {
    return fn();
  }
  const extracted = propagation.extract(context.active(), { traceparent });
  return context.with(extracted, fn);
}

export function readTraceparentFromBody(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const value = (body as { traceparent?: unknown }).traceparent;
  return typeof value === 'string' ? value : undefined;
}
