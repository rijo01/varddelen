import Link from "next/link";

export function Breadcrumb({
  items,
}: {
  items: Array<{ name: string; href?: string }>;
}) {
  return (
    <nav
      aria-label="Brödsmulor"
      className="text-[15px] text-[var(--text-dim)]"
    >
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {it.href && !last ? (
                <Link
                  href={it.href}
                  className="underline-offset-4 hover:text-[var(--brand-ink)] hover:underline"
                >
                  {it.name}
                </Link>
              ) : (
                <span className={last ? "text-[var(--text-strong)]" : ""}>
                  {it.name}
                </span>
              )}
              {!last && (
                <span aria-hidden className="text-[var(--text-dim)]">
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
