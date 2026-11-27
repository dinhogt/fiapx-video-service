import { VideosController } from './videos.controller';
import type { AuthenticatedRequest } from '../../shared/jwt-auth';

describe('VideosController', () => {
  it('returns an empty list for the authenticated user', () => {
    const controller = new VideosController();
    const req = { user: { sub: 'u1', sid: 's1' } } as AuthenticatedRequest;
    expect(controller.list(req)).toEqual({
      items: [],
      nextCursor: null,
      userId: 'u1',
    });
  });
});
