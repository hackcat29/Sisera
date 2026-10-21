"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A token or company logo that never leaves an empty circle. Logos are hosted by third parties
 * and some load slowly or not at all, so the initials show immediately and a logo replaces them
 * only once it has loaded. Several candidate URLs can be given; each is tried in turn.
 */
export function TokenAvatar({
  src,
  symbol,
  size = 28,
  className = "rounded-full",
}: {
  src: string | readonly (string | null | undefined)[] | null | undefined;
  symbol: string;
  size?: number;
  className?: string;
}) {
  const sources = useMemo(
    () => [...new Set((Array.isArray(src) ? src : [src]).filter((url): url is string => !!url))],
    [src],
  );
  const key = sources.join("|");
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const current = sources[index];
  const image = useRef<HTMLImageElement>(null);
  const shownKey = useRef(key);

  useEffect(() => {
    if (shownKey.current === key) return;
    shownKey.current = key;
    setIndex(0);
    setLoaded(false);
  }, [key]);

  // A server-rendered logo can finish loading before React attaches onLoad, so check on mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check whenever the URL changes.
  useEffect(() => {
    const element = image.current;
    if (element?.complete && element.naturalWidth > 0) setLoaded(true);
  }, [current]);

  // A slow logo moves on to the next candidate; the last one is left to finish loading, since the
  // initials show until it does.
  useEffect(() => {
    if (!current || loaded || index >= sources.length - 1) return;
    const timer = window.setTimeout(() => setIndex((value) => value + 1), 6000);
    return () => window.clearTimeout(timer);
  }, [current, loaded, index, sources.length]);

  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden bg-ink font-mono text-[10px] text-slate-400 ${className}`}
      style={{ width: size, height: size }}
    >
      {!loaded &&
        symbol
          .replace(/[^A-Za-z0-9]/g, "")
          .slice(0, 2)
          .toUpperCase()}
      {current && (
        <img
          ref={image}
          key={current}
          src={current}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setIndex((value) => value + 1)}
          className={`absolute inset-0 size-full object-cover transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </span>
  );
}
