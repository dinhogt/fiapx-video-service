import type { VideoRepository } from '../domain/ports/video-repository';
import { failure, type Result, success } from '../domain/result';
import { toVideoView, type VideoView } from '../domain/video-view';

export type GetVideoCommand = {
  videoId: string;
  userId: string;
};

export class GetVideoUseCase {
  constructor(private readonly videos: VideoRepository) {}

  async execute(command: GetVideoCommand): Promise<Result<VideoView>> {
    const video = await this.videos.findByIdForUser(command.videoId, command.userId);
    if (!video) {
      return failure('VIDEO_NOT_FOUND');
    }
    return success(toVideoView(video));
  }
}
