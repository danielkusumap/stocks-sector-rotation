import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** Label ringkas 20px (mis. penanda papan "PK"). Teks selalu ada, warna hanya pelengkap. */
export function Badge({
  children,
  title,
  className,
}: {
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center rounded-sm border border-border bg-bg-subtle px-1.5 font-mono text-sm text-fg-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
