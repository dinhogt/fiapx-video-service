import {
  buildContentDisposition,
  buildFramesZipFileName,
  sanitizeDownloadStem,
} from './download-filename';

describe('download-filename (S-02)', () => {
  it('sanitizes header-injection fileName a"\\r\\nX: y.mp4', () => {
    const malicious = 'a"\r\nX: y.mp4';
    expect(sanitizeDownloadStem(malicious)).toBe('aXy');
    expect(buildFramesZipFileName(malicious)).toBe('aXy_frames.zip');

    const disposition = buildContentDisposition(malicious);
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).not.toContain('"X:');
    expect(disposition).toBe(
      `attachment; filename="aXy_frames.zip"; filename*=UTF-8''aXy_frames.zip`,
    );
  });

  it('falls back to video when stem is empty after sanitize', () => {
    expect(buildFramesZipFileName('!!!@@@.mp4')).toBe('video_frames.zip');
    expect(buildFramesZipFileName('noext')).toBe('noext_frames.zip');
  });

  it('keeps safe characters and truncates to 100', () => {
    const long = `${'a'.repeat(120)}.mp4`;
    expect(sanitizeDownloadStem(long)).toHaveLength(100);
    expect(buildFramesZipFileName('demo-clip_01.mp4')).toBe('demo-clip_01_frames.zip');
  });
});
