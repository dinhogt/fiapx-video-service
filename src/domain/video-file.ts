import { failure, type Result, success } from './result';

/** D13 / B1: max 500 MB; whitelist of extensions ↔ content-types. */
export const MAX_VIDEO_SIZE_BYTES = 524_288_000;

export const VIDEO_CONTENT_TYPES = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
} as const;

export type VideoExtension = keyof typeof VIDEO_CONTENT_TYPES;

export class VideoFile {
  private constructor(
    readonly fileName: string,
    readonly extension: VideoExtension,
    readonly contentType: string,
    readonly sizeBytes: bigint,
  ) {}

  static create(input: {
    fileName: string;
    contentType: string;
    sizeBytes: number | bigint;
  }): Result<VideoFile> {
    const fileName = input.fileName.trim();
    if (fileName.length < 1 || fileName.length > 255) {
      return failure('INVALID_FILE_NAME');
    }
    if (fileName.includes('/') || fileName.includes('\\')) {
      return failure('INVALID_FILE_NAME');
    }

    const dot = fileName.lastIndexOf('.');
    if (dot <= 0 || dot === fileName.length - 1) {
      return failure('INVALID_FILE_EXTENSION');
    }
    const extension = fileName.slice(dot + 1).toLowerCase();
    if (!(extension in VIDEO_CONTENT_TYPES)) {
      return failure('INVALID_FILE_EXTENSION');
    }
    const ext = extension as VideoExtension;
    const expectedType = VIDEO_CONTENT_TYPES[ext];
    if (input.contentType !== expectedType) {
      return failure('CONTENT_TYPE_MISMATCH');
    }

    const sizeBytes =
      typeof input.sizeBytes === 'bigint' ? input.sizeBytes : BigInt(input.sizeBytes);
    if (sizeBytes < 1n || sizeBytes > BigInt(MAX_VIDEO_SIZE_BYTES)) {
      return failure('INVALID_FILE_SIZE');
    }

    return success(new VideoFile(fileName, ext, expectedType, sizeBytes));
  }

  get inputExtension(): string {
    return this.extension;
  }
}
