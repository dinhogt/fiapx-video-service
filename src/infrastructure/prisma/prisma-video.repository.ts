import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Fps } from '../../domain/fps';
import type { VideoRepository } from '../../domain/ports/video-repository';
import { Video } from '../../domain/video';
import { VideoFile } from '../../domain/video-file';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaVideoRepository implements VideoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(video: Video): Promise<void> {
    await this.prisma.video.create({
      data: {
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
      },
    });
  }

  async findById(id: string): Promise<Video | null> {
    const row = await this.prisma.video.findUnique({ where: { id } });
    if (!row) {
      return null;
    }
    const file = VideoFile.create({
      fileName: row.fileName,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
    });
    if (!file.ok) {
      throw new Error(`Persisted video ${id} has invalid file metadata`);
    }
    const fps = Fps.create(Number(row.fps));
    if (!fps.ok) {
      throw new Error(`Persisted video ${id} has invalid fps`);
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
}
