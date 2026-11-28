import { decodeVideoCursor, encodeVideoCursor } from './video-cursor';
import type { VideoListCache } from '../domain/ports/video-list-cache';
import type { VideoRepository } from '../domain/ports/video-repository';
import { failure, type Result, success } from '../domain/result';
import { toVideoView, type VideoView } from '../domain/video-view';

export type ListVideosCommand = {
  userId: string;
  limit?: number;
  cursor?: string;
};

export type ListVideosResult = {
  items: VideoView[];
  nextCursor: string | null;
};

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

export class ListVideosUseCase {
  constructor(
    private readonly videos: VideoRepository,
    private readonly cache: VideoListCache,
  ) {}

  async execute(command: ListVideosCommand): Promise<Result<ListVideosResult>> {
    const limit = command.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
      return failure('INVALID_LIMIT');
    }

    const cursorRaw = command.cursor?.trim() ?? '';
    let cursor: { createdAt: Date; id: string } | undefined;
    if (cursorRaw.length > 0) {
      const decoded = decodeVideoCursor(cursorRaw);
      if (!decoded) {
        return failure('INVALID_CURSOR');
      }
      cursor = decoded;
    }

    const version = await this.cache.getVersion(command.userId);
    const cached = await this.cache.getList(command.userId, version, cursorRaw, limit);
    if (cached) {
      return success(cached);
    }

    const rows = await this.videos.listByUser({
      userId: command.userId,
      limit,
      cursor,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const result: ListVideosResult = {
      items: page.map(toVideoView),
      nextCursor: hasMore && last ? encodeVideoCursor(last.createdAt, last.id) : null,
    };

    await this.cache.setList(command.userId, version, cursorRaw, limit, result);
    return success(result);
  }
}
