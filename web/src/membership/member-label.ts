import type { Member } from "./membership-api";

export const memberLabel = (member: Pick<Member, "user_name" | "user_email">): string =>
  member.user_name || member.user_email;
