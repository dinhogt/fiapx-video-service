export type ResourceEnv = 'local' | 'homolog';

export function queueNames(env: ResourceEnv) {
  return {
    videoProcess: `fiapx-${env}-video-process`,
    videoProcessDlq: `fiapx-${env}-video-process-dlq`,
    videoStatusUpdates: `fiapx-${env}-video-status-updates`,
    videoStatusUpdatesDlq: `fiapx-${env}-video-status-updates-dlq`,
    notifications: `fiapx-${env}-notifications`,
    notificationsDlq: `fiapx-${env}-notifications-dlq`,
    userContacts: `fiapx-${env}-user-contacts`,
    userContactsDlq: `fiapx-${env}-user-contacts-dlq`,
  } as const;
}

export function topicNames(env: ResourceEnv) {
  return {
    videoEvents: `fiapx-${env}-video-events`,
    userEvents: `fiapx-${env}-user-events`,
  } as const;
}

export function resourceNames(env: ResourceEnv) {
  return {
    queues: queueNames(env),
    topics: topicNames(env),
  } as const;
}
