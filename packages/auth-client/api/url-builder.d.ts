export interface BuildAuthLoginUrlOptions {
    authBaseUrl: string;
    service: string;
    returnTo: string;
    signUpUrl?: string;
    hash?: string;
}
export type ReturnToServiceOptions = Pick<BuildAuthLoginUrlOptions, "authBaseUrl" | "service" | "returnTo">;
export declare const authHostUrlReturningToService: (opts: ReturnToServiceOptions, path: string) => URL;
export declare const buildAuthLoginUrl: (opts: BuildAuthLoginUrlOptions) => string;
export declare const AUTH_ERROR_REASONS: readonly ["signin_failed", "signup_already_completed"];
export type AuthErrorReason = (typeof AUTH_ERROR_REASONS)[number];
export declare const buildAuthErrorUrl: (opts: {
    authBaseUrl: string;
    reason: AuthErrorReason;
}) => string;
export declare const buildCompanySignupUrl: (opts: ReturnToServiceOptions) => string;
export declare const buildMembersUrl: (opts: ReturnToServiceOptions) => string;
export declare const buildAccountUrl: (opts: {
    authBaseUrl: string;
}) => string;
//# sourceMappingURL=url-builder.d.ts.map