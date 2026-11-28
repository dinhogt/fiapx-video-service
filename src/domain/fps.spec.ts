import { FPS_DEFAULT, FPS_MAX, FPS_MIN, Fps } from './fps';

function expectFps(raw: number | undefined | null, expected: number): void {
  const result = Fps.create(raw);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return;
  }
  expect(result.value.value).toBe(expected);
}

describe('Fps', () => {
  it('defaults to 1 when omitted', () => {
    expectFps(undefined, FPS_DEFAULT);
    expectFps(null, FPS_DEFAULT);
    expect(Fps.default().value).toBe(1);
  });

  it('accepts bounds and 0.1 steps', () => {
    expectFps(0.1, FPS_MIN);
    expectFps(5, FPS_MAX);
    expectFps(2.5, 2.5);
    const a = Fps.create(0.1);
    const b = Fps.create(0.1);
    expect(a.ok && b.ok && a.value.equals(b.value)).toBe(true);
  });

  it('rejects out of range, non-multiples, and non-finite', () => {
    expect(Fps.create(0).ok).toBe(false);
    expect(Fps.create(5.1).ok).toBe(false);
    expect(Fps.create(1.15).ok).toBe(false);
    expect(Fps.create(Number.NaN).ok).toBe(false);
    expect(Fps.create(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(Fps.create('1' as unknown as number).ok).toBe(false);
  });

  it('stringifies the numeric value', () => {
    const fps = Fps.create(1.2);
    expect(fps.ok).toBe(true);
    if (fps.ok) {
      expect(fps.value.toString()).toBe('1.2');
    }
  });
});
