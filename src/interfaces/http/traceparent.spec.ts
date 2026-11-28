import { buildTraceparent } from './traceparent';

describe('buildTraceparent', () => {
  it('keeps a valid incoming traceparent', () => {
    const value = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';
    expect(buildTraceparent(value)).toBe(value);
  });

  it('generates a valid W3C traceparent when missing or invalid', () => {
    expect(buildTraceparent(undefined)).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
    expect(buildTraceparent('bad')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });
});
