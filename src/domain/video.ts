import { randomUUID } from 'node:crypto';
import type { Fps } from './fps';
import { failure, type Result, success } from './result';
import type { VideoFile } from './video-file';

/** D26 / RF-14 / T02 */
export type VideoStatus =
  'PENDING_UPLOAD' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

const ALLOWED_TRANSITIONS: Readonly<Record<VideoStatus, ReadonlySet<VideoStatus>>> = {
  PENDING_UPLOAD: new Set(['QUEUED', 'EXPIRED']),
  QUEUED: new Set(['PROCESSING', 'COMPLETED', 'FAILED']),
  PROCESSING: new Set(['COMPLETED', 'FAILED']),
  COMPLETED: new Set(),
  FAILED: new Set(),
  EXPIRED: new Set(),
};

export type VideoCompleteProps = {
  frameCount: number;
  zipSizeBytes: bigint;
  outputKey: string;
};

export class Video {
  private constructor(
    readonly id: string,
    readonly userId: string,
    readonly file: VideoFile,
    readonly fps: Fps,
    readonly inputKey: string,
    readonly correlationId: string,
    readonly createdAt: Date,
    private _status: VideoStatus,
    private _updatedAt: Date,
    private _outputKey: string | null,
    private _frameCount: number | null,
    private _zipSizeBytes: bigint | null,
    private _failureCode: string | null,
    private _failureMessage: string | null,
    private _queuedAt: Date | null,
    private _startedAt: Date | null,
    private _completedAt: Date | null,
  ) {}

  get status(): VideoStatus {
    return this._status;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get outputKey(): string | null {
    return this._outputKey;
  }

  get frameCount(): number | null {
    return this._frameCount;
  }

  get zipSizeBytes(): bigint | null {
    return this._zipSizeBytes;
  }

  get failureCode(): string | null {
    return this._failureCode;
  }

  get failureMessage(): string | null {
    return this._failureMessage;
  }

  get queuedAt(): Date | null {
    return this._queuedAt;
  }

  get startedAt(): Date | null {
    return this._startedAt;
  }

  get completedAt(): Date | null {
    return this._completedAt;
  }

  static create(props: {
    userId: string;
    file: VideoFile;
    fps: Fps;
    inputKey: string;
    correlationId?: string;
    id?: string;
    now?: Date;
  }): Video {
    const now = props.now ?? new Date();
    return new Video(
      props.id ?? randomUUID(),
      props.userId,
      props.file,
      props.fps,
      props.inputKey,
      props.correlationId ?? randomUUID(),
      now,
      'PENDING_UPLOAD',
      now,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    );
  }

  static rehydrate(props: {
    id: string;
    userId: string;
    file: VideoFile;
    fps: Fps;
    inputKey: string;
    correlationId: string;
    createdAt: Date;
    status: VideoStatus;
    updatedAt: Date;
    outputKey: string | null;
    frameCount: number | null;
    zipSizeBytes: bigint | null;
    failureCode: string | null;
    failureMessage: string | null;
    queuedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }): Video {
    return new Video(
      props.id,
      props.userId,
      props.file,
      props.fps,
      props.inputKey,
      props.correlationId,
      props.createdAt,
      props.status,
      props.updatedAt,
      props.outputKey,
      props.frameCount,
      props.zipSizeBytes,
      props.failureCode,
      props.failureMessage,
      props.queuedAt,
      props.startedAt,
      props.completedAt,
    );
  }

  canTransitionTo(next: VideoStatus): boolean {
    return ALLOWED_TRANSITIONS[this._status].has(next);
  }

  /** PENDING_UPLOAD → QUEUED (confirm). */
  queue(now: Date = new Date()): Result<Video> {
    const applied = this.applyTransition('QUEUED', now);
    if (!applied.ok) {
      return applied;
    }
    this._queuedAt = now;
    return success(this);
  }

  /** PENDING_UPLOAD → EXPIRED (RF-15). */
  expire(now: Date = new Date()): Result<Video> {
    return this.applyTransition('EXPIRED', now);
  }

  /** QUEUED → PROCESSING. */
  markProcessing(now: Date = new Date()): Result<Video> {
    const applied = this.applyTransition('PROCESSING', now);
    if (!applied.ok) {
      return applied;
    }
    this._startedAt = now;
    return success(this);
  }

  /** QUEUED | PROCESSING → COMPLETED (out-of-order COMPLETED from QUEUED is allowed). */
  complete(props: VideoCompleteProps, now: Date = new Date()): Result<Video> {
    const applied = this.applyTransition('COMPLETED', now);
    if (!applied.ok) {
      return applied;
    }
    this._frameCount = props.frameCount;
    this._zipSizeBytes = props.zipSizeBytes;
    this._outputKey = props.outputKey;
    this._completedAt = now;
    this._failureCode = null;
    this._failureMessage = null;
    return success(this);
  }

  /** QUEUED | PROCESSING → FAILED. */
  fail(code: string, message: string, now: Date = new Date()): Result<Video> {
    const applied = this.applyTransition('FAILED', now);
    if (!applied.ok) {
      return applied;
    }
    this._failureCode = code;
    this._failureMessage = message.slice(0, 500);
    this._completedAt = now;
    return success(this);
  }

  private applyTransition(next: VideoStatus, now: Date): Result<Video> {
    if (!this.canTransitionTo(next)) {
      return failure('INVALID_TRANSITION');
    }
    this._status = next;
    this._updatedAt = now;
    return success(this);
  }
}
