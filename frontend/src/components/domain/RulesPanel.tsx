import { formatNum } from "../../lib/format";

/**
 * Panel **"Aturan penyaringan"** (docs/08 F25 butir 7): `rules[]` ditampilkan **apa adanya** dari
 * `GET /plan/picks`. Aturan inilah satu-satunya penentu pick — bukan daftar 962 emiten.
 */
export function RulesPanel({ rules }: { rules: readonly string[] }) {
  return (
    <details data-testid="rules-panel" className="rounded-md border border-border bg-surface">
      <summary className="cursor-pointer px-3 py-2 font-medium">
        Aturan penyaringan ({formatNum(rules.length)} aturan)
      </summary>
      <div className="flex flex-col gap-1.5 border-t border-border px-3 py-2 text-sm">
        <p className="text-fg-muted">
          Aturan ini satu-satunya penentu pick — bukan daftar 962 emiten. Pick ditampilkan apa adanya
          dari hasil saring backend.
        </p>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </div>
    </details>
  );
}
