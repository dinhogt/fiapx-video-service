import { Injectable } from '@nestjs/common';
import {
  RedisSessionRevocationChecker,
  type SessionRevocationChecker,
} from '../../shared/jwt-auth';
import { RedisService } from '../cache/redis.service';

@Injectable()
export class VideoSessionRevocationChecker implements SessionRevocationChecker {
  private readonly inner: RedisSessionRevocationChecker;

  constructor(redis: RedisService) {
    this.inner = new RedisSessionRevocationChecker(redis.client);
  }

  isRevoked(sid: string): Promise<boolean> {
    return this.inner.isRevoked(sid);
  }
}
