import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConfirmVideoUseCase } from '../../application/confirm-video.use-case';
import {
  CreateVideoUseCase,
  mapCreateVideoError,
} from '../../application/create-video.use-case';
import type { VideoEnv } from '../../infrastructure/config/env';
import { APP_ENV_CONFIG } from '../../infrastructure/config/tokens';
import type { AuthenticatedRequest } from '../../shared/jwt-auth';
import { CORRELATION_HEADER, readCorrelationId } from './correlation.middleware';
import { buildTraceparent } from './traceparent';

const createVideoBodySchema = z.object({
  fileName: z.string(),
  sizeBytes: z.number(),
  contentType: z.string(),
  fps: z.number().optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('videos')
export class VideosController {
  constructor(
    private readonly createVideo: CreateVideoUseCase,
    private readonly confirmVideo: ConfirmVideoUseCase,
    @Inject(APP_ENV_CONFIG) private readonly env: VideoEnv,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException({ detail: 'Token inválido.' });
    }

    const parsed = createVideoBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        detail: 'Dados de upload inválidos.',
        errors: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      });
    }

    const correlationId = ensureUuidCorrelation(readCorrelationId(req));
    req.headers[CORRELATION_HEADER] = correlationId;

    const result = await this.createVideo.execute({
      userId,
      fileName: parsed.data.fileName,
      sizeBytes: parsed.data.sizeBytes,
      contentType: parsed.data.contentType,
      fps: parsed.data.fps,
      correlationId,
      bucket: this.env.S3_BUCKET,
    });

    if (!result.ok) {
      const mapped = mapCreateVideoError(result.code);
      throw new BadRequestException({ detail: mapped.detail });
    }

    return result.value;
  }

  @Post(':id/confirm')
  @HttpCode(202)
  async confirm(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException({ detail: 'Token inválido.' });
    }
    if (!UUID_RE.test(id)) {
      throw new NotFoundException({ detail: 'Vídeo não encontrado.' });
    }

    const result = await this.confirmVideo.execute({
      videoId: id,
      userId,
      bucket: this.env.S3_BUCKET,
      processQueueUrl: this.env.VIDEO_PROCESS_QUEUE_URL,
      traceparent: buildTraceparent(req.header('traceparent')),
    });

    if (!result.ok) {
      throw mapConfirmFailure(result.code);
    }

    return {
      videoId: result.value.videoId,
      status: result.value.status,
    };
  }

  @Get()
  list(@Req() req: AuthenticatedRequest): {
    items: unknown[];
    nextCursor: null;
    userId: string | undefined;
  } {
    return {
      items: [],
      nextCursor: null,
      userId: req.user?.sub,
    };
  }
}

function ensureUuidCorrelation(value: string): string {
  if (UUID_RE.test(value)) {
    return value;
  }
  return randomUUID();
}

function mapConfirmFailure(code: string): Error {
  switch (code) {
    case 'VIDEO_NOT_FOUND':
      return new NotFoundException({ detail: 'Vídeo não encontrado.' });
    case 'OBJECT_MISSING':
      return new ConflictException({
        detail: 'Objeto ainda não está disponível no armazenamento.',
      });
    case 'VIDEO_EXPIRED':
      return new ConflictException({ detail: 'Upload expirado.' });
    case 'INVALID_TRANSITION':
      return new ConflictException({ detail: 'Transição de status inválida.' });
    default:
      return new BadRequestException({ detail: 'Não foi possível confirmar o upload.' });
  }
}
