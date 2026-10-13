import type { Layer } from "../../lib/api";
import { LAYER_HINT, LAYER_LABEL, LAYER_ORDER } from "../../lib/candleChart";
import { cn } from "../../lib/cn";

/**
 * Toggle lapisan grafik (docs/06 §6.6/§6.7): `Indikator` aktif secara bawaan, `SMC` & `Elliott`
 * mati. Gaya menyusul `ui/Segmented` (satu baris, `aria-pressed`) tapi multi-pilih; pilihan
 * hidup di URL (`layers`) — bukan state tersembunyi. Keterangan jujur SMC/Elliott lewat `title`.
 */
export function LayerToggles({
  layers,
  onToggle,
  className,
}: {
  layers: readonly Layer[];
  onToggle: (layer: Layer) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Lapisan grafik"
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-bg-subtle p-0.5",
        className,
      )}
    >
      {LAYER_ORDER.map((layer) => {
        const on = layers.includes(layer);
        return (
          <button
            key={layer}
            type="button"
            data-testid={`layer-${layer}`}
            aria-pressed={on}
            title={LAYER_HINT[layer]}
            onClick={() => onToggle(layer)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5",
              on ? "bg-surface font-medium text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {LAYER_LABEL[layer]}
          </button>
        );
      })}
    </div>
  );
}
