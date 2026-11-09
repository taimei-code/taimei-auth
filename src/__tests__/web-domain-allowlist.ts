export const DOMAIN_ROOTS = new Set([
  "account",
  "auth",
  "company",
  "invitation",
  "membership",
  "mfa",
]);
export const BOOTSTRAP_FILES = new Set(["index.css", "main.ts", "vite-env.d.ts"]);

export const ALLOWED_CROSS_DOMAIN = new Map<string, ReadonlySet<string>>([
  ["auth", new Set()],
  ["invitation", new Set(["account/account-page-header-view.ts", "auth/sign-in-client.ts"])],
  ["mfa", new Set(["auth/auth-page-card-view.ts"])],
  [
    "account",
    new Set([
      "auth/sign-in-client.ts",
      "auth/sign-out.ts",
      "auth/provider-label.ts",
      "mfa/mfa-disabling.ts",
      "mfa/mfa-enrollment.ts",
    ]),
  ],
  [
    "membership",
    new Set([
      "account/account-page-header-view.ts",
      "account/current-company.ts",
      "auth/sign-in-client.ts",
      "invitation/member-invitations.ts",
    ]),
  ],
  [
    "company",
    new Set([
      "account/account-page-header-view.ts",
      "account/current-company.ts",
      "auth/auth-page-card-view.ts",
      "auth/sign-in-client.ts",
      "auth/sign-out.ts",
      "membership/ownership-transfer.ts",
    ]),
  ],
  [
    "app",
    new Set([
      "account/current-company.ts",
      "account/pages/Connections.ts",
      "account/pages/Profile.ts",
      "account/pages/Security.ts",
      "account/pages/Sessions.ts",
      "auth/auth-error-reason.ts",
      "auth/pages/AuthError.ts",
      "auth/pages/Error.tsx",
      "auth/pages/SignInOrSignUp.ts",
      "auth/sign-out.ts",
      "company/pages/Companies.ts",
      "company/pages/CompanySettings.ts",
      "company/pages/SignUpCompany.ts",
      "invitation/pages/AcceptInvitation.ts",
      "invitation/redirect-target.ts",
      "membership/pages/Members.ts",
      "mfa/pages/MfaChallenge.ts",
    ]),
  ],
]);
