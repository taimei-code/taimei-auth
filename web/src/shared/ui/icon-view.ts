import type { Attribute, Html, HtmlBuilder } from "foldkit/html";
import { LoaderCircle, type IconNode } from "lucide";

type SvgChildTag = "path" | "circle" | "line" | "rect" | "polyline" | "polygon" | "ellipse" | "g";

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

const svgView = <Message>(
  icon: IconNode,
  extraAttributes: ReadonlyArray<Attribute<Message>>,
  h: HtmlBuilder<Message>,
): Html => {
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
  const isSvgChildTag = (tag: string): tag is SvgChildTag => Object.hasOwn(elementOf, tag);
  return h.svg(
    [
      ...Object.entries(LUCIDE_SVG_ATTRIBUTES).map(([key, value]) => h.Attribute(key, value)),
      ...extraAttributes,
    ],
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

export const iconView = <Message>(icon: IconNode, h: HtmlBuilder<Message>): Html =>
  svgView(icon, [], h);

export const spinnerView = <Message>(h: HtmlBuilder<Message>): Html =>
  svgView(LoaderCircle, [h.Class("animate-spin")], h);

export const loadingStatusView = <Message>(label: string, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("flex justify-center py-6"), h.Role("status"), h.AriaLive("polite")],
    [
      svgView(LoaderCircle, [h.Class("size-5 animate-spin text-muted-foreground")], h),
      h.span([h.Class("sr-only")], [label]),
    ],
  );
