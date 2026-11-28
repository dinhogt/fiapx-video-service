export type CreatePresignedGetCommand = {
  bucket: string;
  key: string;
  expiresInSeconds: number;
  responseContentDisposition: string;
};

export type PresignedGetDownload = {
  url: string;
  expiresAt: Date;
};

export interface PresignedDownloadPort {
  createGet(command: CreatePresignedGetCommand): Promise<PresignedGetDownload>;
}
