"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  isStaleBuildError,
  reloadForNewBuild,
  reportClientError,
} from "../lib/report-client-error";

/**
 * Shown when part of the app fails to render. The rest of the terminal keeps working, the error
 * reaches the server logs, and the user can retry without losing the tab.
 */
export function ErrorFallback({
  error,
  reset,
  kind,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  kind: "boundary" | "global";
}) {
  const staleBuild = isStaleBuildError(error);
  useEffect(() => {
    if (staleBuild && reloadForNewBuild()) return;
    reportClientError(error, kind, error.digest);
  }, [error, kind, staleBuild]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-5 py-12">
      <div className="w-full max-w-md border border-line bg-ink p-6">
        <p className="eyebrow">Something went wrong</p>
        <h1 className="mt-3 text-xl font-semibold text-bone">
          {staleBuild ? "Sisera was just updated." : "This page hit a problem."}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          {staleBuild
            ? "Reload to get the latest version."
            : "Your funds and open orders are not affected. Try again, or reload the page if it keeps happening. We've been notified."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => (staleBuild ? window.location.reload() : reset())}
            className="bg-bronze-300 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-bronze-200"
          >
            {staleBuild ? "Reload" : "Try again"}
          </button>
          {!staleBuild && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="border border-line-strong px-4 py-2.5 text-sm text-bone hover:border-bone"
            >
              Reload page
            </button>
          )}
          <Link href="/portfolio" className="px-2 py-2.5 text-sm text-slate-400 hover:text-bone">
            Go to portfolio
          </Link>
        </div>
        {error.digest && (
          <p className="mt-5 font-mono text-[10px] text-slate-600">Reference {error.digest}</p>
        )}
      </div>
    </div>
  );
}
