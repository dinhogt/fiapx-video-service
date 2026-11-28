import { MAX_VIDEO_SIZE_BYTES, VIDEO_CONTENT_TYPES, VideoFile } from './video-file';

describe('VideoFile', () => {
  it('accepts each allowed extension with matching content-type', () => {
    for (const [ext, contentType] of Object.entries(VIDEO_CONTENT_TYPES)) {
      const result = VideoFile.create({
        fileName: `clip.${ext}`,
        contentType,
        sizeBytes: 1024,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.extension).toBe(ext);
        expect(result.value.contentType).toBe(contentType);
        expect(result.value.sizeBytes).toBe(1024n);
        expect(result.value.inputExtension).toBe(ext);
      }
    }
  });

  it('normalizes extension case', () => {
    const result = VideoFile.create({
      fileName: 'Demo.MP4',
      contentType: 'video/mp4',
      sizeBytes: 10,
    });
    expect(result.ok && result.value.extension).toBe('mp4');
  });

  it('rejects path separators and empty/too-long names', () => {
    expect(
      VideoFile.create({ fileName: 'a/b.mp4', contentType: 'video/mp4', sizeBytes: 1 }).ok,
    ).toBe(false);
    expect(
      VideoFile.create({ fileName: 'a\\b.mp4', contentType: 'video/mp4', sizeBytes: 1 }).ok,
    ).toBe(false);
    expect(VideoFile.create({ fileName: '', contentType: 'video/mp4', sizeBytes: 1 }).ok).toBe(
      false,
    );
    expect(
      VideoFile.create({
        fileName: `${'a'.repeat(252)}.mp4`,
        contentType: 'video/mp4',
        sizeBytes: 1,
      }).ok,
    ).toBe(false);
  });

  it('rejects unknown extension and content-type mismatch', () => {
    expect(
      VideoFile.create({ fileName: 'clip.wmv', contentType: 'video/x-ms-wmv', sizeBytes: 1 }).ok,
    ).toBe(false);
    expect(
      VideoFile.create({ fileName: 'clip.mp4', contentType: 'video/webm', sizeBytes: 1 }).ok,
    ).toBe(false);
    expect(VideoFile.create({ fileName: 'clip', contentType: 'video/mp4', sizeBytes: 1 }).ok).toBe(
      false,
    );
  });

  it('rejects size outside 1..500MB', () => {
    expect(VideoFile.create({ fileName: 'a.mp4', contentType: 'video/mp4', sizeBytes: 0 }).ok).toBe(
      false,
    );
    expect(
      VideoFile.create({
        fileName: 'a.mp4',
        contentType: 'video/mp4',
        sizeBytes: MAX_VIDEO_SIZE_BYTES + 1,
      }).ok,
    ).toBe(false);
    expect(
      VideoFile.create({
        fileName: 'a.mp4',
        contentType: 'video/mp4',
        sizeBytes: BigInt(MAX_VIDEO_SIZE_BYTES),
      }).ok,
    ).toBe(true);
  });
});
