import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Inject, Injectable } from '@nestjs/common';
import type { MessagePublisher, PublishMessageInput } from '../../domain/ports/message-publisher';
import type { VideoEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';

@Injectable()
export class SqsMessagePublisher implements MessagePublisher {
  private readonly client: SQSClient;

  constructor(@Inject(APP_ENV_CONFIG) env: VideoEnv) {
    this.client = new SQSClient({
      region: env.AWS_REGION,
      endpoint: env.AWS_ENDPOINT,
      credentials:
        env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.AWS_ACCESS_KEY_ID,
              secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  async publish(input: PublishMessageInput): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: input.destination,
        MessageBody: JSON.stringify(input.body),
        MessageAttributes: {
          type: {
            DataType: 'String',
            StringValue: input.type,
          },
        },
      }),
    );
  }
}
