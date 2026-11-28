import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ApplyStatusEventUseCase } from '../../application/apply-status-event.use-case';
import type { VideoEnv } from '../config/env';
import { APP_ENV_CONFIG } from '../config/tokens';
import {
  readTraceparentFromBody,
  withMessageTraceparent,
} from '../observability/trace-context';

const POLL_INTERVAL_MS = 1_000;
const MAX_MESSAGES = 10;
const WAIT_TIME_SECONDS = 1;

@Injectable()
export class VideoStatusConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoStatusConsumerService.name);
  private readonly client: SQSClient;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly applyStatusEvent: ApplyStatusEventUseCase,
    @Inject(APP_ENV_CONFIG) private readonly env: VideoEnv,
  ) {
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

  onModuleInit(): void {
    if (this.env.APP_ENV === 'test' || this.env.NODE_ENV === 'test') {
      return;
    }
    this.timer = setInterval(() => {
      void this.drain();
    }, POLL_INTERVAL_MS);
    this.timer.unref?.();
    void this.drain();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async drain(): Promise<void> {
    if (this.stopped || this.running) {
      return;
    }
    this.running = true;
    try {
      const received = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.env.VIDEO_STATUS_QUEUE_URL,
          MaxNumberOfMessages: MAX_MESSAGES,
          WaitTimeSeconds: WAIT_TIME_SECONDS,
          VisibilityTimeout: 30,
        }),
      );
      for (const message of received.Messages ?? []) {
        await this.handleMessage(message.Body, message.ReceiptHandle);
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Status consumer poll failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Used by integration tests to process a single body without SQS. */
  async processBody(body: unknown): Promise<string> {
    return withMessageTraceparent(readTraceparentFromBody(body), () =>
      this.applyStatusEvent.execute(body),
    );
  }

  private async handleMessage(
    body: string | undefined,
    receiptHandle: string | undefined,
  ): Promise<void> {
    if (!body || !receiptHandle) {
      return;
    }
    let parsed: unknown = body;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      this.logger.warn('Status message is not JSON; deleting');
      await this.delete(receiptHandle);
      return;
    }

    // Unwrap SNS envelope when RawMessageDelivery is false.
    if (typeof parsed === 'object' && parsed !== null && 'Message' in parsed) {
      const snsMessage = (parsed as { Message?: unknown }).Message;
      if (typeof snsMessage === 'string') {
        try {
          parsed = JSON.parse(snsMessage) as unknown;
        } catch {
          this.logger.warn('SNS Message field is not JSON; deleting');
          await this.delete(receiptHandle);
          return;
        }
      }
    }

    try {
      const result = await withMessageTraceparent(readTraceparentFromBody(parsed), () =>
        this.applyStatusEvent.execute(parsed),
      );
      if (result === 'invalid_message') {
        this.logger.warn(`Invalid status message deleted (${result})`);
      }
      await this.delete(receiptHandle);
    } catch (error: unknown) {
      this.logger.warn(
        `Status message handling failed (will retry): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async delete(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.env.VIDEO_STATUS_QUEUE_URL,
        ReceiptHandle: receiptHandle,
      }),
    );
  }
}
