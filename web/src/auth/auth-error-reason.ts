import { AUTH_ERROR_REASONS } from "@taimei-code/auth-client";
import { z } from "zod";

const ERROR_PAGE_REASONS = [...AUTH_ERROR_REASONS, "invalid_redirect_url"] as const;

export type ErrorPageReason = (typeof ERROR_PAGE_REASONS)[number];

export const authErrorSearchSchema = z.object({
  reason: z.enum(ERROR_PAGE_REASONS).optional().catch(undefined),
});
