import { buildOutputKey, buildRawInputKey } from './video-keys';

describe('video-keys (B7)', () => {
  it('builds raw/{userId}/{videoId}.{ext}', () => {
    expect(buildRawInputKey('u1', 'v1', 'mp4')).toBe('raw/u1/v1.mp4');
  });

  it('builds output/{userId}/{videoId}/frames.zip', () => {
    expect(buildOutputKey('u1', 'v1')).toBe('output/u1/v1/frames.zip');
  });
});
