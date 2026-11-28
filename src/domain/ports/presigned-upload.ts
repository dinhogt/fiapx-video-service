export type PresignedPostUpload = {
  url: string;
  method: 'POST';
  fields: Record<string, string>;
  expiresAt: Date;
};

export type CreatePresignedPostCommand = {
  bucket: string;
  key: string;
  contentType: string;
  maxSizeBytes: number;
  expiresInSeconds: number;
};

export interface PresignedUploadPort {
  createPost(command: CreatePresignedPostCommand): Promise<PresignedPostUpload>;
}
