import { z } from "zod";
import { TAIMEI_SERVICES, type ServiceName } from "./services";
import { validateRedirectUrl } from "./url-allowlist";

const serviceNameSchema = z.enum(Object.keys(TAIMEI_SERVICES) as [ServiceName, ...ServiceName[]]);

// refine 前の object を別に export するのは、SPA が「転送してよい query キーの集合」を shape から導出するため。
export const signInParamsObjectSchema = z.object({
  service_name: serviceNameSchema,
  redirect_url: z.string().min(1).max(2048),
  sign_up_url: z.string().min(1).max(2048).optional(),
  invitation_token: z.string().min(1).max(256).optional(),
});

export const signInParamsSchema = signInParamsObjectSchema
  .refine((data) => validateRedirectUrl(data.redirect_url, data.service_name), {
    path: ["redirect_url"],
    message: "redirect_url is not in allowlist",
  })
  .refine(
    (data) =>
      data.sign_up_url === undefined || validateRedirectUrl(data.sign_up_url, data.service_name),
    { path: ["sign_up_url"], message: "sign_up_url is not in allowlist" },
  );
