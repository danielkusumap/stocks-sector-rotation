import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement } from "react";

/** Tooltip Radix — muncul saat hover DAN fokus keyboard (docs/06 §9 no.1). */
export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={6}
            className="z-50 max-w-72 rounded-sm border border-border bg-surface px-2 py-1 text-sm text-fg shadow-float"
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
