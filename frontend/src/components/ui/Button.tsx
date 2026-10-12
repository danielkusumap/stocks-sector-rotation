import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "outline" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  outline: "border border-border-strong text-fg hover:bg-surface-hover",
  ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
};

export function Button({
  variant = "outline",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm px-3 font-medium disabled:cursor-not-allowed disabled:opacity-45 ${VARIANT[variant]} ${className}`}
      {...props}
    />
  );
}
