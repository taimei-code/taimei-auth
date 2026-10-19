import type { Role } from "./types";

export const TESTING_PATH = "/testing/v1";

export type SignedInUserRequest = {
  name?: string;
  companies: readonly { name?: string; role: Role }[];
  returnTo: string;
};

export type SignedInUser = {
  userId: string;
  email: string;
  companyIds: string[];
  loginUrl: string;
};

const post = async <T>(authBaseUrl: string, path: string, body: unknown): Promise<T> => {
  const response = await fetch(new URL(`${TESTING_PATH}${path}`, authBaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`taimei-auth testing ${path} failed with ${response.status}`);
  }
  return (await response.json()) as T;
};

export const createTestingClient = (authBaseUrl: string) => ({
  createSignedInUser: (request: SignedInUserRequest) =>
    post<SignedInUser>(authBaseUrl, "/signed-in-users", request),
});
