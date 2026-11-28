import {
  safeParseMessage,
  type VideoFailedMessage,
  type VideoProcessedMessage,
  type VideoProcessingMessage,
} from '@dinhogt/fiapx-contracts';
import type { VideoListCache } from '../domain/ports/video-list-cache';
import type { VideoRepository } from '../domain/ports/video-repository';
import type { Video } from '../domain/video';

export type ApplyStatusEventResult =
  | 'applied'
  | 'ignored'
  | 'duplicate'
  | 'invalid_message'
  | 'video_not_found';

type StatusMessage = VideoProcessingMessage | VideoProcessedMessage | VideoFailedMessage;

/**
 * Consumes video.processing | video.processed | video.failed (B2):
 * inbox in the same transaction as the effect; invalid transitions are
 * recorded in the inbox and ignored (out-of-order).
 */
export class ApplyStatusEventUseCase {
  constructor(
    private readonly videos: VideoRepository,
    private readonly listCache: VideoListCache,
  ) {}

  async execute(rawBody: unknown): Promise<ApplyStatusEventResult> {
    const parsed = safeParseMessage(rawBody);
    if (!parsed.success) {
      return 'invalid_message';
    }
    const message = parsed.data;
    if (
      message.type !== 'video.processing' &&
      message.type !== 'video.processed' &&
      message.type !== 'video.failed'
    ) {
      return 'invalid_message';
    }

    const statusMessage: StatusMessage = message;
    const video = await this.videos.findById(statusMessage.payload.videoId);
    if (!video) {
      const recorded = await this.videos.recordInboxAndMaybeUpdate({
        messageId: statusMessage.messageId,
        type: statusMessage.type,
      });
      return recorded === 'duplicate' ? 'duplicate' : 'video_not_found';
    }

    const applied = tryApply(video, statusMessage);
    const recorded = await this.videos.recordInboxAndMaybeUpdate({
      messageId: statusMessage.messageId,
      type: statusMessage.type,
      video: applied ? video : undefined,
    });

    if (recorded === 'duplicate') {
      return 'duplicate';
    }
    if (!applied) {
      return 'ignored';
    }

    await this.listCache.bumpVersion(video.userId);
    return 'applied';
  }
}

function tryApply(video: Video, message: StatusMessage): boolean {
  if (message.type === 'video.processing') {
    return video.markProcessing(new Date(message.payload.startedAt)).ok;
  }
  if (message.type === 'video.processed') {
    return video.complete(
      {
        frameCount: message.payload.frameCount,
        zipSizeBytes: BigInt(message.payload.zipSizeBytes),
        outputKey: message.payload.outputKey,
      },
      new Date(message.payload.completedAt),
    ).ok;
  }
  return video.fail(
    message.payload.failureCode,
    message.payload.failureMessage,
    new Date(message.payload.failedAt),
  ).ok;
}
