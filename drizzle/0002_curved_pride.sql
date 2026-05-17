ALTER TABLE "session" ADD COLUMN "revoked_at" timestamp;--> statement-breakpoint
CREATE INDEX "session_revoked_at_idx" ON "session" USING btree ("revoked_at");
