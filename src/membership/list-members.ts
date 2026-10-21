import type { VerifiedMember } from "./guard";
import { MembershipRepo } from "./ports";

export const listMembers = (member: VerifiedMember) =>
  MembershipRepo.use((repo) => repo.findMembersByCompanyId(member.companyId));
