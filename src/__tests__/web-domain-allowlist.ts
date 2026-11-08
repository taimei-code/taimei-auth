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
  ["invitation", new Set(["auth/sign-in-client.ts"])],
  ["mfa", new Set(["auth/auth-page-card-view.ts"])],
  [
    "account",
    new Set([
      "auth/auth-client.ts",
      "auth/sign-in-client.ts",
      "auth/sign-out.ts",
      "auth/provider-label.ts",
      "mfa/mfa-atom.ts",
      "mfa/MfaSettingsItem.tsx",
    ]),
  ],
  [
    "membership",
    new Set([
      "account/account-atom.ts",
      "account/current-company.tsx",
      "auth/auth-client.ts",
      "invitation/InviteMemberForm.tsx",
      "invitation/PendingInvitations.tsx",
    ]),
  ],
  [
    "company",
    new Set([
      "account/account-atom.ts",
      "account/current-company.tsx",
      "auth/auth-client.ts",
      "auth/auth-page-card-view.ts",
      "auth/sign-in-client.ts",
      "auth/sign-out.ts",
      "membership/membership-atom.ts",
      "membership/TransferOwnershipModal.tsx",
    ]),
  ],
  [
    "app",
    new Set([
      "account/current-company.tsx",
      "account/pages/Connections.ts",
      "account/pages/Profile.ts",
      "account/pages/Security.tsx",
      "account/pages/Sessions.ts",
      "auth/auth-client.ts",
      "auth/auth-error-reason.ts",
      "auth/pages/AuthError.ts",
      "auth/pages/Error.tsx",
      "auth/pages/SignInOrSignUp.ts",
      "auth/sign-out.ts",
      "company/pages/Companies.tsx",
      "company/pages/CompanySettings.tsx",
      "company/pages/SignUpCompany.ts",
      "invitation/pages/AcceptInvitation.ts",
      "invitation/redirect-target.ts",
      "membership/pages/Members.tsx",
      "mfa/mfa-atom.ts",
      "mfa/pages/MfaChallenge.ts",
    ]),
  ],
]);
