/* eslint-disable @typescript-eslint/require-await */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { VideosController } from './videos.controller';
import type { ConfirmVideoUseCase } from '../../application/confirm-video.use-case';
import type { CreateVideoUseCase } from '../../application/create-video.use-case';
import type { VideoEnv } from '../../infrastructure/config/env';
import type { AuthenticatedRequest } from '../../shared/jwt-auth';

const env = {
  S3_BUCKET: 'fiapx-local-videos',
  VIDEO_PROCESS_QUEUE_URL: 'http://localhost:4566/000000000000/fiapx-local-video-process',
} as VideoEnv;

const userId = '11111111-1111-4111-8111-111111111111';
const videoId = '22222222-2222-4222-8222-222222222222';

function authReq(): AuthenticatedRequest {
  return {
    user: { sub: userId, sid: 's1' },
    headers: {},
    header: () => undefined,
  } as unknown as AuthenticatedRequest;
}

describe('VideosController', () => {
  it('returns an empty list for the authenticated user', () => {
    const createVideo = { execute: jest.fn() } as unknown as CreateVideoUseCase;
    const confirmVideo = { execute: jest.fn() } as unknown as ConfirmVideoUseCase;
    const controller = new VideosController(createVideo, confirmVideo, env);
    const req = { user: { sub: 'u1', sid: 's1' } } as AuthenticatedRequest;
    expect(controller.list(req)).toEqual({
      items: [],
      nextCursor: null,
      userId: 'u1',
    });
  });

  it('maps domain validation failures to 400 (AC-20)', async () => {
    const createVideo = {
      execute: jest.fn(async () => ({ ok: false, code: 'INVALID_FILE_SIZE' })),
    } as unknown as CreateVideoUseCase;
    const confirmVideo = { execute: jest.fn() } as unknown as ConfirmVideoUseCase;
    const controller = new VideosController(createVideo, confirmVideo, env);

    await expect(
      controller.create(
        {
          fileName: 'big.mp4',
          sizeBytes: 524_288_001,
          contentType: 'video/mp4',
        },
        authReq(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 201 payload on success', async () => {
    const createVideo = {
      execute: jest.fn(async () => ({
        ok: true,
        value: {
          videoId: 'v1',
          status: 'PENDING_UPLOAD',
          upload: {
            url: 'http://localhost:4566/bucket',
            method: 'POST',
            fields: { key: 'raw/u/v.mp4' },
            expiresAt: '2026-11-28T12:15:00.000Z',
          },
        },
      })),
    } as unknown as CreateVideoUseCase;
    const confirmVideo = { execute: jest.fn() } as unknown as ConfirmVideoUseCase;
    const controller = new VideosController(createVideo, confirmVideo, env);

    const body = await controller.create(
      {
        fileName: 'demo.mp4',
        sizeBytes: 100,
        contentType: 'video/mp4',
      },
      authReq(),
    );
    expect(body.videoId).toBe('v1');
    expect(body.status).toBe('PENDING_UPLOAD');
  });

  it('confirm maps OBJECT_MISSING to 409 (AC-22)', async () => {
    const createVideo = { execute: jest.fn() } as unknown as CreateVideoUseCase;
    const confirmVideo = {
      execute: jest.fn(async () => ({ ok: false, code: 'OBJECT_MISSING' })),
    } as unknown as ConfirmVideoUseCase;
    const controller = new VideosController(createVideo, confirmVideo, env);

    await expect(controller.confirm(videoId, authReq())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('confirm maps VIDEO_NOT_FOUND to 404', async () => {
    const createVideo = { execute: jest.fn() } as unknown as CreateVideoUseCase;
    const confirmVideo = {
      execute: jest.fn(async () => ({ ok: false, code: 'VIDEO_NOT_FOUND' })),
    } as unknown as ConfirmVideoUseCase;
    const controller = new VideosController(createVideo, confirmVideo, env);

    await expect(controller.confirm(videoId, authReq())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('confirm returns 202 payload (AC-21)', async () => {
    const createVideo = { execute: jest.fn() } as unknown as CreateVideoUseCase;
    const confirmVideo = {
      execute: jest.fn(async () => ({
        ok: true,
        value: { videoId, status: 'QUEUED' },
      })),
    } as unknown as ConfirmVideoUseCase;
    const controller = new VideosController(createVideo, confirmVideo, env);

    await expect(controller.confirm(videoId, authReq())).resolves.toEqual({
      videoId,
      status: 'QUEUED',
    });
  });

  it('create rejects unauthenticated requests', async () => {
    const controller = new VideosController(
      { execute: jest.fn() } as unknown as CreateVideoUseCase,
      { execute: jest.fn() } as unknown as ConfirmVideoUseCase,
      env,
    );
    const req = { headers: {}, header: () => undefined } as unknown as AuthenticatedRequest;
    await expect(
      controller.create(
        { fileName: 'a.mp4', sizeBytes: 1, contentType: 'video/mp4' },
        req,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('confirm rejects unauthenticated and invalid id', async () => {
    const controller = new VideosController(
      { execute: jest.fn() } as unknown as CreateVideoUseCase,
      { execute: jest.fn() } as unknown as ConfirmVideoUseCase,
      env,
    );
    const anon = { headers: {}, header: () => undefined } as unknown as AuthenticatedRequest;
    await expect(controller.confirm(videoId, anon)).rejects.toMatchObject({ status: 401 });
    await expect(controller.confirm('not-a-uuid', authReq())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('confirm maps VIDEO_EXPIRED, INVALID_TRANSITION and unknown codes', async () => {
    const stubCreate = { execute: jest.fn() } as unknown as CreateVideoUseCase;

    await expect(
      new VideosController(
        stubCreate,
        {
          execute: jest.fn(async () => ({ ok: false, code: 'VIDEO_EXPIRED' })),
        } as unknown as ConfirmVideoUseCase,
        env,
      ).confirm(videoId, authReq()),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      new VideosController(
        stubCreate,
        {
          execute: jest.fn(async () => ({ ok: false, code: 'INVALID_TRANSITION' })),
        } as unknown as ConfirmVideoUseCase,
        env,
      ).confirm(videoId, authReq()),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      new VideosController(
        stubCreate,
        {
          execute: jest.fn(async () => ({ ok: false, code: 'WEIRD' })),
        } as unknown as ConfirmVideoUseCase,
        env,
      ).confirm(videoId, authReq()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create rejects invalid body schema', async () => {
    const controller = new VideosController(
      { execute: jest.fn() } as unknown as CreateVideoUseCase,
      { execute: jest.fn() } as unknown as ConfirmVideoUseCase,
      env,
    );
    await expect(controller.create({ fileName: 1 }, authReq())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
