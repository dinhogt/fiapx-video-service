import { randomUUID } from 'node:crypto';
import type { MessageSource, MessageType } from './envelope';
import {
  type FiapxMessage,
  messageSchema,
  type UserRegisteredMessage,
  type VideoFailedMessage,
  type VideoProcessedMessage,
  type VideoProcessingMessage,
  type VideoProcessMessage,
} from './messages';

type BuildEnvelopeInput<TType extends MessageType, TPayload> = {
  type: TType;
  source: MessageSource;
  payload: TPayload;
  correlationId: string;
  causationId?: string | null;
  traceparent: string;
  messageId?: string;
  occurredAt?: string;
};

export function buildEnvelope(
  input: BuildEnvelopeInput<'video.process', VideoProcessMessage['payload']>,
): VideoProcessMessage;
export function buildEnvelope(
  input: BuildEnvelopeInput<'video.processing', VideoProcessingMessage['payload']>,
): VideoProcessingMessage;
export function buildEnvelope(
  input: BuildEnvelopeInput<'video.processed', VideoProcessedMessage['payload']>,
): VideoProcessedMessage;
export function buildEnvelope(
  input: BuildEnvelopeInput<'video.failed', VideoFailedMessage['payload']>,
): VideoFailedMessage;
export function buildEnvelope(
  input: BuildEnvelopeInput<'user.registered', UserRegisteredMessage['payload']>,
): UserRegisteredMessage;
export function buildEnvelope(input: {
  type: MessageType;
  source: MessageSource;
  payload: FiapxMessage['payload'];
  correlationId: string;
  causationId?: string | null;
  traceparent: string;
  messageId?: string;
  occurredAt?: string;
}): FiapxMessage {
  const candidate = {
    messageId: input.messageId ?? randomUUID(),
    type: input.type,
    version: 1 as const,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    source: input.source,
    correlationId: input.correlationId,
    causationId: input.causationId ?? null,
    traceparent: input.traceparent,
    payload: input.payload,
  };

  return messageSchema.parse(candidate);
}
