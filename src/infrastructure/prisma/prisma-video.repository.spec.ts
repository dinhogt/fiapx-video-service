/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment */
import { Prisma } from '@prisma/client';
import { Fps } from '../../domain/fps';
import { Video } from '../../domain/video';
import { VideoFile } from '../../domain/video-file';
import { PrismaVideoRepository } from './prisma-video.repository';
import type { PrismaService } from './prisma.service';

const userId = '11111111-1111-4111-8111-111111111111';
const videoId = '22222222-2222-4222-8222-222222222222';

function makeVideo(): Video {
  const file = VideoFile.create({
    fileName: 'demo.mp4',
    contentType: 'video/mp4',
    sizeBytes: 10,
  });
  if (!file.ok) {
    throw new Error('fixture');
  }
  const fps = Fps.create(1);
  if (!fps.ok) {
    throw new Error('fixture');
  }
  return Video.create({
    id: videoId,
    userId,
    file: file.value,
    fps: fps.value,
    inputKey: `raw/${userId}/${videoId}.mp4`,
    correlationId: '33333333-3333-4333-8333-333333333333',
  });
}

function row(overrides: Record<string, unknown> = {}) {
  const video = makeVideo();
  return {
    id: video.id,
    userId: video.userId,
    fileName: video.file.fileName,
    contentType: video.file.contentType,
    sizeBytes: video.file.sizeBytes,
    fps: new Prisma.Decimal(1),
    status: video.status,
    inputKey: video.inputKey,
    outputKey: null,
    frameCount: null,
    zipSizeBytes: null,
    failureCode: null,
    failureMessage: null,
    correlationId: video.correlationId,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
    queuedAt: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe('PrismaVideoRepository', () => {
  it('save creates a video row', async () => {
    const create = jest.fn(async () => undefined);
    const prisma = { video: { create } } as unknown as PrismaService;
    const repo = new PrismaVideoRepository(prisma);
    await repo.save(makeVideo());
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: videoId, userId }),
      }),
    );
  });

  it('findById returns null when missing', async () => {
    const prisma = {
      video: { findUnique: jest.fn(async () => null) },
    } as unknown as PrismaService;
    const repo = new PrismaVideoRepository(prisma);
    await expect(repo.findById(videoId)).resolves.toBeNull();
  });

  it('findByIdForUser rehydrates a video', async () => {
    const prisma = {
      video: { findFirst: jest.fn(async () => row()) },
    } as unknown as PrismaService;
    const repo = new PrismaVideoRepository(prisma);
    const found = await repo.findByIdForUser(videoId, userId);
    expect(found?.id).toBe(videoId);
    expect(found?.status).toBe('PENDING_UPLOAD');
  });

  it('findById throws on invalid persisted file metadata', async () => {
    const prisma = {
      video: {
        findUnique: jest.fn(async () => row({ fileName: 'bad', contentType: 'video/mp4' })),
      },
    } as unknown as PrismaService;
    const repo = new PrismaVideoRepository(prisma);
    await expect(repo.findById(videoId)).rejects.toThrow(/invalid file metadata/);
  });

  it('findById throws on invalid persisted fps', async () => {
    const prisma = {
      video: {
        findUnique: jest.fn(async () => row({ fps: new Prisma.Decimal(9) })),
      },
    } as unknown as PrismaService;
    const repo = new PrismaVideoRepository(prisma);
    await expect(repo.findById(videoId)).rejects.toThrow(/invalid fps/);
  });

  it('queueWithOutbox updates video and inserts outbox in a transaction', async () => {
    const update = jest.fn(async () => undefined);
    const create = jest.fn(async () => undefined);
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          video: { update },
          outbox: { create },
        }),
      ),
    } as unknown as PrismaService;
    const repo = new PrismaVideoRepository(prisma);
    const video = makeVideo();
    video.queue();
    await repo.queueWithOutbox(video, {
      aggregateId: videoId,
      type: 'video.process',
      destination: 'queue-url',
      payload: { type: 'video.process' },
    });
    expect(update).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it('countOutboxByAggregate delegates to prisma', async () => {
    const prisma = {
      outbox: { count: jest.fn(async () => 2) },
    } as unknown as PrismaService;
    const repo = new PrismaVideoRepository(prisma);
    await expect(repo.countOutboxByAggregate(videoId)).resolves.toBe(2);
  });

  it('listByUser applies cursor and limit+1', async () => {
    const findMany = jest.fn(async () => [row()]);
    const prisma = { video: { findMany } } as unknown as PrismaService;
    const repo = new PrismaVideoRepository(prisma);
    const cursorAt = new Date('2026-11-28T10:00:00.000Z');
    await repo.listByUser({
      userId,
      limit: 20,
      cursor: { createdAt: cursorAt, id: videoId },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId }),
        take: 21,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });
});
