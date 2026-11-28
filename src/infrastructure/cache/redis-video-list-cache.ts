import { Injectable, Logger } from '@nestjs/common';
import type { CachedVideoList, VideoListCache } from '../../domain/ports/video-list-cache';
import { RedisService } from './redis.service';

const LIST_TTL_SECONDS = 30;

@Injectable()
export class RedisVideoListCache implements VideoListCache {
  private readonly logger = new Logger(RedisVideoListCache.name);

  constructor(private readonly redis: RedisService) {}

  async getVersion(userId: string): Promise<string> {
    try {
      const value = await this.redis.client.get(versionKey(userId));
      return value ?? '0';
    } catch (error: unknown) {
      this.logger.warn(`list cache getVersion fail-open: ${messageOf(error)}`);
      return '0';
    }
  }

  async bumpVersion(userId: string): Promise<void> {
    try {
      await this.redis.client.incr(versionKey(userId));
    } catch (error: unknown) {
      this.logger.warn(`list cache bumpVersion fail-open: ${messageOf(error)}`);
    }
  }

  async getList(
    userId: string,
    version: string,
    cursor: string,
    limit: number,
  ): Promise<CachedVideoList | null> {
    try {
      const raw = await this.redis.client.get(listKey(userId, version, cursor, limit));
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as CachedVideoList;
    } catch (error: unknown) {
      this.logger.warn(`list cache getList fail-open: ${messageOf(error)}`);
      return null;
    }
  }

  async setList(
    userId: string,
    version: string,
    cursor: string,
    limit: number,
    value: CachedVideoList,
  ): Promise<void> {
    try {
      await this.redis.client.set(
        listKey(userId, version, cursor, limit),
        JSON.stringify(value),
        'EX',
        LIST_TTL_SECONDS,
      );
    } catch (error: unknown) {
      this.logger.warn(`list cache setList fail-open: ${messageOf(error)}`);
    }
  }
}

function versionKey(userId: string): string {
  return `videos:ver:${userId}`;
}

function listKey(userId: string, version: string, cursor: string, limit: number): string {
  return `videos:list:${userId}:${version}:${cursor}:${limit}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
