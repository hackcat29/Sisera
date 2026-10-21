"use client";

import { ErrorFallback } from "../../components/error-fallback";

// Keeps the navigation and header on screen when a page fails, instead of blanking the app.
export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} kind="boundary" />;
}
