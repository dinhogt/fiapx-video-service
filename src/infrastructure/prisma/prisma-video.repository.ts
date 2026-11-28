import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Fps } from '../../domain/fps';
import type { OutboxInsert, VideoRepository } from '../../domain/ports/video-repository';
import { Video } from '../../domain/video';
import { VideoFile } from '../../domain/video-file';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaVideoRepository implements VideoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(video: Video): Promise<void> {
    await this.prisma.video.create({
      data: toCreateData(video),
    });
  }

  async findById(id: string): Promise<Video | null> {
    const row = await this.prisma.video.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByIdForUser(id: string, userId: string): Promise<Video | null> {
    const row = await this.prisma.video.findFirst({ where: { id, userId } });
    return row ? toDomain(row) : null;
  }

  async queueWithOutbox(video: Video, outbox: OutboxInsert): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.video.update({
        where: { id: video.id },
        data: {
          status: video.status,
          updatedAt: video.updatedAt,
          queuedAt: video.queuedAt,
        },
      });
      await tx.outbox.create({
        data: {
          aggregateId: outbox.aggregateId,
          type: outbox.type,
          destination: outbox.destination,
          payload: outbox.payload as Prisma.InputJsonValue,
        },
      });
    });
  }

  async countOutboxByAggregate(aggregateId: string): Promise<number> {
    return this.prisma.outbox.count({ where: { aggregateId } });
  }
}

type VideoRow = {
  id: string;
  userId: string;
  fileName: string;
  contentType: string;
  sizeBytes: bigint;
  fps: Prisma.Decimal;
  status: Video['status'];
  inputKey: string;
  outputKey: string | null;
  frameCount: number | null;
  zipSizeBytes: bigint | null;
  failureCode: string | null;
  failureMessage: string | null;
  correlationId: string;
  createdAt: Date;
  updatedAt: Date;
  queuedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
};

function toCreateData(video: Video) {
  return {
    id: video.id,
    userId: video.userId,
    fileName: video.file.fileName,
    contentType: video.file.contentType,
    sizeBytes: video.file.sizeBytes,
    fps: new Prisma.Decimal(video.fps.value),
    status: video.status,
    inputKey: video.inputKey,
    outputKey: video.outputKey,
    frameCount: video.frameCount,
    zipSizeBytes: video.zipSizeBytes,
    failureCode: video.failureCode,
    failureMessage: video.failureMessage,
    correlationId: video.correlationId,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
    queuedAt: video.queuedAt,
    startedAt: video.startedAt,
    completedAt: video.completedAt,
  };
}

function toDomain(row: VideoRow): Video {
  const file = VideoFile.create({
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
  });
  if (!file.ok) {
    throw new Error(`Persisted video ${row.id} has invalid file metadata`);
  }
  const fps = Fps.create(Number(row.fps));
  if (!fps.ok) {
    throw new Error(`Persisted video ${row.id} has invalid fps`);
  }
  return Video.rehydrate({
    id: row.id,
    userId: row.userId,
    file: file.value,
    fps: fps.value,
    inputKey: row.inputKey,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
    status: row.status,
    updatedAt: row.updatedAt,
    outputKey: row.outputKey,
    frameCount: row.frameCount,
    zipSizeBytes: row.zipSizeBytes,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  });
}
