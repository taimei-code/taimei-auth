import { getTrustedOrigins } from "../../src/env";
import { authHostOrigin } from "../auth-host-origin";

export const AUTH_HOST_ORIGIN = authHostOrigin();

const consumerOrigin = getTrustedOrigins().find((origin) => origin !== AUTH_HOST_ORIGIN);
if (!consumerOrigin) throw new Error("AUTH_TRUSTED_ORIGINS has no origin other than the auth host");

export const HEADERS_WITHOUT_AUTH_HOST_ORIGIN = [
  ["別の origin", { origin: "https://evil.example" }],
  ["Origin なし", {}],
  ["Origin: null", { origin: "null" }],
  ["AUTH_TRUSTED_ORIGINS に入っている consumer の origin", { origin: consumerOrigin }],
] as const;
