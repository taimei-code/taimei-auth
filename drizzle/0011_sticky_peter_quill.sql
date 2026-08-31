DROP TABLE "mfa_registration_guard_protocol" CASCADE;--> statement-breakpoint
DROP TABLE "mfa_registration_transition_guard" CASCADE;--> statement-breakpoint
DROP TABLE "two_factor" CASCADE;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "two_factor_enabled";