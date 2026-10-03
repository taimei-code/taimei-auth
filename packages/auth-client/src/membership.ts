import { toRole } from "./role";
import type { createAuthClient } from "./server";
import type { Role } from "./types";

type AuthClient = ReturnType<typeof createAuthClient>;

export async function getRole(
  client: AuthClient,
  params: { userId: string; companyId: string },
): Promise<Role | undefined> {
  const response = await client.authService.getMembership(params);
  return toRole(response.role);
}
