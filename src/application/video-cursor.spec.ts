import { decodeVideoCursor, encodeVideoCursor } from './video-cursor';

describe('video-cursor', () => {
  it('round-trips createdAt|id', () => {
    const createdAt = new Date('2026-11-28T12:00:00.000Z');
    const id = '22222222-2222-4222-8222-222222222222';
    const encoded = encodeVideoCursor(createdAt, id);
    expect(decodeVideoCursor(encoded)).toEqual({ createdAt, id });
  });

  it('rejects malformed cursors', () => {
    expect(decodeVideoCursor('')).toBeNull();
    expect(decodeVideoCursor('not-base64')).toBeNull();
    expect(decodeVideoCursor(Buffer.from('only-one', 'utf8').toString('base64url'))).toBeNull();
  });
});
