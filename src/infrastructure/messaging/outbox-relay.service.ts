import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MessagePublisher } from '../../domain/ports/message-publisher';
import type { OutboxRelay } from '../../domain/ports/outbox-relay';
import type { VideoEnv } from '../config/env';
import { APP_ENV_CONFIG, MESSAGE_PUBLISHER } from '../config/tokens';
import { PrismaService } from '../prisma/prisma.service';

type OutboxRow = {
  id: string;
  type: string;
  destination: string;
  payload: unknown;
};

const BATCH_SIZE = 50;
const POLL_INTERVAL_MS = 1_000;

@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy, OutboxRelay {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MESSAGE_PUBLISHER) private readonly publisher: MessagePublisher,
    @Inject(APP_ENV_CONFIG) private readonly env: VideoEnv,
  ) {}

  onModuleInit(): void {
    // Integration suites call drain() explicitly to avoid cross-suite timer races.
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

  kick(): void {
    if (this.env.APP_ENV === 'test' || this.env.NODE_ENV === 'test') {
      return;
    }
    void this.drain();
  }

  async drain(): Promise<void> {
    if (this.stopped || this.running) {
      return;
    }
    this.running = true;
    try {
      await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, type, destination, payload
          FROM outbox
          WHERE published_at IS NULL
          ORDER BY created_at
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `;

        for (const row of rows) {
          try {
            await this.publisher.publish({
              destination: row.destination,
              type: row.type,
              body: row.payload,
            });
            await tx.outbox.update({
              where: { id: row.id },
              data: { publishedAt: new Date(), lastError: null },
            });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'publish failed';
            this.logger.warn(`Outbox publish failed for ${row.id}: ${message}`);
            await tx.outbox.update({
              where: { id: row.id },
              data: {
                attempts: { increment: 1 },
                lastError: message.slice(0, 2000),
              },
            });
          }
        }
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        this.logger.warn(`Outbox relay transaction failed: ${error.message}`);
        return;
      }
      this.logger.warn(
        `Outbox relay failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
