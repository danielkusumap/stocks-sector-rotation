/**
 * Catatan periode untuk header panel (`docs/08` F13 C11): satu bentuk teks untuk
 * semua tempat supaya screenshot self-explanatory & tidak ada dua gaya penulisan.
 */
export function PeriodNote({ text }: { text: string }) {
  return (
    <span data-testid="periode-note" className="text-sm text-fg-muted">
      {text}
    </span>
  );
}
