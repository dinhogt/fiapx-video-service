import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';
import type { ObjectStoragePort } from '../../domain/ports/object-storage';
import type { VideoEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';

/**
 * Internal S3 ops use AWS_ENDPOINT (LocalStack service DNS) with forcePathStyle (B7).
 */
@Injectable()
export class S3ObjectStorageAdapter implements ObjectStoragePort {
  private readonly client: S3Client;

  constructor(@Inject(APP_ENV_CONFIG) env: VideoEnv) {
    this.client = new S3Client({
      region: env.AWS_REGION,
      endpoint: env.AWS_ENDPOINT ?? env.S3_PUBLIC_ENDPOINT,
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

  async exists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error: unknown) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      const name = error instanceof Error ? error.name : '';
      if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') {
        return false;
      }
      throw error;
    }
  }
}
