import { Layer } from "effect";

import { crashView } from "../../shared/crash-view";
import { startApplication } from "../start-application";
import { init, Message, Model, update, view } from "./main";

startApplication({
  Model,
  init,
  update,
  view,
  container: document.getElementById("root"),
  routing: {
    onUrlRequest: (request) => Message.ClickedLink({ request }),
    onUrlChange: (url) => Message.ChangedUrl({ url }),
  },
  crash: { view: crashView },
  resources: Layer.empty,
});
