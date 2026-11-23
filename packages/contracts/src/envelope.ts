import { z } from 'zod';

export const MessageType = {
  VIDEO_PROCESS: 'video.process',
  VIDEO_PROCESSING: 'video.processing',
  VIDEO_PROCESSED: 'video.processed',
  VIDEO_FAILED: 'video.failed',
  USER_REGISTERED: 'user.registered',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const messageTypeSchema = z.enum([
  MessageType.VIDEO_PROCESS,
  MessageType.VIDEO_PROCESSING,
  MessageType.VIDEO_PROCESSED,
  MessageType.VIDEO_FAILED,
  MessageType.USER_REGISTERED,
]);

export const MessageSource = {
  AUTH_SERVICE: 'auth-service',
  VIDEO_SERVICE: 'video-service',
  VIDEO_WORKER: 'video-worker',
  NOTIFICATION_SERVICE: 'notification-service',
} as const;

export type MessageSource = (typeof MessageSource)[keyof typeof MessageSource];

export const messageSourceSchema = z.enum([
  MessageSource.AUTH_SERVICE,
  MessageSource.VIDEO_SERVICE,
  MessageSource.VIDEO_WORKER,
  MessageSource.NOTIFICATION_SERVICE,
]);

const uuidSchema = z.string().uuid();
const isoDateSchema = z.string().datetime({ offset: true });
const traceparentSchema = z.string().regex(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);

export const envelopeBaseSchema = z.object({
  messageId: uuidSchema,
  type: messageTypeSchema,
  version: z.literal(1),
  occurredAt: isoDateSchema,
  source: messageSourceSchema,
  correlationId: uuidSchema,
  causationId: uuidSchema.nullable(),
  traceparent: traceparentSchema,
});

export type EnvelopeBase = z.infer<typeof envelopeBaseSchema>;
