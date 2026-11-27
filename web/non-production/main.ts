import { Effect, Layer, Schema } from "effect";

import { startApplicationWithFlags } from "../src/app/start-application";
import { crashView } from "../src/shared/crash-view";
import * as DevHome from "./DevHome";
import { PAGE_PROPS_ELEMENT_ID, PagePropsFromJson } from "./page-props";

startApplicationWithFlags({
  ...DevHome,
  flags: Effect.succeed(
    Schema.decodeUnknownOption(PagePropsFromJson)(
      document.getElementById(PAGE_PROPS_ELEMENT_ID)?.textContent,
    ),
  ),
  container: document.getElementById("root"),
  crash: { view: crashView },
  resources: Layer.empty,
});
