"use client";

import { useId, type ReactNode } from "react";

/** Visible, named sections shared by the owner and delegated account editors. */
export function PersonSection({ title, children }: { title: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="section-panel flex min-w-0 flex-col gap-4">
      <h3 id={heading} className="section-heading font-ui text-lg font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}
