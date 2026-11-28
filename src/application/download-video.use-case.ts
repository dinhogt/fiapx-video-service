import { buildContentDisposition } from '../domain/download-filename';
import type { PresignedDownloadPort } from '../domain/ports/presigned-download';
import type { VideoRepository } from '../domain/ports/video-repository';
import { failure, type Result, success } from '../domain/result';
import { OUTPUT_TTL_MS } from '../domain/video-view';

export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export type DownloadVideoCommand = {
  videoId: string;
  userId: string;
  bucket: string;
  now?: Date;
};

export type DownloadVideoResult = {
  url: string;
  expiresAt: string;
};

export class DownloadVideoUseCase {
  constructor(
    private readonly videos: VideoRepository,
    private readonly downloads: PresignedDownloadPort,
  ) {}

  async execute(command: DownloadVideoCommand): Promise<Result<DownloadVideoResult>> {
    const video = await this.videos.findByIdForUser(command.videoId, command.userId);
    if (!video) {
      return failure('VIDEO_NOT_FOUND');
    }

    if (video.status !== 'COMPLETED') {
      return failure('NOT_COMPLETED');
    }

    if (!video.outputKey || !video.completedAt) {
      return failure('NOT_COMPLETED');
    }

    const now = command.now ?? new Date();
    const outputExpiresAt = new Date(video.completedAt.getTime() + OUTPUT_TTL_MS);
    if (now.getTime() > outputExpiresAt.getTime()) {
      return failure('OUTPUT_EXPIRED');
    }

    const download = await this.downloads.createGet({
      bucket: command.bucket,
      key: video.outputKey,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      responseContentDisposition: buildContentDisposition(video.file.fileName),
    });

    return success({
      url: download.url,
      expiresAt: download.expiresAt.toISOString(),
    });
  }
}
