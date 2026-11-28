import type { VideoView } from '../video-view';

export type CachedVideoList = {
  items: VideoView[];
  nextCursor: string | null;
};

/**
 * Versioned list cache (B6). All methods must fail-open: never throw to callers
 * when Redis is unavailable.
 */
export interface VideoListCache {
  getVersion(userId: string): Promise<string>;
  bumpVersion(userId: string): Promise<void>;
  getList(
    userId: string,
    version: string,
    cursor: string,
    limit: number,
  ): Promise<CachedVideoList | null>;
  setList(
    userId: string,
    version: string,
    cursor: string,
    limit: number,
    value: CachedVideoList,
  ): Promise<void>;
}
