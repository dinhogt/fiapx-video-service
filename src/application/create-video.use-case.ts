import { randomUUID } from 'node:crypto';
import { Fps } from '../domain/fps';
import type { PresignedUploadPort } from '../domain/ports/presigned-upload';
import type { VideoRepository } from '../domain/ports/video-repository';
import { type Result, success } from '../domain/result';
import { Video } from '../domain/video';
import { MAX_VIDEO_SIZE_BYTES, VideoFile } from '../domain/video-file';
import { buildRawInputKey } from '../domain/video-keys';

export const PRESIGNED_POST_TTL_SECONDS = 15 * 60;

export type CreateVideoCommand = {
  userId: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  fps?: number;
  correlationId: string;
  bucket: string;
  now?: Date;
};

export type CreatedVideoUpload = {
  videoId: string;
  status: 'PENDING_UPLOAD';
  upload: {
    url: string;
    method: 'POST';
    fields: Record<string, string>;
    expiresAt: string;
  };
};

export class CreateVideoUseCase {
  constructor(
    private readonly videos: VideoRepository,
    private readonly uploads: PresignedUploadPort,
  ) {}

  async execute(command: CreateVideoCommand): Promise<Result<CreatedVideoUpload>> {
    const file = VideoFile.create({
      fileName: command.fileName,
      contentType: command.contentType,
      sizeBytes: command.sizeBytes,
    });
    if (!file.ok) {
      return file;
    }

    const fps = Fps.create(command.fps);
    if (!fps.ok) {
      return fps;
    }

    const videoId = randomUUID();
    const inputKey = buildRawInputKey(command.userId, videoId, file.value.extension);
    const video = Video.create({
      id: videoId,
      userId: command.userId,
      file: file.value,
      fps: fps.value,
      inputKey,
      correlationId: command.correlationId,
      now: command.now,
    });

    await this.videos.save(video);

    const upload = await this.uploads.createPost({
      bucket: command.bucket,
      key: inputKey,
      contentType: file.value.contentType,
      maxSizeBytes: MAX_VIDEO_SIZE_BYTES,
      expiresInSeconds: PRESIGNED_POST_TTL_SECONDS,
    });

    return success({
      videoId: video.id,
      status: 'PENDING_UPLOAD',
      upload: {
        url: upload.url,
        method: 'POST',
        fields: upload.fields,
        expiresAt: upload.expiresAt.toISOString(),
      },
    });
  }
}

export function mapCreateVideoError(code: string): { status: 400; detail: string } {
  const details: Record<string, string> = {
    INVALID_FILE_NAME: 'Nome de arquivo inválido.',
    INVALID_FILE_EXTENSION: 'Extensão de arquivo não permitida.',
    CONTENT_TYPE_MISMATCH: 'Content-Type não corresponde à extensão.',
    INVALID_FILE_SIZE: 'Tamanho de arquivo fora do permitido (1 byte a 500 MB).',
    INVALID_FPS: 'fps deve estar entre 0.1 e 5, em múltiplos de 0.1.',
  };
  return {
    status: 400,
    detail: details[code] ?? 'Dados de upload inválidos.',
  };
}
