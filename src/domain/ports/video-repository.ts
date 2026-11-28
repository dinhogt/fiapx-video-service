import type { Video } from '../video';

export interface VideoRepository {
  save(video: Video): Promise<void>;
  findById(id: string): Promise<Video | null>;
}
