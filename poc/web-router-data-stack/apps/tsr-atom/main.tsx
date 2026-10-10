import { RegistryProvider, RegistryContext } from "@effect/atom-react";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode, use, useState } from "react";
import { createRoot } from "react-dom/client";

import { makeRouter } from "./routes";

const App = () => {
  const registry = use(RegistryContext);
  const [router] = useState(() => makeRouter(registry));
  return <RouterProvider router={router} />;
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RegistryProvider>
      <App />
    </RegistryProvider>
  </StrictMode>,
);
