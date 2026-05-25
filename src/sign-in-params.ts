import { z } from "zod";
import { TAIMEI_SERVICES, type ServiceName } from "./services";
import { validateRedirectUrl } from "./url-allowlist";

// 検証ポリシー: docs/adr/0003-redirect-url-allowlist-policy.md
const serviceNameSchema = z.enum(Object.keys(TAIMEI_SERVICES) as [ServiceName, ...ServiceName[]]);

export const signInParamsSchema = z
  .object({
    service_name: serviceNameSchema,
    redirect_url: z.string().min(1).max(2048),
    sign_up_url: z.string().min(1).max(2048).optional(),
    // ADR-009 Phase B: 招待リンクから signup する時に query で運ばれる invitation token。
    // Phase A 時点では string として通すだけで accept handler は Phase B で実装。
    invitation_token: z.string().min(1).max(256).optional(),
  })
  .refine((data) => validateRedirectUrl(data.redirect_url, data.service_name), {
    path: ["redirect_url"],
    message: "redirect_url is not in allowlist",
  })
  .refine(
    (data) =>
      data.sign_up_url === undefined || validateRedirectUrl(data.sign_up_url, data.service_name),
    { path: ["sign_up_url"], message: "sign_up_url is not in allowlist" },
  );

export type SignInParams = z.infer<typeof signInParamsSchema>;
