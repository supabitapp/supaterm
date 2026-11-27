import type { ReactNode } from "react";

// Each part of the page is one band: its label on the left, its rows on the right.
export function WelcomeSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid gap-x-10 border-b border-border/60 py-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <h2 className="text-sm leading-10 text-muted-foreground">{title}</h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

// Rows share one icon column, so names, checkboxes, and steps line up down the page.
export function RowIcon({ children }: { readonly children: ReactNode }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
      {children}
    </span>
  );
}
