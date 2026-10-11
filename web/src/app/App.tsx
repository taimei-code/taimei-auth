import { RegistryContext, RegistryProvider } from "@effect/atom-react";
import { RouterProvider } from "@tanstack/react-router";
import { use, useState } from "react";

import { makeRouter } from "./router";

const Router = () => {
  const registry = use(RegistryContext);
  const [router] = useState(() => makeRouter(registry));
  return <RouterProvider router={router} />;
};

export const App = () => (
  <RegistryProvider>
    <Router />
  </RegistryProvider>
);
