export type VideoCursor = {
  createdAt: Date;
  id: string;
};

/** B1: cursor = base64url(createdAt|id). */
export function encodeVideoCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeVideoCursor(raw: string): VideoCursor | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const sep = decoded.lastIndexOf('|');
    if (sep <= 0 || sep === decoded.length - 1) {
      return null;
    }
    const createdAt = new Date(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
      return null;
    }
    return { createdAt, id };
  } catch {
    return null;
  }
}
