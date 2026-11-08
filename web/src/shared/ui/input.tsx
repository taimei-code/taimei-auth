import * as React from "react";

import { cn } from "../utils";
import { inputClassName } from "./class-names";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return <input type={type} className={cn(inputClassName, className)} ref={ref} {...props} />;
  },
);
Input.displayName = "Input";

export { Input };
