import type { InvitationRow } from "@/db/repositories/invitation";

// 招待が受諾可能か (PENDING かつ期限内)。純述語で I/O を持たないため Repository でなく domain の policy に置く。
// 時刻は呼び出し側 (guard / use-case) が Clock から取って渡す。
export const isAcceptableAt = (row: InvitationRow, nowMillis: number): boolean =>
  row.status === "PENDING" && row.expiresAt.getTime() > nowMillis;
