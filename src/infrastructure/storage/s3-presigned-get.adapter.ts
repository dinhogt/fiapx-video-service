import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type {
  CreatePresignedGetCommand,
  PresignedDownloadPort,
  PresignedGetDownload,
} from '../../domain/ports/presigned-download';
import type { VideoEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';

/**
 * Signs GET URLs with S3_PUBLIC_ENDPOINT so clients can reach LocalStack (B7).
 */
@Injectable()
export class S3PresignedGetAdapter implements PresignedDownloadPort {
  private readonly client: S3Client;

  constructor(@Inject(APP_ENV_CONFIG) env: VideoEnv) {
    this.client = new S3Client({
      region: env.AWS_REGION,
      endpoint: env.S3_PUBLIC_ENDPOINT,
      forcePathStyle: true,
      credentials:
        env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.AWS_ACCESS_KEY_ID,
              secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  async createGet(command: CreatePresignedGetCommand): Promise<PresignedGetDownload> {
    const expiresAt = new Date(Date.now() + command.expiresInSeconds * 1000);
    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: command.bucket,
        Key: command.key,
        ResponseContentDisposition: command.responseContentDisposition,
      }),
      { expiresIn: command.expiresInSeconds },
    );
    return { url, expiresAt };
  }
}
