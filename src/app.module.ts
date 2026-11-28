import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import { ConfirmVideoUseCase } from './application/confirm-video.use-case';
import { CreateVideoUseCase } from './application/create-video.use-case';
import type { OutboxRelay } from './domain/ports/outbox-relay';
import { VideoAccessTokenVerifier } from './infrastructure/auth/video-access-token-verifier';
import { VideoSessionRevocationChecker } from './infrastructure/auth/video-session-revocation-checker';
import { RedisService } from './infrastructure/cache/redis.service';
import type { VideoEnv } from './infrastructure/config/env';
import {
  APP_ENV_CONFIG,
  MESSAGE_PUBLISHER,
  OBJECT_STORAGE,
  OUTBOX_RELAY,
  PRESIGNED_UPLOAD,
  VIDEO_REPOSITORY,
} from './infrastructure/config/tokens';
import { HealthService } from './infrastructure/health/health.service';
import { OutboxRelayService } from './infrastructure/messaging/outbox-relay.service';
import { SqsMessagePublisher } from './infrastructure/messaging/sqs-message-publisher';
import { pinoRedactPaths } from './infrastructure/observability/redact';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { PrismaVideoRepository } from './infrastructure/prisma/prisma-video.repository';
import { S3ObjectStorageAdapter } from './infrastructure/storage/s3-object-storage.adapter';
import { S3PresignedPostAdapter } from './infrastructure/storage/s3-presigned-post.adapter';
import {
  CORRELATION_HEADER,
  CorrelationMiddleware,
} from './interfaces/http/correlation.middleware';
import { HealthController } from './interfaces/http/health.controller';
import { MetricsController } from './interfaces/http/metrics.controller';
import { VideosController } from './interfaces/http/videos.controller';
import {
  JwtAuthGuard,
  JWT_AUTH_REVOCATION,
  JWT_AUTH_VERIFIER,
} from './shared/jwt-auth';

@Module({})
export class AppModule implements NestModule {
  static forRoot(env: VideoEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            redact: {
              paths: pinoRedactPaths,
              censor: '[Redacted]',
            },
            customProps: (req: IncomingMessage) => ({
              correlationId: req.headers[CORRELATION_HEADER],
              service: env.OTEL_SERVICE_NAME,
              env: env.APP_ENV,
            }),
          },
        }),
      ],
      controllers: [HealthController, MetricsController, VideosController],
      providers: [
        { provide: APP_ENV_CONFIG, useValue: env },
        HealthService,
        RedisService,
        PrismaService,
        { provide: VIDEO_REPOSITORY, useClass: PrismaVideoRepository },
        { provide: PRESIGNED_UPLOAD, useClass: S3PresignedPostAdapter },
        { provide: OBJECT_STORAGE, useClass: S3ObjectStorageAdapter },
        { provide: MESSAGE_PUBLISHER, useClass: SqsMessagePublisher },
        OutboxRelayService,
        { provide: OUTBOX_RELAY, useExisting: OutboxRelayService },
        {
          provide: CreateVideoUseCase,
          useFactory: (videos: PrismaVideoRepository, uploads: S3PresignedPostAdapter) =>
            new CreateVideoUseCase(videos, uploads),
          inject: [VIDEO_REPOSITORY, PRESIGNED_UPLOAD],
        },
        {
          provide: ConfirmVideoUseCase,
          useFactory: (
            videos: PrismaVideoRepository,
            storage: S3ObjectStorageAdapter,
            relay: OutboxRelay,
          ) => new ConfirmVideoUseCase(videos, storage, relay),
          inject: [VIDEO_REPOSITORY, OBJECT_STORAGE, OUTBOX_RELAY],
        },
        { provide: JWT_AUTH_VERIFIER, useClass: VideoAccessTokenVerifier },
        { provide: JWT_AUTH_REVOCATION, useClass: VideoSessionRevocationChecker },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
