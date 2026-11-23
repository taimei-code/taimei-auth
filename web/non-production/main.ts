import { Effect, Layer, Option, Schema } from "effect";

import { startApplicationWithFlags } from "../src/app/start-application";
import { crashView } from "../src/shared/crash-view";
import * as DevHome from "./DevHome";
import * as FeatureFlags from "./FeatureFlags";
import {
  type DevHomeProps,
  type FeatureFlagsProps,
  PAGE_PROPS_ELEMENT_ID,
  PagePropsFromJson,
} from "./page-props";

const maybeProps = Schema.decodeUnknownOption(PagePropsFromJson)(
  document.getElementById(PAGE_PROPS_ELEMENT_ID)?.textContent,
);
const maybeFeatureFlagsProps = Option.filter(
  maybeProps,
  (props): props is FeatureFlagsProps => props._tag === "FeatureFlags",
);
const shared = {
  container: document.getElementById("root"),
  crash: { view: crashView },
  resources: Layer.empty,
};

if (Option.isSome(maybeFeatureFlagsProps)) {
  startApplicationWithFlags({
    ...FeatureFlags,
    flags: Effect.succeed(maybeFeatureFlagsProps),
    ...shared,
  });
} else {
  startApplicationWithFlags({
    ...DevHome,
    flags: Effect.succeed(
      Option.filter(maybeProps, (props): props is DevHomeProps => props._tag === "DevHome"),
    ),
    ...shared,
  });
}
