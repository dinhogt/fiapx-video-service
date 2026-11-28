/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import {
  CreateVideoUseCase,
  mapCreateVideoError,
  PRESIGNED_POST_TTL_SECONDS,
} from './create-video.use-case';
import type { PresignedUploadPort } from '../domain/ports/presigned-upload';
import type { VideoRepository } from '../domain/ports/video-repository';
import { MAX_VIDEO_SIZE_BYTES } from '../domain/video-file';

const userId = '11111111-1111-4111-8111-111111111111';
const correlationId = '22222222-2222-4222-8222-222222222222';
const bucket = 'fiapx-local-videos';

function makeRepo(overrides: Partial<VideoRepository> = {}): VideoRepository {
  return {
    save: jest.fn(async () => undefined),
    findById: jest.fn(async () => null),
    findByIdForUser: jest.fn(async () => null),
    queueWithOutbox: jest.fn(async () => undefined),
    countOutboxByAggregate: jest.fn(async () => 0),
    listByUser: jest.fn(async () => []),
    ...overrides,
  };
}

function makeUploads(overrides: Partial<PresignedUploadPort> = {}): PresignedUploadPort {
  return {
    createPost: jest.fn(async () => ({
      url: 'http://localhost:4566/fiapx-local-videos',
      method: 'POST' as const,
      fields: { key: 'raw/x/y.mp4', Policy: 'p', 'Content-Type': 'video/mp4' },
      expiresAt: new Date('2026-11-28T12:15:00.000Z'),
    })),
    ...overrides,
  };
}

describe('CreateVideoUseCase (AC-20 / D25 / B7)', () => {
  it('persists PENDING_UPLOAD and returns a presigned POST with server key', async () => {
    const videos = makeRepo();
    const uploads = makeUploads();
    const useCase = new CreateVideoUseCase(videos, uploads);

    const result = await useCase.execute({
      userId,
      fileName: 'demo.mp4',
      sizeBytes: 1_024,
      contentType: 'video/mp4',
      correlationId,
      bucket,
      now: new Date('2026-11-28T12:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.status).toBe('PENDING_UPLOAD');
    expect(result.value.upload.method).toBe('POST');
    expect(result.value.upload.expiresAt).toBe('2026-11-28T12:15:00.000Z');
    expect(videos.save).toHaveBeenCalledTimes(1);
    expect(uploads.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket,
        contentType: 'video/mp4',
        maxSizeBytes: MAX_VIDEO_SIZE_BYTES,
        expiresInSeconds: PRESIGNED_POST_TTL_SECONDS,
        key: expect.stringMatching(
          new RegExp(`^raw/${userId}/[0-9a-f-]{36}\\.mp4$`),
        ),
      }),
    );
  });

  it.each([
    {
      name: 'size above 500 MB',
      input: { fileName: 'big.mp4', sizeBytes: MAX_VIDEO_SIZE_BYTES + 1, contentType: 'video/mp4' },
      code: 'INVALID_FILE_SIZE',
    },
    {
      name: 'forbidden extension',
      input: { fileName: 'x.exe', sizeBytes: 10, contentType: 'video/mp4' },
      code: 'INVALID_FILE_EXTENSION',
    },
    {
      name: 'content-type mismatch',
      input: { fileName: 'clip.mp4', sizeBytes: 10, contentType: 'video/webm' },
      code: 'CONTENT_TYPE_MISMATCH',
    },
    {
      name: 'fps out of range',
      input: {
        fileName: 'clip.mp4',
        sizeBytes: 10,
        contentType: 'video/mp4',
        fps: 5.1,
      },
      code: 'INVALID_FPS',
    },
  ])('AC-20: $name → 400 domain error and no persist', async ({ input, code }) => {
    const videos = makeRepo();
    const uploads = makeUploads();
    const useCase = new CreateVideoUseCase(videos, uploads);

    const result = await useCase.execute({
      userId,
      correlationId,
      bucket,
      ...input,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe(code);
    expect(videos.save).not.toHaveBeenCalled();
    expect(uploads.createPost).not.toHaveBeenCalled();
  });

  it('mapCreateVideoError covers known and unknown codes', () => {
    expect(mapCreateVideoError('INVALID_FILE_NAME').detail).toMatch(/Nome/);
    expect(mapCreateVideoError('UNKNOWN').detail).toMatch(/inválidos/i);
  });
});
