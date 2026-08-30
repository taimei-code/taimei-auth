CREATE TABLE "mfa_recovery_code" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_ciphertext" text NOT NULL,
	"code_iv" text NOT NULL,
	"key_version" integer NOT NULL,
	"used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mfa_totp" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enrollment_id" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_iv" text NOT NULL,
	"key_version" integer NOT NULL,
	"verified_at" timestamp,
	"last_used_timestep" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mfa_recovery_code" ADD CONSTRAINT "mfa_recovery_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_totp" ADD CONSTRAINT "mfa_totp_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mfa_recovery_code_user_id_idx" ON "mfa_recovery_code" USING btree ("user_id");