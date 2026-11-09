const SECTION_STYLES = {
  detail: "margin-top:1.5rem",
  closingNote: "margin-top:2rem",
  unstyled: null,
} as const;

const ZERO_MARGINS = "margin-top:0;margin-bottom:0;margin-left:0;margin-right:0";

const PARAGRAPH_STYLES = {
  secondary: `font-size:0.875rem;line-height:1.625;margin:0;text-align:center;color:#737373;${ZERO_MARGINS}`,
  smallSecondary: `font-size:0.75rem;line-height:1.625;margin:0;text-align:center;color:#a3a3a3;${ZERO_MARGINS}`,
  warning: `font-size:0.875rem;line-height:1.625;margin:0;text-align:center;color:#dc2626;${ZERO_MARGINS}`,
  expiryNotice:
    "font-size:0.875rem;line-height:1.4285714285714286;margin-top:1.5rem;text-align:center;color:#dc2626;margin-bottom:16px",
} as const;

const STYLES = {
  headerWithoutLogo: "margin-top:1rem",
  headerBelowLogo: "margin-top:2.5rem",
  heading:
    "margin:0;text-align:center;font-size:1.5rem;line-height:1.3333333333333333;font-weight:500;letter-spacing:-0.025em;color:#171717",
  intro:
    "font-size:1rem;line-height:1.625;margin-top:1rem;text-align:center;color:#737373;margin-bottom:16px",
  link: "color:#067df7;text-decoration-line:none",
  fallbackUrlParagraph:
    "font-size:14px;line-height:24px;margin-top:0.5rem;text-align:center;margin-bottom:16px",
  fallbackUrlLink:
    "color:#dc2626;text-decoration-line:underline;word-break:break-all;font-size:0.75rem;line-height:1.3333333333333333",
  copyright: `font-size:0.75rem;line-height:1.3333333333333333;margin:0;text-align:center;color:#d4d4d4;${ZERO_MARGINS}`,
  buttonSection: "margin-top:2rem;text-align:center",
  button:
    "line-height:1.5;text-decoration:none;display:inline-block;max-width:100%;mso-padding-alt:0px;border-radius:0.5rem;padding-right:32px;padding-left:32px;padding-bottom:12px;padding-top:12px;text-align:center;font-size:1rem;font-weight:500;color:rgb(255,255,255);text-decoration-line:none;background-color:#171717",
  buttonLabel:
    "max-width:100%;display:inline-block;line-height:120%;mso-padding-alt:0px;mso-text-raise:9px",
  logoSection: "text-align:center",
  logo: "display:block;outline:none;border:none;text-decoration:none;margin-right:auto;margin-left:auto",
  divider:
    "width:100%;border:none;border-top:1px solid #eaeaea;margin-bottom:2.5rem;margin-top:2.5rem;border-color:#e5e5e5",
  preview: "display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0",
  body: "background-color:rgb(255,255,255);margin-right:0;margin-left:0",
  bodyCell:
    "margin-right:auto;margin-left:auto;background-color:rgb(255,255,255);font-family:ui-sans-serif,system-ui,sans-serif,&quot;Apple Color Emoji&quot;,&quot;Segoe UI Emoji&quot;,&quot;Segoe UI Symbol&quot;,&quot;Noto Color Emoji&quot;",
  container:
    "max-width:480px;margin-right:auto;margin-left:auto;padding-right:1.5rem;padding-left:1.5rem;padding-bottom:3rem;padding-top:3rem",
} as const;

type LineBreak = { readonly _tag: "LineBreak" };
type Strong = { readonly _tag: "Strong"; readonly text: string };
type UrlLink = { readonly _tag: "UrlLink"; readonly url: string };
type MailLink = { readonly _tag: "MailLink"; readonly address: string };
type Inline = string | LineBreak | Strong | UrlLink | MailLink;

type Block =
  | {
      readonly _tag: "Section";
      readonly style: keyof typeof SECTION_STYLES;
      readonly blocks: readonly Block[];
    }
  | {
      readonly _tag: "Paragraph";
      readonly style: keyof typeof PARAGRAPH_STYLES;
      readonly inlines: readonly Inline[];
    }
  | { readonly _tag: "Button"; readonly href: string; readonly label: string }
  | { readonly _tag: "FallbackUrl"; readonly url: string };

