import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { Inject, Injectable } from '@nestjs/common';
import type {
  CreatePresignedPostCommand,
  PresignedPostUpload,
  PresignedUploadPort,
} from '../../domain/ports/presigned-upload';
import type { VideoEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';

/**
 * Signs POST policies with S3_PUBLIC_ENDPOINT so Postman/clients can reach LocalStack (B7).
 * Internal S3 ops (HEAD/Get) use AWS_ENDPOINT via a separate client when needed.
 */
@Injectable()
export class S3PresignedPostAdapter implements PresignedUploadPort {
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

  async createPost(command: CreatePresignedPostCommand): Promise<PresignedPostUpload> {
    const expiresAt = new Date(Date.now() + command.expiresInSeconds * 1000);
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: command.bucket,
      Key: command.key,
      Conditions: [
        ['content-length-range', 1, command.maxSizeBytes],
        ['eq', '$Content-Type', command.contentType],
      ],
      Fields: {
        key: command.key,
        'Content-Type': command.contentType,
      },
      Expires: command.expiresInSeconds,
    });

    return {
      url,
      method: 'POST',
      fields,
      expiresAt,
    };
  }
}
