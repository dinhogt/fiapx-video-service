/**
 * S-02 / B7: suggested zip name from original fileName.
 * ASCII filename uses [A-Za-z0-9._-], max 100, fallback `video`.
 */
const SAFE_STEM = /[^A-Za-z0-9._-]+/g;
const MAX_STEM = 100;

export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) {
    return fileName;
  }
  return fileName.slice(0, dot);
}

export function sanitizeDownloadStem(fileName: string): string {
  const stem = stripExtension(fileName.trim());
  const sanitized = stem.replace(SAFE_STEM, '').slice(0, MAX_STEM);
  return sanitized.length > 0 ? sanitized : 'video';
}

export function buildFramesZipFileName(fileName: string): string {
  return `${sanitizeDownloadStem(fileName)}_frames.zip`;
}

/** RFC 5987 Content-Disposition for attachment downloads (S-02). */
export function buildContentDisposition(fileName: string): string {
  const zipName = buildFramesZipFileName(fileName);
  const encoded = encodeURIComponent(zipName);
  return `attachment; filename="${zipName}"; filename*=UTF-8''${encoded}`;
}
