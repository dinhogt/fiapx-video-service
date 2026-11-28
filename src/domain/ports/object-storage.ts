export interface ObjectStoragePort {
  /** Returns true when HeadObject succeeds (object exists). */
  exists(bucket: string, key: string): Promise<boolean>;
}
