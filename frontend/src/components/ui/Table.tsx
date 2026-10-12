import type { ReactNode } from "react";

export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`h-8 bg-bg-subtle px-2 text-left text-xs font-medium tracking-[0.04em] text-fg-muted uppercase ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`h-9 border-b border-border px-2 align-middle ${className}`}>
      {children}
    </td>
  );
}
