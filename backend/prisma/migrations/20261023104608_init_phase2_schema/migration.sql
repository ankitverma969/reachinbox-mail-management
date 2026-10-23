-- CreateEnum
CREATE TYPE "EmailJobStatus" AS ENUM ('SCHEDULED', 'QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'RATE_LIMITED_RESCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryAttemptStatus" AS ENUM ('SUCCESS', 'TEMPORARY_FAILURE', 'PERMANENT_FAILURE', 'RATE_LIMITED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "google_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sender_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email_address" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "smtp_host" TEXT NOT NULL,
    "smtp_port" INTEGER NOT NULL DEFAULT 587,
    "smtp_username" TEXT NOT NULL,
    "smtp_password_encrypted" TEXT NOT NULL,
    "hourly_rate_limit" INTEGER NOT NULL DEFAULT 200,
    "min_delay_seconds" INTEGER NOT NULL DEFAULT 2,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sender_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_batches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "original_filename" TEXT,
    "total_leads_detected" INTEGER NOT NULL DEFAULT 0,
    "scheduled_start_time" TIMESTAMP(3) NOT NULL,
    "configured_delay_seconds" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_jobs" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT,
    "sender_id" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "body" TEXT NOT NULL,
    "status" "EmailJobStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "rescheduled_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT NOT NULL,
    "bullmq_job_id" TEXT,
    "smtp_message_id" TEXT,
    "ethereal_preview_url" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_delivery_attempts" (
    "id" TEXT NOT NULL,
    "email_job_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" "DeliveryAttemptStatus" NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER,
    "smtp_response" TEXT,
    "smtp_message_id" TEXT,
    "error_message" TEXT,
    "error_code" TEXT,

    CONSTRAINT "email_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_integrations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_team_name" TEXT NOT NULL,
    "bot_user_id" TEXT NOT NULL,
    "bot_token_encrypted" TEXT NOT NULL,
    "incoming_webhook_url_encrypted" TEXT,
    "default_channel_id" TEXT NOT NULL,
    "default_channel_name" TEXT NOT NULL,
    "is_connected" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_audit_logs" (
    "id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "hour_window" TEXT NOT NULL,
    "quota_limit" INTEGER NOT NULL,
    "total_jobs_deferred" INTEGER NOT NULL DEFAULT 1,
    "slack_alert_sent" BOOLEAN NOT NULL DEFAULT false,
    "slack_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_sender_user_id" ON "sender_identities"("user_id");

-- CreateIndex
CREATE INDEX "idx_batch_user_id" ON "email_batches"("user_id");

-- CreateIndex
CREATE INDEX "idx_batch_sender_id" ON "email_batches"("sender_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_jobs_idempotency_key_key" ON "email_jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_email_job_status_scheduled_at" ON "email_jobs"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "idx_email_job_sender_status" ON "email_jobs"("sender_id", "status");

-- CreateIndex
CREATE INDEX "idx_email_job_sent_at" ON "email_jobs"("sent_at");

-- CreateIndex
CREATE INDEX "idx_email_job_bullmq_id" ON "email_jobs"("bullmq_job_id");

-- CreateIndex
CREATE INDEX "idx_delivery_attempt_job_num" ON "email_delivery_attempts"("email_job_id", "attempt_number");

-- CreateIndex
CREATE INDEX "idx_slack_user_id" ON "slack_integrations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_integrations_user_id_slack_team_id_key" ON "slack_integrations"("user_id", "slack_team_id");

-- CreateIndex
CREATE INDEX "idx_rate_limit_sender_window" ON "rate_limit_audit_logs"("sender_id", "hour_window");

-- AddForeignKey
ALTER TABLE "sender_identities" ADD CONSTRAINT "sender_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_batches" ADD CONSTRAINT "email_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_batches" ADD CONSTRAINT "email_batches_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "sender_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "sender_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "email_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_delivery_attempts" ADD CONSTRAINT "email_delivery_attempts_email_job_id_fkey" FOREIGN KEY ("email_job_id") REFERENCES "email_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_limit_audit_logs" ADD CONSTRAINT "rate_limit_audit_logs_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "sender_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
