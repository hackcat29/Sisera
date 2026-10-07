import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  actions,
}: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 border-b border-line px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="data-label text-bronze-300">{eyebrow}</p>
        <h1 className="display mt-2 text-[28px] leading-tight text-bone">{title}</h1>
      </div>
      {actions}
    </div>
  );
}
