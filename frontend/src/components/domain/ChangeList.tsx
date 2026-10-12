import { QUADRANT_LABEL } from "../../lib/quadrant";
import { formatDate } from "../../lib/format";

/** Daftar sektor yang pindah kuadran (docs/06 §8 "Perubahan Kuadran"). */
export function ChangeList({
  changes,
}: {
  changes: { ref_id: string; name: string; from: string; to: string; as_of: string }[];
}) {
  if (changes.length === 0) {
    return <p className="p-3 text-sm text-fg-faint">Tidak ada sektor yang pindah kuadran.</p>;
  }
  return (
    <ul className="flex flex-col gap-1 p-3">
      {changes.map((change) => (
        <li
          key={change.ref_id}
          data-testid={`change-${change.ref_id}`}
          className="flex items-baseline gap-2 text-sm"
        >
          <span className="font-medium">{change.name}</span>
          <span className="text-fg-muted">
            {QUADRANT_LABEL[change.from as keyof typeof QUADRANT_LABEL] ?? change.from} →{" "}
            {QUADRANT_LABEL[change.to as keyof typeof QUADRANT_LABEL] ?? change.to}
          </span>
          <span className="ml-auto font-mono text-xs text-fg-faint">{formatDate(change.as_of)}</span>
        </li>
      ))}
    </ul>
  );
}
