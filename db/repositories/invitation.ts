import { nanoid } from "nanoid";
import { invitation } from "../schema";

// ADR-009: Stripe 流 prefix `inv_<24chars>` で entity type を log / audit_log 上で即判定可能に。
export const generateInvitationId = (): string => `inv_${nanoid(24)}`;

export type InvitationRow = typeof invitation.$inferSelect;
export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED";
