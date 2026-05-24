import Link from "next/link";

export function Breadcrumb({
  items,
}: {
  items: Array<{ name: string; href?: string }>;
}) {
  return (
    <nav
      aria-label="Brödsmulor"
      className="mb-4 font-mono text-xs text-[var(--text-dim)]"
    >
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {it.href && !last ? (
                <Link
                  href={it.href}
                  className="transition-colors hover:text-[var(--brand-ink)]"
                >
                  {it.name}
                </Link>
              ) : (
                <span className={last ? "text-[var(--text-strong)]" : ""}>
                  {it.name}
                </span>
              )}
              {!last && (
                <span aria-hidden className="text-[var(--text-faint)]">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
