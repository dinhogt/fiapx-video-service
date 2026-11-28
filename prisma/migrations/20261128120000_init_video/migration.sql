-- Schema `video` já é criado pelo db/init.sql (B4/S-06); o role video_svc não tem CREATE no database.

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM (
  'PENDING_UPLOAD',
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'EXPIRED'
);

-- CreateTable
CREATE TABLE "videos" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(40) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "fps" DECIMAL(2,1) NOT NULL,
    "status" "VideoStatus" NOT NULL,
    "input_key" TEXT NOT NULL,
    "output_key" TEXT,
    "frame_count" INTEGER,
    "zip_size_bytes" BIGINT,
    "failure_code" VARCHAR(30),
    "failure_message" VARCHAR(500),
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "queued_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "destination" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox" (
    "message_id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_pkey" PRIMARY KEY ("message_id")
);

-- CreateIndex
CREATE INDEX "videos_user_id_created_at_id_idx" ON "videos"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "videos_status_updated_at_idx" ON "videos"("status", "updated_at");

-- CreateIndex
CREATE INDEX "outbox_created_at_idx" ON "outbox"("created_at");

-- Partial index for outbox relay (B6): pending rows only
CREATE INDEX "outbox_pending_created_at_idx" ON "outbox" ("created_at") WHERE "published_at" IS NULL;
