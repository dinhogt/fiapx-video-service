import { queueNames, resourceNames, topicNames } from './resources';

describe('resource names', () => {
  it('builds queue and topic names for local and homolog', () => {
    expect(queueNames('local').videoProcess).toBe('fiapx-local-video-process');
    expect(queueNames('homolog').notificationsDlq).toBe('fiapx-homolog-notifications-dlq');
    expect(topicNames('local').videoEvents).toBe('fiapx-local-video-events');
    expect(resourceNames('homolog').topics.userEvents).toBe('fiapx-homolog-user-events');
  });
});
