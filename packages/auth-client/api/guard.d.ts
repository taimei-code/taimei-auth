import type { createAuthClient } from "./server";
import type { ListMembersResult, VerifyResult } from "./types";
type AuthClient = ReturnType<typeof createAuthClient>;
type CacheFn = <Args extends readonly unknown[], R>(fn: (...args: Args) => R) => (...args: Args) => R;
type GuardOptions = {
    client: AuthClient;
    getSessionToken: () => Promise<string | undefined>;
    cache?: CacheFn;
};
export declare function createAuthGuard(options: GuardOptions): {
    getSession: () => Promise<VerifyResult>;
    listMembers: () => Promise<ListMembersResult>;
};
export {};
//# sourceMappingURL=guard.d.ts.map