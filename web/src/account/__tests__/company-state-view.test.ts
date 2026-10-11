import { describe, expect, test } from "bun:test";
import { RegistryProvider } from "@effect/atom-react";
import { Cause, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CompanyState } from "@core/account/account-contract";
import { Unauthorized } from "@core/membership/guard/errors";

import { companyStateAtom } from "../account-atom";
import { CurrentCompanyProvider, useCurrentCompany } from "../current-company";

const state: CompanyState = {
  current_company_id: "company-1",
  memberships: [
    {
      id: "membership-1",
      company_id: "company-1",
      company_name: "Example",
      company_org_code: "CORPORATE",
      role: "OWNER",
      joined_at: "2026-01-01T00:00:00.000Z",
    },
  ],
};

const Probe = () => {
  const { refresh: _refresh, ...view } = useCurrentCompany();
  return createElement("pre", null, JSON.stringify(view));
};

const toCompanyStateView = (result: AsyncResult.AsyncResult<CompanyState, Unauthorized>) => {
  const html = renderToStaticMarkup(
    createElement(
      RegistryProvider,
      { initialValues: [[companyStateAtom, result]] },
      createElement(CurrentCompanyProvider, null, createElement(Probe)),
    ),
  );
  return JSON.parse(html.replace(/^<pre>|<\/pre>$/g, "").replaceAll("&quot;", '"'));
};

describe("useCurrentCompany (事業所状態の atom から導く)", () => {
  test("初回の取得が終わる前は loading", () => {
    expect(toCompanyStateView(AsyncResult.initial(true))).toMatchObject({ loading: true });
  });

  test("前回の成功値がある取り直しの失敗では、前の状態を保つ", () => {
    const view = toCompanyStateView(
      AsyncResult.failure(Cause.fail(new Unauthorized()), {
        previousSuccess: Option.some(AsyncResult.success(state)),
      }),
    );

    expect(view).toMatchObject({
      memberships: state.memberships,
      currentCompanyId: "company-1",
    });
  });
});
