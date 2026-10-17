import { MAGIC_LINK_EXPIRES_IN_SECONDS } from "./auth-host";
import type { SessionData } from "./types";

export const isJustSignedUp = (data: SessionData, now: number = Date.now()): boolean =>
  now - Date.parse(data.user.createdAt) < MAGIC_LINK_EXPIRES_IN_SECONDS * 1000;
