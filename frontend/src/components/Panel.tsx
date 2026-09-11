import type { ReactNode } from "react";

interface Props {
  title: string;
  id?: string;
  children: ReactNode;
}

export function Panel({ title, id, children }: Props) {
  return (
    <section
      id={id}
      className="mt-6 rounded-[10px] border border-line bg-panel px-6 py-5"
    >
      <h2 className="mb-4 text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-6">
      <h3 className="mb-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.09em] text-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}
