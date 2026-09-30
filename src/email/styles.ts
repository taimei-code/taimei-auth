import type { CSSProperties } from "react";

export const body = {
  marginRight: "auto",
  marginLeft: "auto",
  backgroundColor: "rgb(255,255,255)",
  fontFamily:
    'ui-sans-serif,system-ui,sans-serif,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol","Noto Color Emoji"',
} satisfies CSSProperties;

export const container = {
  maxWidth: "480px",
  marginRight: "auto",
  marginLeft: "auto",
  paddingRight: "1.5rem",
  paddingLeft: "1.5rem",
  paddingBottom: "3rem",
  paddingTop: "3rem",
} satisfies CSSProperties;

export const headerSection = { marginTop: "1rem" } satisfies CSSProperties;

export const heading = {
  margin: 0,
  textAlign: "center",
  fontSize: "1.5rem",
  lineHeight: "1.3333333333333333",
  fontWeight: 500,
  letterSpacing: "-0.025em",
  color: "#171717",
} satisfies CSSProperties;

export const introText = {
  fontSize: "1rem",
  lineHeight: "1.625",
  marginTop: "1rem",
  textAlign: "center",
  color: "#737373",
} satisfies CSSProperties;

export const detailSection = { marginTop: "1.5rem" } satisfies CSSProperties;

export const secondaryText = {
  fontSize: "0.875rem",
  lineHeight: "1.625",
  margin: 0,
  textAlign: "center",
  color: "#737373",
} satisfies CSSProperties;

export const buttonSection = { marginTop: "2rem", textAlign: "center" } satisfies CSSProperties;

export const button = {
  display: "inline-block",
  borderRadius: "0.5rem",
  paddingRight: "2rem",
  paddingLeft: "2rem",
  paddingBottom: "0.75rem",
  paddingTop: "0.75rem",
  textAlign: "center",
  fontSize: "1rem",
  lineHeight: "1.5",
  fontWeight: 500,
  color: "rgb(255,255,255)",
  textDecorationLine: "none",
  backgroundColor: "#171717",
} satisfies CSSProperties;

export const divider = {
  marginBottom: "2.5rem",
  marginTop: "2.5rem",
  borderColor: "#e5e5e5",
} satisfies CSSProperties;

export const copyrightText = {
  fontSize: "0.75rem",
  lineHeight: "1.3333333333333333",
  margin: 0,
  textAlign: "center",
  color: "#d4d4d4",
} satisfies CSSProperties;

export const logoSection = { textAlign: "center" } satisfies CSSProperties;

export const logo = { marginRight: "auto", marginLeft: "auto" } satisfies CSSProperties;

export const headerSectionBelowLogo = { marginTop: "2.5rem" } satisfies CSSProperties;

export const expiryNotice = {
  fontSize: "0.875rem",
  lineHeight: "1.4285714285714286",
  marginTop: "1.5rem",
  textAlign: "center",
  color: "#dc2626",
} satisfies CSSProperties;

export const warningText = { ...secondaryText, color: "#dc2626" } satisfies CSSProperties;

export const smallSecondaryText = {
  ...secondaryText,
  fontSize: "0.75rem",
  color: "#a3a3a3",
} satisfies CSSProperties;

export const fallbackUrlParagraph = {
  marginTop: "0.5rem",
  textAlign: "center",
} satisfies CSSProperties;

export const fallbackUrlLink = {
  wordBreak: "break-all",
  fontSize: "0.75rem",
  lineHeight: "1.3333333333333333",
  textDecorationLine: "underline",
  color: "#dc2626",
} satisfies CSSProperties;

export const closingNoteSection = { marginTop: "2rem" } satisfies CSSProperties;
