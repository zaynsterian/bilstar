import * as React from "react";
import { cn } from "../../lib/utils";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function Checkbox({ className, checked, defaultChecked, disabled, onCheckedChange, ...props }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      className={cn("h-4 w-4 rounded border border-border align-middle", className)}
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  );
}