export type EmailBody = {
  readonly appName: string;
  readonly preview: string;
  readonly logo: "shown" | "hidden";
  readonly title: string;
  readonly intro: readonly Inline[];
  readonly main: readonly Block[];
  readonly footer: readonly Block[];
};

export const br: LineBreak = { _tag: "LineBreak" };
export const strong = (text: string): Strong => ({ _tag: "Strong", text });
export const urlLink = (url: string): UrlLink => ({ _tag: "UrlLink", url });
export const mailLink = (address: string): MailLink => ({ _tag: "MailLink", address });

export const section = (style: keyof typeof SECTION_STYLES, ...blocks: Block[]): Block => ({
  _tag: "Section",
  style,
  blocks,
});
export const paragraph = (style: keyof typeof PARAGRAPH_STYLES, ...inlines: Inline[]): Block => ({
  _tag: "Paragraph",
  style,
  inlines,
});
export const button = (href: string, label: string): Block => ({ _tag: "Button", href, label });
export const fallbackUrl = (url: string): Block => ({ _tag: "FallbackUrl", url });

const LOGO_URL =
  "https://7iv4djergayei7gf.public.blob.vercel-storage.com/taimei/public/my-service-logo.png";

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

const escapeHtml = (value: string): string =>
  value.replaceAll(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

const TABLE_OPEN =
  '<table align="center" width="100%" border="0" cellPadding="0" cellSpacing="0" role="presentation"';

const tableHtml = (style: string | null, inner: string): string =>
  `${TABLE_OPEN}${style === null ? "" : ` style="${style}"`}><tbody><tr><td>${inner}</td></tr></tbody></table>`;

const linkHtml = (href: string, style: string, text: string): string =>
  `<a href="${escapeHtml(href)}" style="${style}" target="_blank">${escapeHtml(text)}</a>`;

const inlineHtml = (inline: Inline): string => {
  if (typeof inline === "string") {
    return escapeHtml(inline);
  }
  switch (inline._tag) {
    case "LineBreak":
      return "<br/>";
    case "Strong":
      return `<strong>${escapeHtml(inline.text)}</strong>`;
    case "UrlLink":
      return linkHtml(inline.url, STYLES.link, inline.url);
    case "MailLink":
      return linkHtml(`mailto:${inline.address}`, STYLES.link, inline.address);
  }
};

const inlinesHtml = (inlines: readonly Inline[]): string => inlines.map(inlineHtml).join("");

const OUTLOOK_BUTTON_LEFT_PADDING =
  '<span><!--[if mso]><i style="mso-font-width:400%;mso-text-raise:18" hidden>&#8202;&#8202;&#8202;&#8202;</i><![endif]--></span>';
const OUTLOOK_BUTTON_RIGHT_PADDING =
  '<span><!--[if mso]><i style="mso-font-width:400%" hidden>&#8202;&#8202;&#8202;&#8202;&#8203;</i><![endif]--></span>';

const blockHtml = (block: Block): string => {
  switch (block._tag) {
    case "Section":
      return tableHtml(SECTION_STYLES[block.style], block.blocks.map(blockHtml).join(""));
    case "Paragraph":
      return `<p style="${PARAGRAPH_STYLES[block.style]}">${inlinesHtml(block.inlines)}</p>`;
    case "Button":
      return tableHtml(
        STYLES.buttonSection,
        `<a href="${escapeHtml(block.href)}" style="${STYLES.button}" target="_blank">${OUTLOOK_BUTTON_LEFT_PADDING}<span style="${STYLES.buttonLabel}">${escapeHtml(block.label)}</span>${OUTLOOK_BUTTON_RIGHT_PADDING}</a>`,
      );
    case "FallbackUrl":
      return `<p style="${STYLES.fallbackUrlParagraph}">${linkHtml(block.url, STYLES.fallbackUrlLink, block.url)}</p>`;
  }
};

const PREVIEW_MAX_LENGTH = 150;
const PREVIEW_PADDING = "\u00A0\u200C\u200B\u200D\u200E\u200F\uFEFF";

const previewHtml = (preview: string): string => {
  const text = preview.substring(0, PREVIEW_MAX_LENGTH);
  const padding =
    text.length < PREVIEW_MAX_LENGTH
      ? `<div>${PREVIEW_PADDING.repeat(PREVIEW_MAX_LENGTH - text.length)}</div>`
      : "";
  return `<div style="${STYLES.preview}" data-skip-in-text="true">${escapeHtml(text)}${padding}</div>`;
};

const FONT_IMPORT = `
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap');
          `;

const DIVIDER_HTML = `<hr style="${STYLES.divider}"/>`;

const copyrightText = (body: EmailBody, year: number): string => `© ${year} ${body.appName}`;

const renderHtml = (body: EmailBody, year: number): string => {
  const logoShown = body.logo === "shown";
  const logoPreload = logoShown ? `<link rel="preload" as="image" href="${LOGO_URL}"/>` : "";
  const logo = logoShown
    ? tableHtml(
        STYLES.logoSection,
        `<img alt="${escapeHtml(body.appName)}" height="80" src="${LOGO_URL}" style="${STYLES.logo}" width="80"/>`,
      )
    : "";
  const header = tableHtml(
    logoShown ? STYLES.headerBelowLogo : STYLES.headerWithoutLogo,
    `<h1 style="${STYLES.heading}">${escapeHtml(body.title)}</h1><p style="${STYLES.intro}">${inlinesHtml(body.intro)}</p>`,
  );
  const content = [
    logo,
    header,
    ...body.main.map(blockHtml),
    DIVIDER_HTML,
    ...body.footer.map(blockHtml),
    DIVIDER_HTML,
    `<p style="${STYLES.copyright}">${escapeHtml(copyrightText(body, year))}</p>`,
  ].join("");
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html dir="ltr" lang="ja"><head>${logoPreload}<meta content="text/html; charset=UTF-8" http-equiv="Content-Type"/><meta name="x-apple-disable-message-reformatting"/><style>${FONT_IMPORT}</style></head><body style="${STYLES.body}">${previewHtml(body.preview)}<table border="0" width="100%" cellPadding="0" cellSpacing="0" role="presentation" align="center"><tbody><tr><td style="${STYLES.bodyCell}">${TABLE_OPEN} style="${STYLES.container}"><tbody><tr style="width:100%"><td>${content}</td></tr></tbody></table></td></tr></tbody></table></body></html>`;
};

const HTML_TO_TEXT_WHITESPACE_RUN = /[ \t\r\n\f\u200B]+/g;

const collapseWhitespace = (value: string): string =>
  value.replaceAll(HTML_TO_TEXT_WHITESPACE_RUN, " ");

const inlineText = (inline: Inline): string => {
  if (typeof inline === "string") {
    return collapseWhitespace(inline);
  }
  switch (inline._tag) {
    case "LineBreak":
      return "\n";
    case "Strong":
      return collapseWhitespace(inline.text);
    case "UrlLink":
      return inline.url;
    case "MailLink":
      return inline.address;
  }
};

const inlinesText = (inlines: readonly Inline[]): string => inlines.map(inlineText).join("");

const blockTexts = (block: Block): readonly string[] => {
  switch (block._tag) {
    case "Section":
      return block.blocks.flatMap(blockTexts);
    case "Paragraph":
      return [inlinesText(block.inlines)];
    case "Button":
      return [`${block.label} ${block.href}`];
    case "FallbackUrl":
      return [block.url];
  }
};

const DIVIDER_TEXT = "-".repeat(40);

const renderText = (body: EmailBody, year: number): string =>
  [
    collapseWhitespace(body.title).toUpperCase(),
    inlinesText(body.intro),
    ...body.main.flatMap(blockTexts),
    DIVIDER_TEXT,
    ...body.footer.flatMap(blockTexts),
    DIVIDER_TEXT,
    copyrightText(body, year),
  ].join("\n\n");

export const renderEmail = (
  body: EmailBody,
  year: number,
): { readonly html: string; readonly text: string } => ({
  html: renderHtml(body, year),
  text: renderText(body, year),
});
