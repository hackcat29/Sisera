"use client";

import { useEffect, useState } from "react";

/**
 * A token logo that never leaves an empty circle. Logos are hosted by third parties and some load
 * slowly or not at all, so the token's initials show immediately and the logo replaces them only
 * once it has loaded within a few seconds.
 */
export function TokenAvatar({
  src,
  symbol,
  size = 28,
  className = "rounded-full",
}: {
  src: string | null | undefined;
  symbol: string;
  size?: number;
  className?: string;
}) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">(src ? "loading" : "failed");

  useEffect(() => {
    setState(src ? "loading" : "failed");
    if (!src) return;
    const timer = window.setTimeout(
      () => setState((current) => (current === "loading" ? "failed" : current)),
      6000,
    );
    return () => window.clearTimeout(timer);
  }, [src]);

  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden bg-ink font-mono text-[10px] text-slate-400 ${className}`}
      style={{ width: size, height: size }}
    >
      {state !== "loaded" && symbol.slice(0, 2).toUpperCase()}
      {src && state !== "failed" && (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
          className={`absolute inset-0 size-full object-cover transition-opacity ${state === "loaded" ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </span>
  );
}
