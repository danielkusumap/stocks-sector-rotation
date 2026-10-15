import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { API_KEY_STORAGE, getCredentials, setCredentials, splitCredentials } from "../../lib/api";
import { Button } from "../ui/Button";

/**
 * Kredensial UI (docs/05 §4.5): basic auth nginx + kunci API `/admin/*`.
 *
 * Diisi SEKALI lalu disimpan di `localStorage`; aplikasi mengirim keduanya di tiap request
 * (`api.ts`). Nginx hanya meminta basic auth di `/api/`, jadi browser tidak lagi memunculkan
 * dialognya sendiri tiap pindah halaman.
 */
export function CredentialsForm({ onSaved }: { onSaved: () => void }) {
  const stored = getCredentials();
  const [user, setUser] = useState(stored ? splitCredentials(stored).user : "");
  const [password, setPassword] = useState(stored ? splitCredentials(stored).password : "");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setCredentials(user, password);
    if (apiKey) localStorage.setItem(API_KEY_STORAGE, apiKey);
    else localStorage.removeItem(API_KEY_STORAGE);
    onSaved();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="creds-form">
      <Field label="Pengguna" value={user} onChange={setUser} autoComplete="username" />
      <Field
        label="Kata sandi"
        value={password}
        onChange={setPassword}
        type="password"
        autoComplete="current-password"
      />
      <Field
        label="Kunci API (opsional)"
        value={apiKey}
        onChange={setApiKey}
        autoComplete="off"
        hint="Isi kalau server memakai API__API_KEY; dipakai tombol admin (halaman Data)."
      />
      <Button
        type="submit"
        variant="primary"
        disabled={!user || !password}
        data-testid="creds-save"
        className="mt-1 self-start"
      >
        Simpan
      </Button>
    </form>
  );
}

/** Gerbang penuh layar: dipakai saat kredensial belum ada (deploy di belakang nginx basic auth). */
export function AuthGate({ onSaved }: { onSaved: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4 text-fg">
      <div className="w-full max-w-sm rounded-md border border-border bg-surface p-6">
        <h1 className="flex items-center gap-2 font-semibold">
          <KeyRound size={16} strokeWidth={1.75} aria-hidden="true" />
          IDX-RRG
        </h1>
        <p className="mt-1 mb-4 text-sm text-fg-muted">
          Isi kredensial sekali. Setelah disimpan, kamu tidak diminta lagi walau pindah halaman.
        </p>
        <CredentialsForm onSaved={onSaved} />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  hint,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password";
  hint?: string;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-fg-muted">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-sm border border-border-strong bg-surface px-2 text-base text-fg"
      />
      {hint && <span className="text-xs text-fg-faint">{hint}</span>}
    </label>
  );
}
