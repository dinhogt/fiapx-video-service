/* eslint-disable @typescript-eslint/require-await */
import { readTraceparentFromBody, withMessageTraceparent } from './trace-context';

describe('trace-context', () => {
  it('readTraceparentFromBody extracts the envelope field', () => {
    expect(readTraceparentFromBody({ traceparent: '00-aa' })).toBe('00-aa');
    expect(readTraceparentFromBody({})).toBeUndefined();
    expect(readTraceparentFromBody(null)).toBeUndefined();
    expect(readTraceparentFromBody('x')).toBeUndefined();
  });

  it('withMessageTraceparent runs the callback with or without carrier', async () => {
    await expect(withMessageTraceparent(undefined, async () => 1)).resolves.toBe(1);
    await expect(
      withMessageTraceparent(
        '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
        async () => 2,
      ),
    ).resolves.toBe(2);
  });
});
