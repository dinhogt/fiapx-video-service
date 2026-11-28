/* eslint-disable @typescript-eslint/require-await */
import { GetVideoUseCase } from './get-video.use-case';
import { Fps } from '../domain/fps';
import type { VideoRepository } from '../domain/ports/video-repository';
import { Video } from '../domain/video';
import { VideoFile } from '../domain/video-file';

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
  });
}

describe('GetVideoUseCase (AC-80)', () => {
  it('returns VideoView for the owner', async () => {
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdForUser: jest.fn(async () => makeVideo()),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
    };
    const result = await new GetVideoUseCase(videos).execute({ videoId, userId });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.videoId).toBe(videoId);
    expect(result.value.fileName).toBe('demo.mp4');
  });

  it('returns VIDEO_NOT_FOUND for non-owner / missing', async () => {
    const videos: VideoRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdForUser: jest.fn(async () => null),
      queueWithOutbox: jest.fn(),
      countOutboxByAggregate: jest.fn(),
      listByUser: jest.fn(async () => []),
    };
    const result = await new GetVideoUseCase(videos).execute({ videoId, userId });
    expect(result).toEqual({ ok: false, code: 'VIDEO_NOT_FOUND' });
  });
});
