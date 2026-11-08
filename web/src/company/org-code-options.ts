import { orgCodeLabelJa, type OrgCode } from "@core/company/org-code";

import type { RadioOption } from "../shared/ui/radio-fieldset-view";

export const orgCodeOptionsIn = (
  order: ReadonlyArray<OrgCode>,
): ReadonlyArray<RadioOption<OrgCode>> =>
  order.map((orgCode) => ({ value: orgCode, label: orgCodeLabelJa(orgCode) }));
