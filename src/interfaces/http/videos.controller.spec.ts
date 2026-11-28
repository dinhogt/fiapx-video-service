/* eslint-disable @typescript-eslint/require-await */
import { BadRequestException } from '@nestjs/common';
import { VideosController } from './videos.controller';
import type { CreateVideoUseCase } from '../../application/create-video.use-case';
import type { VideoEnv } from '../../infrastructure/config/env';
import type { AuthenticatedRequest } from '../../shared/jwt-auth';

const env = { S3_BUCKET: 'fiapx-local-videos' } as VideoEnv;

describe('VideosController', () => {
  it('returns an empty list for the authenticated user', () => {
    const createVideo = { execute: jest.fn() } as unknown as CreateVideoUseCase;
    const controller = new VideosController(createVideo, env);
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
    const controller = new VideosController(createVideo, env);
    const req = {
      user: { sub: '11111111-1111-4111-8111-111111111111', sid: 's1' },
      headers: {},
      header: () => undefined,
    } as unknown as AuthenticatedRequest;

    await expect(
      controller.create(
        {
          fileName: 'big.mp4',
          sizeBytes: 524_288_001,
          contentType: 'video/mp4',
        },
        req,
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
    const controller = new VideosController(createVideo, env);
    const req = {
      user: { sub: '11111111-1111-4111-8111-111111111111', sid: 's1' },
      headers: { 'x-correlation-id': '22222222-2222-4222-8222-222222222222' },
      header: (name: string) =>
        name.toLowerCase() === 'x-correlation-id'
          ? '22222222-2222-4222-8222-222222222222'
          : undefined,
    } as unknown as AuthenticatedRequest;

    const body = await controller.create(
      {
        fileName: 'demo.mp4',
        sizeBytes: 100,
        contentType: 'video/mp4',
      },
      req,
    );
    expect(body.videoId).toBe('v1');
    expect(body.status).toBe('PENDING_UPLOAD');
  });
});
