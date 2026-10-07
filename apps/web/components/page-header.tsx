import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 border-b border-line px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="data-label text-bronze-300">{eyebrow}</p>
        <h1 className="display mt-2 text-[28px] leading-tight text-bone">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-slate-400">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}
