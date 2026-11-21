import { PASSKEY_LIMIT } from "../../db/enums";

export const isPasskeyLimitReached = (passkeyCount: number): boolean =>
  passkeyCount >= PASSKEY_LIMIT;
