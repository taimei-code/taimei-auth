import { html, raw } from "hono/html";
import { Schema } from "effect";
import {
  NON_PRODUCTION_SCRIPT_HREF,
  NON_PRODUCTION_STYLESHEET_HREF,
} from "../web/non-production/assets";
import {
  PAGE_PROPS_ELEMENT_ID,
  PAGE_TITLES,
  type PageProps,
  PagePropsFromJson,
} from "../web/non-production/page-props";

const encodePageProps = Schema.encodeSync(PagePropsFromJson);

const jsonInsideScriptElement = (props: PageProps) =>
  encodePageProps(props).replaceAll("<", "\\u003c");

export const nonProductionShell = (props: PageProps) => html`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${PAGE_TITLES[props._tag]}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="${NON_PRODUCTION_STYLESHEET_HREF}" />
    <script type="module" src="${NON_PRODUCTION_SCRIPT_HREF}"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="application/json" id="${PAGE_PROPS_ELEMENT_ID}">${raw(jsonInsideScriptElement(props))}</script>
  </body>
</html>`;
