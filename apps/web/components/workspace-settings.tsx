"use client";

import { useEffect, useRef, useState } from "react";

export function WorkspaceSettings() {
  const [interval, setIntervalValue] = useState("30000");
  const [failedOrders, setFailedOrders] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const savePending = useRef(false);
  useEffect(() => {
    let active = true;
    const load = () => {
      void fetch("/api/preferences", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(
              response.status === 401
                ? "Sign in to sync settings."
                : "Account settings are unavailable.",
            );
          return response.json();
        })
        .then((payload) => {
          if (!active || savePending.current) return;
          setIntervalValue(String(payload.data.refreshIntervalMs));
          setFailedOrders(payload.data.failedOrderAlerts);
          localStorage.setItem(
            "sisera_refresh_interval_ms",
            String(payload.data.refreshIntervalMs),
          );
          setMessage(null);
          setReady(true);
        })
        .catch((error) => {
          if (active && !savePending.current)
            setMessage(
              error instanceof Error ? error.message : "Account settings are unavailable.",
            );
        });
    };
    load();
    window.addEventListener("sisera:session-renewed", load);
    return () => {
      active = false;
      window.removeEventListener("sisera:session-renewed", load);
    };
  }, []);
  async function save(nextInterval: string, nextFailedOrders: boolean) {
    if (savePending.current) return;
    savePending.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          refreshIntervalMs: Number(nextInterval),
          failedOrderAlerts: nextFailedOrders,
        }),
      });
      if (!response.ok) throw new Error("Settings could not be saved. Please retry.");
      setIntervalValue(nextInterval);
      setFailedOrders(nextFailedOrders);
      localStorage.setItem("sisera_refresh_interval_ms", nextInterval);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Settings could not be saved.");
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      {message && (
        <p role="alert" className="md:col-span-2 text-xs text-amber-300">
          {message}
        </p>
      )}
      <section className="border border-line bg-panel p-5">
        <h2 className="text-sm font-semibold text-white">Market refresh</h2>
        <p className="mt-2 text-xs text-slate-400">
          Choose how often open market views refresh while this tab is visible.
        </p>
        <select
          value={interval}
          disabled={!ready || saving}
          onChange={(event) => void save(event.target.value, failedOrders)}
          className="mt-4 w-full rounded border border-line bg-ink p-2 text-xs text-white"
        >
          <option value="0">Manual only</option>
          <option value="15000">15 seconds</option>
          <option value="30000">30 seconds</option>
          <option value="60000">60 seconds</option>
        </select>
      </section>
      <section className="border border-line bg-panel p-5">
        <h2 className="text-sm font-semibold text-white">Activity alerts</h2>
        <label className="mt-4 flex items-center gap-3 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={failedOrders}
            disabled={!ready || saving}
            onChange={(event) => void save(interval, event.target.checked)}
          />
          Show failed and uncertain order alerts
        </label>
        <p className="mt-3 text-[11px] text-slate-500">
          Preferences are saved to your Sisera account. Order status still appears in Activity;
          delayed bridge alerts remain visible.
        </p>
      </section>
    </div>
  );
}
