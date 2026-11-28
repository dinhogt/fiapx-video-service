import { buildEnvelope, MessageSource } from '@dinhogt/fiapx-contracts';
import type { ObjectStoragePort } from '../domain/ports/object-storage';
import type { OutboxRelay } from '../domain/ports/outbox-relay';
import type { VideoRepository } from '../domain/ports/video-repository';
import { failure, type Result, success } from '../domain/result';
import type { VideoStatus } from '../domain/video';
import { buildOutputKey } from '../domain/video-keys';

export type ConfirmVideoCommand = {
  videoId: string;
  userId: string;
  bucket: string;
  processQueueUrl: string;
  traceparent: string;
  now?: Date;
};

export type ConfirmVideoResult = {
  videoId: string;
  status: VideoStatus;
};

export class ConfirmVideoUseCase {
  constructor(
    private readonly videos: VideoRepository,
    private readonly storage: ObjectStoragePort,
    private readonly outboxRelay?: OutboxRelay,
  ) {}

  async execute(command: ConfirmVideoCommand): Promise<Result<ConfirmVideoResult>> {
    const video = await this.videos.findByIdForUser(command.videoId, command.userId);
    if (!video) {
      return failure('VIDEO_NOT_FOUND');
    }

    // AC-23 / ADR-004: already past PENDING_UPLOAD → 202 with current status, no new outbox.
    if (video.status !== 'PENDING_UPLOAD') {
      if (video.status === 'EXPIRED') {
        return failure('VIDEO_EXPIRED');
      }
      return success({ videoId: video.id, status: video.status });
    }

    const exists = await this.storage.exists(command.bucket, video.inputKey);
    if (!exists) {
      return failure('OBJECT_MISSING');
    }

    const now = command.now ?? new Date();
    const queued = video.queue(now);
    if (!queued.ok) {
      return queued;
    }

    const outputKey = buildOutputKey(video.userId, video.id);
    const envelope = buildEnvelope({
      type: 'video.process',
      source: MessageSource.VIDEO_SERVICE,
      correlationId: video.correlationId,
      traceparent: command.traceparent,
      payload: {
        videoId: video.id,
        userId: video.userId,
        inputKey: video.inputKey,
        outputKey,
        fps: video.fps.value,
        fileName: video.file.fileName,
      },
    });

    await this.videos.queueWithOutbox(video, {
      aggregateId: video.id,
      type: envelope.type,
      destination: command.processQueueUrl,
      payload: envelope,
    });

    this.outboxRelay?.kick();

    return success({ videoId: video.id, status: video.status });
  }
}
