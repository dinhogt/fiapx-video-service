import type { Video } from '../video';

export type OutboxInsert = {
  aggregateId: string;
  type: string;
  destination: string;
  payload: unknown;
};

export type ListVideosQuery = {
  userId: string;
  limit: number;
  cursor?: { createdAt: Date; id: string };
};

export interface VideoRepository {
  save(video: Video): Promise<void>;
  findById(id: string): Promise<Video | null>;
  findByIdForUser(id: string, userId: string): Promise<Video | null>;
  /** PENDING_UPLOAD → QUEUED and outbox insert in one transaction (AC-21). */
  queueWithOutbox(video: Video, outbox: OutboxInsert): Promise<void>;
  countOutboxByAggregate(aggregateId: string): Promise<number>;
  /** createdAt DESC, id DESC; returns up to limit+1 rows for nextCursor detection. */
  listByUser(query: ListVideosQuery): Promise<Video[]>;
  /**
   * Inbox + optional video update in one transaction (B2).
   * Returns `duplicate` when messageId already exists (idempotent).
   */
  recordInboxAndMaybeUpdate(input: {
    messageId: string;
    type: string;
    video?: Video;
  }): Promise<'duplicate' | 'saved'>;
}
