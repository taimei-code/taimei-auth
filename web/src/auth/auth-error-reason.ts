import { z } from "zod";

const AUTH_ERROR_REASONS = [
  "invalid_redirect_url",
  "signup_already_completed",
  "signin_failed",
] as const;

export type AuthErrorReason = (typeof AUTH_ERROR_REASONS)[number];

export const authErrorSearchSchema = z.object({
  reason: z.enum(AUTH_ERROR_REASONS).optional().catch(undefined),
});
