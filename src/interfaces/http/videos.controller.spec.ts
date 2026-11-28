/* eslint-disable @typescript-eslint/require-await */
import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { VideosController } from './videos.controller';
import type { ConfirmVideoUseCase } from '../../application/confirm-video.use-case';
import type { CreateVideoUseCase } from '../../application/create-video.use-case';
import type { DownloadVideoUseCase } from '../../application/download-video.use-case';
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
  download?: DownloadVideoUseCase;
} = {}): VideosController {
  return new VideosController(
    overrides.create ?? ({ execute: jest.fn() } as unknown as CreateVideoUseCase),
    overrides.confirm ?? ({ execute: jest.fn() } as unknown as ConfirmVideoUseCase),
    overrides.list ?? ({ execute: jest.fn() } as unknown as ListVideosUseCase),
    overrides.get ?? ({ execute: jest.fn() } as unknown as GetVideoUseCase),
    overrides.download ?? ({ execute: jest.fn() } as unknown as DownloadVideoUseCase),
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

  it('download maps NOT_COMPLETED to 409 and OUTPUT_EXPIRED to 410', async () => {
    await expect(
      controller({
        download: {
          execute: jest.fn(async () => ({ ok: false, code: 'NOT_COMPLETED' })),
        } as unknown as DownloadVideoUseCase,
      }).download(videoId, authReq()),
    ).rejects.toBeInstanceOf(ConflictException);

    await expect(
      controller({
        download: {
          execute: jest.fn(async () => ({ ok: false, code: 'OUTPUT_EXPIRED' })),
        } as unknown as DownloadVideoUseCase,
      }).download(videoId, authReq()),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('download returns url payload on success', async () => {
    const download = {
      execute: jest.fn(async () => ({
        ok: true,
        value: { url: 'http://localhost:4566/x', expiresAt: '2026-11-28T12:05:00.000Z' },
      })),
    } as unknown as DownloadVideoUseCase;
    await expect(controller({ download }).download(videoId, authReq())).resolves.toEqual({
      url: 'http://localhost:4566/x',
      expiresAt: '2026-11-28T12:05:00.000Z',
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

  it('confirm maps OBJECT_MISSING to 409 (AC-22)', async () => {
    const confirm = {
      execute: jest.fn(async () => ({ ok: false, code: 'OBJECT_MISSING' })),
    } as unknown as ConfirmVideoUseCase;
    await expect(controller({ confirm }).confirm(videoId, authReq())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('download rejects unauthenticated, invalid id and unknown errors', async () => {
    const anon = { headers: {}, header: () => undefined } as unknown as AuthenticatedRequest;
    await expect(controller().download(videoId, anon)).rejects.toMatchObject({ status: 401 });
    await expect(controller().download('bad', authReq())).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      controller({
        download: {
          execute: jest.fn(async () => ({ ok: false, code: 'VIDEO_NOT_FOUND' })),
        } as unknown as DownloadVideoUseCase,
      }).download(videoId, authReq()),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      controller({
        download: {
          execute: jest.fn(async () => ({ ok: false, code: 'WEIRD' })),
        } as unknown as DownloadVideoUseCase,
      }).download(videoId, authReq()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
