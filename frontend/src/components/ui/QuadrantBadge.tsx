import type { Quadrant } from "../../lib/api";
import { QUADRANT_BG, QUADRANT_COLOR, QUADRANT_LABEL } from "../../lib/quadrant";

/** Badge 20px: dot warna kuadran + label Indonesia (warna dari token, ADR-010). */
export function QuadrantBadge({ quadrant }: { quadrant: Quadrant | null | undefined }) {
  if (!quadrant) return <span className="text-fg-faint">—</span>;
  return (
    <span
      className="inline-flex h-5 items-center gap-1.5 rounded-sm px-1.5"
      style={{ backgroundColor: QUADRANT_BG[quadrant] }}
      title={QUADRANT_LABEL[quadrant]}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: QUADRANT_COLOR[quadrant] }}
      />
      {QUADRANT_LABEL[quadrant]}
    </span>
  );
}
