import type { Html, HtmlBuilder } from "foldkit/html";
import type { IconNode } from "lucide";

const SVG_CHILD_TAGS = [
  "path",
  "circle",
  "line",
  "rect",
  "polyline",
  "polygon",
  "ellipse",
  "g",
] as const;

type SvgChildTag = (typeof SVG_CHILD_TAGS)[number];

const isSvgChildTag = (tag: string): tag is SvgChildTag =>
  SVG_CHILD_TAGS.some((known) => known === tag);

const LUCIDE_SVG_ATTRIBUTES = {
  xmlns: "http://www.w3.org/2000/svg",
  width: "24",
  height: "24",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
} as const;

export const iconView = <Message>(h: HtmlBuilder<Message>, icon: IconNode): Html => {
  const elementOf: Record<SvgChildTag, HtmlBuilder<Message>["path"]> = {
    path: h.path,
    circle: h.circle,
    line: h.line,
    rect: h.rect,
    polyline: h.polyline,
    polygon: h.polygon,
    ellipse: h.ellipse,
    g: h.g,
  };
  return h.svg(
    Object.entries(LUCIDE_SVG_ATTRIBUTES).map(([key, value]) => h.Attribute(key, value)),
    icon.flatMap(([tag, attributes]) =>
      isSvgChildTag(tag)
        ? [
            elementOf[tag](
              Object.entries(attributes).map(([key, value]) => h.Attribute(key, String(value))),
            ),
          ]
        : [],
    ),
  );
};
