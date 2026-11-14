import { cva } from "class-variance-authority";

export const alertVariants = cva(
  "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export const alertClassNames = {
  title: "mb-1 font-medium leading-none tracking-tight",
  description: "text-sm [&_p]:leading-relaxed",
} as const;

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export const subtleLinkButtonClassName =
  "rounded-sm text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:pointer-events-none aria-disabled:opacity-50";

export const smallLinkButtonClassName =
  "text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground";

export const textLinkClassName =
  "rounded-sm font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const inputClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

export const labelClassName =
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70";

export const cardClassNames = {
  root: "rounded-lg border bg-card text-card-foreground shadow-sm",
  header: "flex flex-col space-y-1.5 p-6",
  title: "text-balance text-2xl font-semibold leading-none tracking-tight",
  description: "text-sm text-muted-foreground",
  content: "p-6 pt-0",
  footer: "flex items-center p-6 pt-0",
} as const;

export const dialogClassNames = {
  overlay:
    "fixed inset-0 z-50 bg-black/80 transition-opacity duration-200 ease-out data-[closed]:opacity-0 motion-reduce:transition-none",
  content:
    "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg transition duration-200 ease-out data-[closed]:scale-95 data-[closed]:opacity-0 motion-reduce:transition-none sm:rounded-lg",
  header: "flex flex-col space-y-1.5 text-center sm:text-left",
  footer: "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
  title: "text-balance text-lg font-semibold leading-none tracking-tight",
  description: "text-sm text-muted-foreground",
  close:
    "absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:opacity-50 disabled:pointer-events-none",
} as const;

const GUTTER_FOR_FORMS_PLUGIN_CHEVRON = "pr-8";
const HEIGHT_FITTING_FORMS_PLUGIN_PY_2 = "h-10";

export const nativeSelectClassNames = {
  root: "block w-full truncate rounded-md border border-input bg-transparent pl-3 text-base text-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
  height: HEIGHT_FITTING_FORMS_PLUGIN_PY_2,
  gutter: GUTTER_FOR_FORMS_PLUGIN_CHEVRON,
} as const;

export const avatarClassNames = {
  root: "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
  image: "aspect-square h-full w-full",
  fallback: "flex h-full w-full items-center justify-center rounded-full bg-muted",
} as const;
