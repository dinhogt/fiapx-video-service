/* eslint-disable @typescript-eslint/require-await */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { VideosController } from './videos.controller';
import type { ConfirmVideoUseCase } from '../../application/confirm-video.use-case';
import type { CreateVideoUseCase } from '../../application/create-video.use-case';
import type { GetVideoUseCase } from '../../application/get-video.use-case';
import type { ListVideosUseCase } from '../../application/list-videos.use-case';
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

function controller(overrides: {
  create?: CreateVideoUseCase;
  confirm?: ConfirmVideoUseCase;
  list?: ListVideosUseCase;
  get?: GetVideoUseCase;
} = {}): VideosController {
  return new VideosController(
    overrides.create ?? ({ execute: jest.fn() } as unknown as CreateVideoUseCase),
    overrides.confirm ?? ({ execute: jest.fn() } as unknown as ConfirmVideoUseCase),
    overrides.list ?? ({ execute: jest.fn() } as unknown as ListVideosUseCase),
    overrides.get ?? ({ execute: jest.fn() } as unknown as GetVideoUseCase),
    env,
  );
}

describe('VideosController', () => {
  it('lists videos for the authenticated user', async () => {
    const list = {
      execute: jest.fn(async () => ({
        ok: true,
        value: { items: [{ videoId }], nextCursor: null },
      })),
    } as unknown as ListVideosUseCase;
    await expect(controller({ list }).list({ limit: '10' }, authReq())).resolves.toEqual({
      items: [{ videoId }],
      nextCursor: null,
    });
  });

  it('getById returns 404 for non-owner (AC-80)', async () => {
    const get = {
      execute: jest.fn(async () => ({ ok: false, code: 'VIDEO_NOT_FOUND' })),
    } as unknown as GetVideoUseCase;
    await expect(controller({ get }).getById(videoId, authReq())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps domain validation failures to 400 (AC-20)', async () => {
    const create = {
      execute: jest.fn(async () => ({ ok: false, code: 'INVALID_FILE_SIZE' })),
    } as unknown as CreateVideoUseCase;
    await expect(
      controller({ create }).create(
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
    const create = {
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

    const body = await controller({ create }).create(
      {
        fileName: 'demo.mp4',
        sizeBytes: 100,
        contentType: 'video/mp4',
      },
      authReq(),
    );
    expect(body.videoId).toBe('v1');
  });

  it('confirm maps OBJECT_MISSING to 409 (AC-22)', async () => {
    const confirm = {
      execute: jest.fn(async () => ({ ok: false, code: 'OBJECT_MISSING' })),
    } as unknown as ConfirmVideoUseCase;
    await expect(controller({ confirm }).confirm(videoId, authReq())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('confirm returns 202 payload (AC-21)', async () => {
    const confirm = {
      execute: jest.fn(async () => ({
        ok: true,
        value: { videoId, status: 'QUEUED' },
      })),
    } as unknown as ConfirmVideoUseCase;
    await expect(controller({ confirm }).confirm(videoId, authReq())).resolves.toEqual({
      videoId,
      status: 'QUEUED',
    });
  });

  it('list maps INVALID_LIMIT and INVALID_CURSOR to 400', async () => {
    await expect(
      controller({
        list: {
          execute: jest.fn(async () => ({ ok: false, code: 'INVALID_LIMIT' })),
        } as unknown as ListVideosUseCase,
      }).list({}, authReq()),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller({
        list: {
          execute: jest.fn(async () => ({ ok: false, code: 'INVALID_CURSOR' })),
        } as unknown as ListVideosUseCase,
      }).list({ cursor: 'x' }, authReq()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('list/get reject unauthenticated callers', async () => {
    const anon = { headers: {}, header: () => undefined } as unknown as AuthenticatedRequest;
    await expect(controller().list({}, anon)).rejects.toMatchObject({ status: 401 });
    await expect(controller().getById(videoId, anon)).rejects.toMatchObject({ status: 401 });
  });

  it('getById rejects invalid uuid and returns view for owner', async () => {
    await expect(controller().getById('bad', authReq())).rejects.toBeInstanceOf(NotFoundException);

    const get = {
      execute: jest.fn(async () => ({
        ok: true,
        value: { videoId, fileName: 'a.mp4', status: 'PENDING_UPLOAD' },
      })),
    } as unknown as GetVideoUseCase;
    await expect(controller({ get }).getById(videoId, authReq())).resolves.toMatchObject({
      videoId,
    });
  });
});
