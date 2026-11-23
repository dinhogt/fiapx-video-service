import { z } from 'zod';

export const FailureCode = {
  INPUT_NOT_FOUND: 'INPUT_NOT_FOUND',
  INVALID_VIDEO: 'INVALID_VIDEO',
  VIDEO_TOO_LONG: 'VIDEO_TOO_LONG',
  NO_FRAMES: 'NO_FRAMES',
  TIMEOUT: 'TIMEOUT',
  PROCESSING_ERROR: 'PROCESSING_ERROR',
} as const;

export type FailureCode = (typeof FailureCode)[keyof typeof FailureCode];

export const failureCodeSchema = z.enum([
  FailureCode.INPUT_NOT_FOUND,
  FailureCode.INVALID_VIDEO,
  FailureCode.VIDEO_TOO_LONG,
  FailureCode.NO_FRAMES,
  FailureCode.TIMEOUT,
  FailureCode.PROCESSING_ERROR,
]);
