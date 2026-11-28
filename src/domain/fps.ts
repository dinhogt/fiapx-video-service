import { failure, type Result, success } from './result';

/** D09 / B1: optional fps, default 1, range 0.1–5 in steps of 0.1. */
export const FPS_DEFAULT = 1;
export const FPS_MIN = 0.1;
export const FPS_MAX = 5;

export class Fps {
  private constructor(readonly value: number) {}

  static default(): Fps {
    return new Fps(FPS_DEFAULT);
  }

  static create(raw: number | undefined | null): Result<Fps> {
    if (raw === undefined || raw === null) {
      return success(Fps.default());
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return failure('INVALID_FPS');
    }
    const tenths = Math.round(raw * 10);
    if (Math.abs(raw * 10 - tenths) > 1e-8) {
      return failure('INVALID_FPS');
    }
    const value = tenths / 10;
    if (value < FPS_MIN || value > FPS_MAX) {
      return failure('INVALID_FPS');
    }
    return success(new Fps(value));
  }

  equals(other: Fps): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return String(this.value);
  }
}
