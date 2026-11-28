import { Fps } from './fps';
import type { VideoStatus } from './video';
import { Video } from './video';
import { VideoFile } from './video-file';

function sampleFile(): VideoFile {
  const file = VideoFile.create({
    fileName: 'demo.mp4',
    contentType: 'video/mp4',
    sizeBytes: 2048,
  });
  if (!file.ok) {
    throw new Error('fixture VideoFile');
  }
  return file.value;
}

function sampleFps(): Fps {
  const fps = Fps.create(1);
  if (!fps.ok) {
    throw new Error('fixture Fps');
  }
  return fps.value;
}

function newVideo(now = new Date('2026-01-01T00:00:00.000Z')): Video {
  return Video.create({
    userId: '11111111-1111-4111-8111-111111111111',
    file: sampleFile(),
    fps: sampleFps(),
    inputKey: 'raw/11111111-1111-4111-8111-111111111111/demo.mp4',
    correlationId: '22222222-2222-4222-8222-222222222222',
    now,
  });
}

const COMPLETE_PROPS = {
  frameCount: 5,
  zipSizeBytes: 10_000n,
  outputKey: 'output/11111111-1111-4111-8111-111111111111/frames.zip',
};

describe('Video state machine (D26 / RF-14)', () => {
  const t0 = new Date('2026-01-01T00:00:00.000Z');

  it('creates in PENDING_UPLOAD', () => {
    const video = newVideo(t0);
    expect(video.status).toBe('PENDING_UPLOAD');
    expect(video.createdAt).toEqual(t0);
    expect(video.queuedAt).toBeNull();
    expect(video.completedAt).toBeNull();
  });

  it('generates id, correlationId and now when omitted', () => {
    const video = Video.create({
      userId: '11111111-1111-4111-8111-111111111111',
      file: sampleFile(),
      fps: sampleFps(),
      inputKey: 'raw/x/demo.mp4',
    });
    expect(video.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(video.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(video.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(video.queue().ok).toBe(true);
  });

  it('uses default now on expire, processing, complete and fail', () => {
    const expired = newVideo(t0);
    expect(expired.expire().ok).toBe(true);

    const processing = newVideo(t0);
    processing.queue(t0);
    expect(processing.markProcessing().ok).toBe(true);

    const completed = newVideo(t0);
    completed.queue(t0);
    expect(completed.complete(COMPLETE_PROPS).ok).toBe(true);

    const failed = newVideo(t0);
    failed.queue(t0);
    expect(failed.fail('NO_FRAMES', 'empty').ok).toBe(true);
  });

  describe('valid transitions', () => {
    it('PENDING_UPLOAD → QUEUED', () => {
      const video = newVideo(t0);
      const later = new Date('2026-01-01T00:01:00.000Z');
      expect(video.queue(later).ok).toBe(true);
      expect(video.status).toBe('QUEUED');
      expect(video.queuedAt).toEqual(later);
      expect(video.updatedAt).toEqual(later);
    });

    it('PENDING_UPLOAD → EXPIRED', () => {
      const video = newVideo(t0);
      expect(video.expire(t0).ok).toBe(true);
      expect(video.status).toBe('EXPIRED');
    });

    it('QUEUED → PROCESSING', () => {
      const video = newVideo(t0);
      video.queue(t0);
      const started = new Date('2026-01-01T00:02:00.000Z');
      expect(video.markProcessing(started).ok).toBe(true);
      expect(video.status).toBe('PROCESSING');
      expect(video.startedAt).toEqual(started);
    });

    it('QUEUED → COMPLETED (out-of-order processed)', () => {
      const video = newVideo(t0);
      video.queue(t0);
      expect(video.complete(COMPLETE_PROPS, t0).ok).toBe(true);
      expect(video.status).toBe('COMPLETED');
      expect(video.frameCount).toBe(5);
      expect(video.zipSizeBytes).toBe(10_000n);
      expect(video.outputKey).toBe(COMPLETE_PROPS.outputKey);
      expect(video.completedAt).toEqual(t0);
    });

    it('QUEUED → FAILED', () => {
      const video = newVideo(t0);
      video.queue(t0);
      expect(video.fail('INVALID_VIDEO', 'no stream', t0).ok).toBe(true);
      expect(video.status).toBe('FAILED');
      expect(video.failureCode).toBe('INVALID_VIDEO');
      expect(video.failureMessage).toBe('no stream');
      expect(video.completedAt).toEqual(t0);
    });

    it('PROCESSING → COMPLETED', () => {
      const video = newVideo(t0);
      video.queue(t0);
      video.markProcessing(t0);
      expect(video.complete(COMPLETE_PROPS, t0).ok).toBe(true);
      expect(video.status).toBe('COMPLETED');
    });

    it('PROCESSING → FAILED', () => {
      const video = newVideo(t0);
      video.queue(t0);
      video.markProcessing(t0);
      expect(video.fail('TIMEOUT', 'ffmpeg timeout', t0).ok).toBe(true);
      expect(video.status).toBe('FAILED');
    });
  });

  describe('invalid transitions are rejected', () => {
    const terminal: VideoStatus[] = ['COMPLETED', 'FAILED', 'EXPIRED'];

    it('rejects PENDING_UPLOAD → PROCESSING|COMPLETED|FAILED', () => {
      const video = newVideo(t0);
      expect(video.markProcessing(t0).ok).toBe(false);
      expect(video.complete(COMPLETE_PROPS, t0).ok).toBe(false);
      expect(video.fail('X', 'y', t0).ok).toBe(false);
      expect(video.status).toBe('PENDING_UPLOAD');
    });

    it('rejects QUEUED → EXPIRED|QUEUED and PROCESSING → QUEUED|EXPIRED|PENDING_UPLOAD', () => {
      const queued = newVideo(t0);
      queued.queue(t0);
      expect(queued.expire(t0).ok).toBe(false);
      expect(queued.queue(t0).ok).toBe(false);

      const processing = newVideo(t0);
      processing.queue(t0);
      processing.markProcessing(t0);
      expect(processing.queue(t0).ok).toBe(false);
      expect(processing.expire(t0).ok).toBe(false);
      expect(processing.markProcessing(t0).ok).toBe(false);
    });

    it.each(terminal)('rejects any further transition from %s', (status) => {
      const video = newVideo(t0);
      if (status === 'EXPIRED') {
        video.expire(t0);
      } else if (status === 'COMPLETED') {
        video.queue(t0);
        video.complete(COMPLETE_PROPS, t0);
      } else {
        video.queue(t0);
        video.fail('INVALID_VIDEO', 'bad', t0);
      }
      expect(video.status).toBe(status);
      expect(video.queue(t0).ok).toBe(false);
      expect(video.expire(t0).ok).toBe(false);
      expect(video.markProcessing(t0).ok).toBe(false);
      expect(video.complete(COMPLETE_PROPS, t0).ok).toBe(false);
      expect(video.fail('X', 'y', t0).ok).toBe(false);
      expect(video.canTransitionTo('PROCESSING')).toBe(false);
    });

    it('truncates failure message to 500 chars', () => {
      const video = newVideo(t0);
      video.queue(t0);
      const long = 'x'.repeat(600);
      expect(video.fail('PROCESSING_ERROR', long, t0).ok).toBe(true);
      expect(video.failureMessage?.length).toBe(500);
    });
  });

  it('rehydrates persisted state', () => {
    const original = newVideo(t0);
    original.queue(t0);
    original.markProcessing(t0);
    original.complete(COMPLETE_PROPS, t0);
    const copy = Video.rehydrate({
      id: original.id,
      userId: original.userId,
      file: original.file,
      fps: original.fps,
      inputKey: original.inputKey,
      correlationId: original.correlationId,
      createdAt: original.createdAt,
      status: original.status,
      updatedAt: original.updatedAt,
      outputKey: original.outputKey,
      frameCount: original.frameCount,
      zipSizeBytes: original.zipSizeBytes,
      failureCode: original.failureCode,
      failureMessage: original.failureMessage,
      queuedAt: original.queuedAt,
      startedAt: original.startedAt,
      completedAt: original.completedAt,
    });
    expect(copy.status).toBe('COMPLETED');
    expect(copy.complete(COMPLETE_PROPS, t0).ok).toBe(false);
  });
});
