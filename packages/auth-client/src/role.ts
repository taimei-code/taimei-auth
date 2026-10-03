import { Role as ProtoRole } from "./gen/auth/v1/auth_pb";
import type { Role } from "./types";

const ROLE_BY_PROTO: Partial<Record<ProtoRole, Role>> = {
  [ProtoRole.OWNER]: "OWNER",
  [ProtoRole.ADMIN]: "ADMIN",
  [ProtoRole.MEMBER]: "MEMBER",
};

export const toRole = (role: ProtoRole | undefined): Role | undefined =>
  role === undefined ? undefined : ROLE_BY_PROTO[role];
