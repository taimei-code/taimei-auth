import { Predicate, Schema } from "effect";
import {
  PAGE_PROPS_ELEMENT_ID,
  type PageProps,
  PagePropsFromJson,
} from "../../web/non-production/page-props";

const PAGE_PROPS_PATTERN = new RegExp(
  `<script type="application/json" id="${PAGE_PROPS_ELEMENT_ID}">(.*?)</script>`,
  "s",
);

const pagePropsTagged =
  <Tag extends PageProps["_tag"]>(tag: Tag) =>
  (body: string) => {
    const json = body.match(PAGE_PROPS_PATTERN)?.[1];
    if (json === undefined) throw new Error("the page props are not in the page");
    const props = Schema.decodeSync(PagePropsFromJson)(json);
    if (!Predicate.isTagged(props, tag)) throw new Error(`the page is ${props._tag}, not ${tag}`);
    return props;
  };

export const devHomePropsOf = pagePropsTagged("DevHome");

export const accountPickerPropsOf = pagePropsTagged("AccountPicker");
