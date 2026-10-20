import { Data, Effect } from "effect";

export class Unauthorized extends Data.TaggedError("Unauthorized") {}
export class RequestFailed extends Data.TaggedError("RequestFailed")<{ readonly status: number }> {}

export type Membership = { company_id: string; company_name: string };
export type CompanyState = { current_company_id: string | null; memberships: Membership[] };
export type Member = { user_id: string; name: string };

const request = Effect.fnUntraced(function* <T>(url: string, init?: RequestInit) {
  const response = yield* Effect.promise((signal) =>
    fetch(url, { ...init, signal, credentials: "include", headers: { "Content-Type": "application/json" } }),
  );
  if (response.status === 401) return yield* new Unauthorized();
  if (!response.ok) return yield* new RequestFailed({ status: response.status });
  const text = yield* Effect.promise(() => response.text());
  return (text ? JSON.parse(text) : undefined) as T;
});

export const getCompanyState = request<CompanyState>("/api/account/memberships");
export const listMembers = (companyId: string) => request<Member[]>(`/api/companies/${companyId}/members`);
export const setCurrentCompany = (companyId: string) =>
  request<void>("/api/account/current-company", { method: "POST", body: JSON.stringify({ company_id: companyId }) });
export const removeMember = (input: { companyId: string; userId: string }) =>
  request<void>(`/api/companies/${input.companyId}/members/${input.userId}`, { method: "DELETE" });
export const acceptInvitation = (token: string) =>
  request<void>(`/api/invitations/${token}/accept`, { method: "POST" });
