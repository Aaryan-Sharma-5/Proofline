import type { ReactNode } from "react";

interface Props {
  title: string;
  id?: string;
  children: ReactNode;
  connected?: boolean;
  connectsDown?: boolean;
}

export function Panel({ title, id, children, connected = false, connectsDown = false }: Props) {
  return (
    <section
      id={id}
      className={[
        "rounded-[10px] border border-line bg-panel px-6 py-6",
        connected ? "mt-0 rounded-t-none border-t-0" : "mt-5",
        connectsDown ? "rounded-b-none" : "",
      ].join(" ")}
    >
      <h2 className="mb-4.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-7">
      <h3 className="mb-2.5 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-faint">
        {title}
      </h3>
      {children}
    </div>
  );
}
