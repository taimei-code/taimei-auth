import { Schema } from "effect";
import { PAGE_PROPS_ELEMENT_ID, PagePropsFromJson } from "../../web/non-production/page-props";

const PAGE_PROPS_PATTERN = new RegExp(
  `<script type="application/json" id="${PAGE_PROPS_ELEMENT_ID}">(.*?)</script>`,
  "s",
);

export const PAGE_PROPS_NOT_IN_PAGE = "the page props are not in the page";

export const devHomePropsOf = (body: string) => {
  const json = body.match(PAGE_PROPS_PATTERN)?.[1];
  if (json === undefined) throw new Error(PAGE_PROPS_NOT_IN_PAGE);
  return Schema.decodeSync(PagePropsFromJson)(json);
};
