import type { Video } from '../video';

export type OutboxInsert = {
  aggregateId: string;
  type: string;
  destination: string;
  payload: unknown;
};

export interface VideoRepository {
  save(video: Video): Promise<void>;
  findById(id: string): Promise<Video | null>;
  findByIdForUser(id: string, userId: string): Promise<Video | null>;
  /** PENDING_UPLOAD → QUEUED and outbox insert in one transaction (AC-21). */
  queueWithOutbox(video: Video, outbox: OutboxInsert): Promise<void>;
  countOutboxByAggregate(aggregateId: string): Promise<number>;
}
