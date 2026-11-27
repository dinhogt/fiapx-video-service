import { Controller, Get, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../shared/jwt-auth';

/**
 * Minimal protected surface for AC-13 (F2.9).
 * Full video domain arrives in F3; this endpoint already requires Bearer JWT.
 */
@Controller('videos')
export class VideosController {
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
