type ErrorKind = "boundary" | "global" | "window" | "promise";

const sent = new Set<string>();

/** Sends a browser error to the server logs once per page load. Never throws. */
export function reportClientError(error: unknown, kind: ErrorKind, digest?: string) {
  try {
    const value = error instanceof Error ? error : new Error(String(error));
    const key = `${kind}:${value.message}`;
    if (sent.has(key) || sent.size >= 10) return;
    sent.add(key);
    const body = JSON.stringify({
      kind,
      path: window.location.pathname,
      name: value.name,
      message: value.message,
      digest,
      stack: value.stack?.split("\n").slice(0, 8).join("\n"),
    });
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Reporting must never cause a second failure.
  }
}

/** A tab opened before a deploy can ask for script files the new release no longer has. */
export function isStaleBuildError(error: unknown) {
  const value = error instanceof Error ? error : null;
  return (
    value?.name === "ChunkLoadError" ||
    /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(
      value?.message ?? "",
    )
  );
}

/** Reloads once to pick up the new release; returns false if this tab already tried. */
export function reloadForNewBuild() {
  try {
    const key = "sisera:reloaded-for-build";
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
