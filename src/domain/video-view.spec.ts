import { Fps } from './fps';
import { Video } from './video';
import { VideoFile } from './video-file';
import { OUTPUT_TTL_MS, toVideoView } from './video-view';

describe('toVideoView', () => {
  it('omits optional fields for pending upload', () => {
    const file = VideoFile.create({
      fileName: 'a.mp4',
      contentType: 'video/mp4',
      sizeBytes: 5,
    });
    if (!file.ok) {
      throw new Error('fixture');
    }
    const fps = Fps.create(1);
    if (!fps.ok) {
      throw new Error('fixture');
    }
    const video = Video.create({
      id: '22222222-2222-4222-8222-222222222222',
      userId: '11111111-1111-4111-8111-111111111111',
      file: file.value,
      fps: fps.value,
      inputKey: 'raw/u/v.mp4',
    });
    const view = toVideoView(video);
    expect(view.frameCount).toBeUndefined();
    expect(view.completedAt).toBeUndefined();
    expect(view.outputExpiresAt).toBeUndefined();
  });

  it('maps completed video with outputExpiresAt', () => {
    const file = VideoFile.create({
      fileName: 'a.mp4',
      contentType: 'video/mp4',
      sizeBytes: 5,
    });
    if (!file.ok) {
      throw new Error('fixture');
    }
    const fps = Fps.create(1);
    if (!fps.ok) {
      throw new Error('fixture');
    }
    const video = Video.create({
      id: '22222222-2222-4222-8222-222222222222',
      userId: '11111111-1111-4111-8111-111111111111',
      file: file.value,
      fps: fps.value,
      inputKey: 'raw/u/v.mp4',
    });
    video.queue();
    const completedAt = new Date('2026-11-28T12:00:00.000Z');
    video.complete(
      { frameCount: 3, zipSizeBytes: 100n, outputKey: 'output/u/v/frames.zip' },
      completedAt,
    );

    const view = toVideoView(video);
    expect(view.status).toBe('COMPLETED');
    expect(view.frameCount).toBe(3);
    expect(view.zipSizeBytes).toBe(100);
    expect(view.completedAt).toBe(completedAt.toISOString());
    expect(view.outputExpiresAt).toBe(
      new Date(completedAt.getTime() + OUTPUT_TTL_MS).toISOString(),
    );
  });
});
