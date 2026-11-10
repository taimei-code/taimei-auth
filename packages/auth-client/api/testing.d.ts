import type { Role } from "./types.js";
import { type ReturnToServiceOptions } from "./url-builder.js";
export declare const TESTING_PATH = "/testing/v1";
export declare const DEV_HOME_PATH = "/dev-home";
export type BuildDevHomeUrlOptions = ReturnToServiceOptions;
export declare const buildDevHomeUrl: (opts: BuildDevHomeUrlOptions) => string;
export type SignedInUserRequest = {
    name?: string;
    companies: readonly {
        name?: string;
        role: Role;
    }[];
    returnTo: string;
};
export type SignedInUser = {
    userId: string;
    email: string;
    companyIds: string[];
    loginUrl: string;
};
export type SetCurrentCompanyRequest = {
    userId: string;
    companyId: string;
};
export declare const createTestingClient: (authBaseUrl: string) => {
    createSignedInUser: (request: SignedInUserRequest) => Promise<SignedInUser>;
    setCurrentCompany: (request: SetCurrentCompanyRequest) => Promise<{
        ok: true;
    }>;
};
//# sourceMappingURL=testing.d.ts.map