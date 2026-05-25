ALTER TABLE "invitation" DROP CONSTRAINT "invitation_invited_by_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "membership" DROP CONSTRAINT "membership_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;