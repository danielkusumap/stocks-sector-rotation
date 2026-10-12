export default function Placeholder({ children }: { children: string }) {
  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <p className="text-base text-fg-muted">{children}</p>
    </section>
  );
}
