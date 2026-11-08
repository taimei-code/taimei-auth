import { Layer } from "effect";

import { startApplicationWithFlags } from "../src/app/start-application";
import { crashView } from "../src/shared/crash-view";
import { Flags, flags, init, Model, update, view } from "./DevHome";

startApplicationWithFlags({
  Model,
  Flags,
  flags,
  init,
  update,
  view,
  container: document.getElementById("root"),
  crash: { view: crashView },
  resources: Layer.empty,
});
