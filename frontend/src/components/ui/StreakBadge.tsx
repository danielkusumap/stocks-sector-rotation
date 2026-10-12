import { streakLabel } from "../../lib/labels";
import { Tooltip } from "./Tooltip";

export function StreakBadge({ weeks }: { weeks: number }) {
  const label = streakLabel(weeks);
  if (!label) return null;
  return (
    <Tooltip label={`muncul ${weeks} minggu berturut-turut`}>
      <span className="inline-flex h-5 items-center rounded-sm bg-accent-subtle px-1.5 font-mono text-sm font-medium text-fg">
        {label}
      </span>
    </Tooltip>
  );
}
