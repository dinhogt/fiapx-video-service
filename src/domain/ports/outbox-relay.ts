/** Optional kick so writers can shorten the ≤1s poll lag after commit (B6). */
export interface OutboxRelay {
  kick(): void;
}
