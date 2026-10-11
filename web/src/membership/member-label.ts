import type { Member } from "@core/membership/membership-contract";

export const memberLabel = (member: Pick<Member, "user_name" | "user_email">): string =>
  member.user_name || member.user_email;
