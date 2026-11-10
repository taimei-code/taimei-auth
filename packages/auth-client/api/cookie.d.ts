export type CookieReader = (name: string) => string | undefined;
export declare function getSessionToken(readCookie: CookieReader): string | undefined;
export declare function hasAuthCookie(readCookie: CookieReader): boolean;
export declare function buildSessionCookieHeader(token: string): string;
export declare function extractSessionTokenFromCookieHeader(cookieHeader: string): string | undefined;
//# sourceMappingURL=cookie.d.ts.map