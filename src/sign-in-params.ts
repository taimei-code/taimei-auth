import { z } from "zod";
import { TAIMEI_SERVICES, type ServiceName } from "./services";
import { validateRedirectUrl } from "./url-allowlist";

// SignInParams: 共通ログイン画面 (/auth/) のクエリパラメータスキーマ (sign 流)。
// freee-accounts の SignInParamsForm に相当するが、Zod で実装。Layer B 側で parse して
// 不正値は 400 + エラー画面に誘導 (バックエンドへの不正パラメータ流入を Layer B で遮断)。
//
// max(2048) の根拠: 主要ブラウザ / nginx default の URL 長制限が 2048-8192 byte。
// safe side として 2048 を採用。production で長尺 URL が必要になったら個別に緩める。

const serviceNameSchema = z.enum(Object.keys(TAIMEI_SERVICES) as [ServiceName, ...ServiceName[]]);

export const signInParamsSchema = z
  .object({
    service_name: serviceNameSchema,
    redirect_url: z.string().min(1).max(2048),
    sign_up_url: z.string().min(1).max(2048).optional(),
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
