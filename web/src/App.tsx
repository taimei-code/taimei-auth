import { BrowserRouter, Routes, Route } from "react-router-dom";

import { SignIn } from "./pages/SignIn";
import { SignUp } from "./pages/SignUp";
import { ErrorPage } from "./pages/Error";

// Layer B Router: vite.config.ts の base="/auth/" と Hono の serveStatic prefix と整合する basename。
// /verify-magic-link は Better Auth 標準の /api/auth/magic-link/verify が token verify + callbackURL
// redirect を完結させるため、Layer B 側に UI ルートは不要 (plan の項目4 から撤廃)。
export const App = () => {
  return (
    <BrowserRouter basename="/auth">
      <Routes>
        <Route path="/" element={<SignIn />} />
        <Route path="signup" element={<SignUp />} />
        <Route path="error" element={<ErrorPage />} />
      </Routes>
    </BrowserRouter>
  );
};
