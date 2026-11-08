export type RouteEntry = { readonly kind: "show" } | { readonly kind: "companySignup" };

export type RedirectingEntry = Exclude<RouteEntry, { kind: "show" }>;
