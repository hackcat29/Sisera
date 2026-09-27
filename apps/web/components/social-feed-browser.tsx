"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { SocialPost } from "../lib/api";

const tracked = ["AAPL", "NVDA", "TSLA", "MSFT", "OpenAI", "SpaceX", "Anthropic", "Solana"];
const tags = (post: SocialPost) =>
  tracked.filter((asset) => new RegExp(`\\b${asset}\\b`, "i").test(post.text));

export function SocialFeedBrowser({
  posts,
  sources,
}: { posts: SocialPost[]; sources: Record<string, string> }) {
  const [query, setQuery] = useState("");
  const [relevantOnly, setRelevantOnly] = useState(false);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return posts
      .filter((post) => !relevantOnly || tags(post).length > 0)
      .filter((post) => `${post.text} ${post.community}`.toLowerCase().includes(needle))
      .sort(
        (a, b) =>
          tags(b).length - tags(a).length || Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
      );
  }, [posts, query, relevantOnly]);
  const available = Object.entries(sources).filter(
    ([, status]) => status === "live" || status === "ready",
  );
  const unavailable = Object.entries(sources).filter(
    ([, status]) => status !== "live" && status !== "ready",
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 rounded border border-line bg-panel px-3">
          <Search size={13} className="text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search posts or sources"
            aria-label="Search social posts"
            className="h-9 w-56 bg-transparent text-xs text-white outline-none placeholder:text-slate-500"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={relevantOnly}
            onChange={(event) => setRelevantOnly(event.target.checked)}
          />
          Only tracked asset mentions
        </label>
        <span className="font-mono text-[10px] text-slate-500">
          {filtered.length} of {posts.length} posts
        </span>
      </div>
      {filtered.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {filtered.map((post) => (
            <article key={post.id} className="border border-line bg-panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase text-cyan-300">
                <span>
                  {post.platform} · {post.community}
                </span>
                <time dateTime={post.publishedAt} className="text-slate-500">
                  {new Intl.DateTimeFormat("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "UTC",
                  }).format(new Date(post.publishedAt))}{" "}
                  UTC
                </time>
              </div>
              {tags(post).length > 0 && (
                <p className="mt-2 font-mono text-[10px] text-amber-300">
                  Mentions {tags(post).join(" · ")}
                </p>
              )}
              <p className="mt-3 line-clamp-5 whitespace-pre-wrap text-xs leading-5 text-slate-200">
                {post.text}
              </p>
              <a
                href={post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-[11px] text-cyan-300"
              >
                Open original source →
              </a>
              <p className="mt-2 text-[10px] text-slate-500">
                Unverified community post. Asset mention does not establish a causal market link.
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="border border-line bg-panel p-6 text-xs text-slate-400">
          No posts match this view. Clear the filter to inspect all available sources.
        </p>
      )}
      <details className="mt-4 border border-line bg-panel p-4 text-xs text-slate-400">
        <summary className="cursor-pointer text-slate-200">
          Source status · {available.length} available · {unavailable.length} unavailable
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(sources).map(([source, status]) => (
            <span
              key={source}
              className="rounded border border-line px-2 py-1 font-mono text-[10px]"
            >
              {source} · {status.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      </details>
    </div>
  );
}
