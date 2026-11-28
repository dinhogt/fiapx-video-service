import type { Video } from './video';

/** B1: outputExpiresAt = completedAt + 7 days (E-03). */
export const OUTPUT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type VideoView = {
  videoId: string;
  fileName: string;
  status: Video['status'];
  fps: number;
  sizeBytes: number;
  frameCount?: number;
  zipSizeBytes?: number;
  failureCode?: string;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  outputExpiresAt?: string;
};

export function toVideoView(video: Video): VideoView {
  const view: VideoView = {
    videoId: video.id,
    fileName: video.file.fileName,
    status: video.status,
    fps: video.fps.value,
    sizeBytes: Number(video.file.sizeBytes),
    createdAt: video.createdAt.toISOString(),
    updatedAt: video.updatedAt.toISOString(),
  };
  if (video.frameCount !== null) {
    view.frameCount = video.frameCount;
  }
  if (video.zipSizeBytes !== null) {
    view.zipSizeBytes = Number(video.zipSizeBytes);
  }
  if (video.failureCode) {
    view.failureCode = video.failureCode;
  }
  if (video.failureMessage) {
    view.failureMessage = video.failureMessage;
  }
  if (video.completedAt) {
    view.completedAt = video.completedAt.toISOString();
    view.outputExpiresAt = new Date(video.completedAt.getTime() + OUTPUT_TTL_MS).toISOString();
  }
  return view;
}
