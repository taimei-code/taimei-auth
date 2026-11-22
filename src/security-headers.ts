import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";

const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: [
    "'self'",
    "data:",
    "https://avatars.githubusercontent.com",
    "https://*.public.blob.vercel-storage.com",
  ],
  fontSrc: ["'self'"],
  connectSrc: ["'self'", "https://vercel.com"],
  objectSrc: ["'none'"],
  baseUri: ["'none'"],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
};

export const securityHeaders = secureHeaders({
  contentSecurityPolicy: CONTENT_SECURITY_POLICY,
  xFrameOptions: "DENY",
  referrerPolicy: "strict-origin-when-cross-origin",
  strictTransportSecurity: "max-age=86400",
  crossOriginOpenerPolicy: "same-origin-allow-popups",
  crossOriginResourcePolicy: false,
  permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] },
});

export const clearSiteDataOnSignOut = createMiddleware(async (c, next) => {
  await next();
  if (c.res.ok) {
    c.header("Clear-Site-Data", '"storage"');
  }
});
