import { html, raw } from "hono/html";
import { Schema } from "effect";
import {
  NON_PRODUCTION_SCRIPT_HREF,
  NON_PRODUCTION_STYLESHEET_HREF,
} from "../web/non-production/assets";
import {
  PAGE_PROPS_ELEMENT_ID,
  type DevHomeProps,
  PAGE_TITLES,
  PagePropsFromJson,
} from "../web/non-production/page-props";

const encodePageProps = Schema.encodeSync(PagePropsFromJson);

const jsonInsideScriptElement = (props: DevHomeProps) =>
  encodePageProps(props).replaceAll("<", "\\u003c");

export const nonProductionShell = (props: DevHomeProps) => html`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${PAGE_TITLES[props._tag]}</title>
    <link rel="stylesheet" href="${NON_PRODUCTION_STYLESHEET_HREF}" />
    <script type="module" src="${NON_PRODUCTION_SCRIPT_HREF}"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="application/json" id="${PAGE_PROPS_ELEMENT_ID}">${raw(jsonInsideScriptElement(props))}</script>
  </body>
</html>`;
