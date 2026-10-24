import { Schema } from "effect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccountPickerPage } from "./AccountPickerPage";
import { DevHomePage } from "./DevHomePage";
import { NonProductionLayout } from "./NonProductionLayout";
import { PAGE_PROPS_ELEMENT_ID, PagePropsFromJson } from "./page-props";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("root element #root not found");
}

const props = Schema.decodeUnknownSync(PagePropsFromJson)(
  document.getElementById(PAGE_PROPS_ELEMENT_ID)?.textContent,
);

createRoot(rootElement).render(
  <StrictMode>
    <NonProductionLayout>
      {props._tag === "DevHome" ? <DevHomePage {...props} /> : <AccountPickerPage {...props} />}
    </NonProductionLayout>
  </StrictMode>,
);
