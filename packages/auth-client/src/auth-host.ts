import type { SessionData } from "./types";

export const AUTH_RPC_PATH = "/rpc";
export const MAGIC_LINK_EXPIRES_IN_SECONDS = 300;
export const COMPANY_ID_PATTERN = /^cmp_[A-Za-z0-9_-]{24}$/;

export const isJustSignedUp = (data: SessionData, now: number = Date.now()): boolean =>
  now - Date.parse(data.user.createdAt) < MAGIC_LINK_EXPIRES_IN_SECONDS * 1000;
