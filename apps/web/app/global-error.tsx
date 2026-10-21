"use client";

import { ErrorFallback } from "../components/error-fallback";
import "./globals.css";

// Last resort when the root layout itself fails; it replaces the whole document.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-ink-deep text-bone">
        <ErrorFallback error={error} reset={reset} kind="global" />
      </body>
    </html>
  );
}
