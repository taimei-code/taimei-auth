import { BrowserRouter, Routes, Route } from "react-router-dom";

import { CurrentCompanyProvider } from "../account/current-company";
import { Connections } from "../account/pages/Connections";
import { Profile } from "../account/pages/Profile";
import { Security } from "../account/pages/Security";
import { Sessions } from "../account/pages/Sessions";
import { AuthLayout } from "../auth/AuthLayout";
import { ErrorPage } from "../auth/pages/Error";
import { SignIn } from "../auth/pages/SignIn";
import { SignUp } from "../auth/pages/SignUp";
import { Companies } from "../company/pages/Companies";
import { CompanySettings } from "../company/pages/CompanySettings";
import { SignUpCompany } from "../company/pages/SignUpCompany";
import { SignUpAcceptInvitation } from "../invitation/pages/SignUpAcceptInvitation";
import { Members } from "../membership/pages/Members";
import { MfaChallenge } from "../mfa/pages/MfaChallenge";
import { AccountLayout } from "./AccountLayout";
import { SessionGuard } from "./SessionGuard";

export const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<AuthLayout />}>
          <Route index element={<SignIn />} />
          <Route path="signup" element={<SignUp />} />
          <Route path="signup/company" element={<SignUpCompany />} />
          <Route path="signup/accept-invitation" element={<SignUpAcceptInvitation />} />
          <Route path="mfa" element={<MfaChallenge />} />
          <Route path="error" element={<ErrorPage />} />
        </Route>

        <Route
          path="/account"
          element={
            <CurrentCompanyProvider>
              <SessionGuard>
                <AccountLayout />
              </SessionGuard>
            </CurrentCompanyProvider>
          }
        >
          <Route index element={<Profile />} />
          <Route path="companies" element={<Companies />} />
          <Route path="company-settings" element={<CompanySettings />} />
          <Route path="members" element={<Members />} />
          <Route path="security" element={<Security />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="connections" element={<Connections />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
