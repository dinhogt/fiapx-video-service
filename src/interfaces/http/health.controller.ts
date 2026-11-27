import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from '../../infrastructure/health/health.service';
import { Public } from '../../shared/jwt-auth';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get('health/live')
  live(): { status: 'ok' } {
    return this.health.live();
  }

  @Public()
  @Get('health/ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const result = await this.health.ready();
    if (!result.ready) {
      res.status(503);
    }
    return result;
  }
}
