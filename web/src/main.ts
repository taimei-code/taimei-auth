import "./index.css";

import { type RuntimeForPath, runtimeForPath } from "./app/runtime-for-path";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("root element #root not found");
}

const startRuntime: Record<RuntimeForPath, () => Promise<unknown>> = {
  FoldkitAuth: () =>
    import("./app/auth-application").then(({ startAuthApplication }) =>
      startAuthApplication(rootElement),
    ),
  FoldkitAccount: () =>
    import("./app/account-application").then(({ startAccountApplication }) =>
      startAccountApplication(rootElement),
    ),
  React: () => import("./app/react-root").then(({ startReactRoot }) => startReactRoot(rootElement)),
};

void startRuntime[runtimeForPath(window.location.pathname)]();
