export const webBuildAppEnv = process.env.APP_ENV ?? "production";

export const isProductionWebBuild = webBuildAppEnv === "production";
