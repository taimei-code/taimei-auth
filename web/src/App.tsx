import { BrowserRouter, Routes, Route } from "react-router-dom";

import { SignIn } from "./pages/SignIn";
import { ErrorPage } from "./pages/Error";

// Layer B Router: vite.config.ts の base="/auth/" と Hono の serveStatic prefix と整合する basename。
// React Router v7 の BrowserRouter を使う (createBrowserRouter も可だが Layer B はルートが少なく
// ネスト navigation も無いため BrowserRouter で十分)。
// PR3b で /signup と /verify-magic-link を追加予定。
export const App = () => {
  return (
    <BrowserRouter basename="/auth">
      <Routes>
        <Route path="/" element={<SignIn />} />
        <Route path="error" element={<ErrorPage />} />
      </Routes>
    </BrowserRouter>
  );
};
