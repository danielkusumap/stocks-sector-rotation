import type { ReactNode } from "react";

export function Panel({
  title,
  actions,
  children,
  className = "",
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-md border border-border bg-surface ${className}`}>
      <header className="flex h-10 items-center gap-3 border-b border-border px-3">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
