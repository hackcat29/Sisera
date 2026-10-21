"use client";

import { useEffect } from "react";
import { reportClientError } from "../lib/report-client-error";

// Browser noise that says nothing about Sisera's own code.
const IGNORED = /ResizeObserver loop|Script error\.?$|extension:\/\//;

/** Reports errors thrown outside rendering, such as in button handlers and background requests. */
export function ClientErrorListener() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (IGNORED.test(event.message) || IGNORED.test(event.filename ?? "")) return;
      reportClientError(event.error ?? event.message, "window");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
      if (IGNORED.test(reason)) return;
      reportClientError(event.reason, "promise");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
