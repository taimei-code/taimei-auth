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

const statusView = <Message>(
  label: string,
  classNames: Readonly<{ wrapper: string; icon: string }>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class(classNames.wrapper), h.Role("status"), h.AriaLive("polite")],
    [
      svgView(LoaderCircle, [h.Class(`${classNames.icon} animate-spin text-muted-foreground`)], h),
      h.span([h.Class("sr-only")], [label]),
    ],
  );

export const loadingStatusView = <Message>(label: string, h: HtmlBuilder<Message>): Html =>
  statusView(label, { wrapper: "flex justify-center py-6", icon: "size-5" }, h);

export const fullScreenStatusView = <Message>(label: string, h: HtmlBuilder<Message>): Html =>
  statusView(label, { wrapper: "flex min-h-svh items-center justify-center", icon: "size-6" }, h);

export const listLoadingStatusView = <Message>(label: string, h: HtmlBuilder<Message>): Html =>
  statusView(label, { wrapper: "flex justify-center py-12", icon: "size-6" }, h);
