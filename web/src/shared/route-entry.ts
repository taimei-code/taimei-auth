export type RouteEntry =
  | { readonly kind: "show" }
  | { readonly kind: "signIn" }
  | { readonly kind: "goToRedirectUrl"; readonly redirectUrl: string }
  | { readonly kind: "companySignup" }
  | { readonly kind: "failed"; readonly message: string };

export type RedirectingEntry = Exclude<RouteEntry, { kind: "show" | "failed" }>;
