-- CreateIndex
CREATE UNIQUE INDEX "uq_rate_limit_sender_window" ON "rate_limit_audit_logs"("sender_id", "hour_window");
