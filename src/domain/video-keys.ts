import type { VideoExtension } from './video-file';

/** B7: raw/{userId}/{videoId}.{ext} — key always defined by the server. */
export function buildRawInputKey(userId: string, videoId: string, extension: VideoExtension): string {
  return `raw/${userId}/${videoId}.${extension}`;
}

export function buildOutputKey(userId: string, videoId: string): string {
  return `output/${userId}/${videoId}/frames.zip`;
}
