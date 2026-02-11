import * as React from "react";
import { cn } from "../../lib/utils";

type BadgeVariant = "default" | "secondary";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const v =
    variant === "secondary"
      ? "bg-muted text-foreground"
      : "bg-black text-white";

  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", v, className)}
      {...props}
    />
  );
}
