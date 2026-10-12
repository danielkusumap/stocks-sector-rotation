import type { ReactNode } from "react";
import type { Dir } from "../../lib/api";
import { cn } from "../../lib/cn";

export function Table({
  caption,
  children,
  className,
}: {
  caption: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse", className)}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
  align = "left",
  sortable = false,
  active = false,
  dir = "desc",
  onSort,
  title,
}: {
  children?: ReactNode;
  className?: string;
  align?: "left" | "right";
  /** header bisa diklik untuk mengubah `sort`/`dir` (docs/08 F5). */
  sortable?: boolean;
  active?: boolean;
  dir?: Dir;
  onSort?: (next: Dir) => void;
  title?: string;
}) {
  const ariaSort = sortable ? (active ? (dir === "asc" ? "ascending" : "descending") : "none") : undefined;
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        "h-8 bg-bg-subtle px-2 text-xs font-medium tracking-[0.04em] text-fg-muted uppercase",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {sortable && onSort ? (
        <button
          type="button"
          title={title}
          onClick={() => onSort(active && dir === "asc" ? "desc" : "asc")}
          className={cn(
            "inline-flex items-center gap-1 uppercase hover:text-fg",
            align === "right" && "flex-row-reverse",
          )}
        >
          {children}
          <span aria-hidden="true" className={active ? "text-fg" : "opacity-40"}>
            {active && dir === "asc" ? "▲" : "▼"}
          </span>
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function Td({
  children,
  className = "",
  colSpan,
  align = "left",
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  align?: "left" | "right";
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "h-9 border-b border-border px-2 align-middle",
        align === "right" && "text-right",
        className,
      )}
    >
      {children}
    </td>
  );
}
