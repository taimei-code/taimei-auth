CREATE TABLE "mfa_registration_transition_guard" (
	"user_id" text PRIMARY KEY NOT NULL,
	"operation_token" text NOT NULL,
	"operation_kind" text NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_registration_guard_operation_kind_check" CHECK ("mfa_registration_transition_guard"."operation_kind" in ('enroll', 'restart', 'activate', 'disable', 'force_disable'))
);
--> statement-breakpoint
ALTER TABLE "mfa_registration_transition_guard" ADD CONSTRAINT "mfa_registration_transition_guard_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;