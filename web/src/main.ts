import "./index.css";

import { type RuntimeForPath, runtimeForPath } from "./app/runtime-for-path";

if (!document.getElementById("root")) {
  throw new Error("root element #root not found");
}

const startRuntime: Record<RuntimeForPath, () => Promise<unknown>> = {
  FoldkitAuth: () => import("./app/auth/entry"),
  FoldkitAccount: () => import("./app/account/entry"),
};

void startRuntime[runtimeForPath(window.location.pathname)]();
