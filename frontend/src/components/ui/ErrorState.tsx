import { apiErrorMessage } from "../../lib/errors";
import { Button } from "./Button";

/** Menampilkan pesan API apa adanya + tombol "Coba lagi" (docs/06 §5). */
export function ErrorState({
  error,
  onRetry,
  title = "Gagal memuat data",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 p-6">
      <p className="font-medium text-warn">{title}</p>
      <p className="text-sm text-fg-muted">{apiErrorMessage(error)}</p>
      {onRetry && (
        <Button className="mt-1" onClick={onRetry}>
          Coba lagi
        </Button>
      )}
    </div>
  );
}
