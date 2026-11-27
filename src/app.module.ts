import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import { VideoAccessTokenVerifier } from './infrastructure/auth/video-access-token-verifier';
import { VideoSessionRevocationChecker } from './infrastructure/auth/video-session-revocation-checker';
import { RedisService } from './infrastructure/cache/redis.service';
import type { VideoEnv } from './infrastructure/config/env';
import { APP_ENV_CONFIG } from './infrastructure/config/tokens';
import { HealthService } from './infrastructure/health/health.service';
import { pinoRedactPaths } from './infrastructure/observability/redact';
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
