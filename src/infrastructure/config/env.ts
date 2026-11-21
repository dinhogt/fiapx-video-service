import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

export const videoEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'homolog', 'test']).default('local'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  AWS_REGION: z.string().min(1),
  AWS_ENDPOINT: z.string().url().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional().or(z.literal('')),
  OTEL_SERVICE_NAME: z.string().min(1),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  JWKS_URL: z.string().url(),
  TRUST_GATEWAY_IP: booleanFromEnv,
  S3_BUCKET: z.string().min(1),
  S3_PUBLIC_ENDPOINT: z.string().url(),
  VIDEO_PROCESS_QUEUE_URL: z.string().url(),
  VIDEO_STATUS_QUEUE_URL: z.string().url(),
});

export type VideoEnv = z.infer<typeof videoEnvSchema>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): VideoEnv {
  const result = videoEnvSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  return result.data;
}
