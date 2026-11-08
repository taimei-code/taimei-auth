const FOLDKIT_AUTH_PATHS: ReadonlyArray<string> = [
  "/auth",
  "/auth/signup",
  "/auth/signup/company",
  "/auth/signup/accept-invitation",
  "/auth/mfa",
  "/auth/error",
];

export type RuntimeForPath = "FoldkitAuth" | "React";

export const runtimeForPath = (pathname: string): RuntimeForPath =>
  FOLDKIT_AUTH_PATHS.includes(pathname.replace(/\/+$/, "")) ? "FoldkitAuth" : "React";
