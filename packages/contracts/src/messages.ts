import { z } from 'zod';
import { envelopeBaseSchema, MessageType } from './envelope';
import { failureCodeSchema } from './failure-code';

const uuidSchema = z.string().uuid();
const isoDateSchema = z.string().datetime({ offset: true });

export const videoProcessPayloadSchema = z.object({
  videoId: uuidSchema,
  userId: uuidSchema,
  inputKey: z.string().min(1),
  outputKey: z.string().min(1),
  fps: z.number().positive(),
  fileName: z.string().min(1).max(255),
});

export const videoProcessingPayloadSchema = z.object({
  videoId: uuidSchema,
  userId: uuidSchema,
  attempt: z.number().int().positive(),
  startedAt: isoDateSchema,
});

export const videoProcessedPayloadSchema = z.object({
  videoId: uuidSchema,
  userId: uuidSchema,
  outputKey: z.string().min(1),
  frameCount: z.number().int().nonnegative(),
  zipSizeBytes: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  completedAt: isoDateSchema,
});

export const videoFailedPayloadSchema = z.object({
  videoId: uuidSchema,
  userId: uuidSchema,
  fileName: z.string().min(1).max(255),
  failureCode: failureCodeSchema,
  failureMessage: z.string().min(1).max(500),
  attempts: z.number().int().positive(),
  failedAt: isoDateSchema,
});

export const userRegisteredPayloadSchema = z.object({
  userId: uuidSchema,
  email: z.string().email(),
  name: z.string().min(2).max(120),
  registeredAt: isoDateSchema,
});

export const videoProcessMessageSchema = envelopeBaseSchema.extend({
  type: z.literal(MessageType.VIDEO_PROCESS),
  payload: videoProcessPayloadSchema,
});

export const videoProcessingMessageSchema = envelopeBaseSchema.extend({
  type: z.literal(MessageType.VIDEO_PROCESSING),
  payload: videoProcessingPayloadSchema,
});

export const videoProcessedMessageSchema = envelopeBaseSchema.extend({
  type: z.literal(MessageType.VIDEO_PROCESSED),
  payload: videoProcessedPayloadSchema,
});

export const videoFailedMessageSchema = envelopeBaseSchema.extend({
  type: z.literal(MessageType.VIDEO_FAILED),
  payload: videoFailedPayloadSchema,
});

export const userRegisteredMessageSchema = envelopeBaseSchema.extend({
  type: z.literal(MessageType.USER_REGISTERED),
  payload: userRegisteredPayloadSchema,
});

export const messageSchema = z.discriminatedUnion('type', [
  videoProcessMessageSchema,
  videoProcessingMessageSchema,
  videoProcessedMessageSchema,
  videoFailedMessageSchema,
  userRegisteredMessageSchema,
]);

export type VideoProcessMessage = z.infer<typeof videoProcessMessageSchema>;
export type VideoProcessingMessage = z.infer<typeof videoProcessingMessageSchema>;
export type VideoProcessedMessage = z.infer<typeof videoProcessedMessageSchema>;
export type VideoFailedMessage = z.infer<typeof videoFailedMessageSchema>;
export type UserRegisteredMessage = z.infer<typeof userRegisteredMessageSchema>;
export type FiapxMessage = z.infer<typeof messageSchema>;

export function parseMessage(input: unknown): FiapxMessage {
  return messageSchema.parse(input);
}

export function safeParseMessage(input: unknown) {
  return messageSchema.safeParse(input);
}
