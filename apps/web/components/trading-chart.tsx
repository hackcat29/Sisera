"use client";

import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  LineStyle,
  type MouseEventParams,
  PriceScaleMode,
  type SeriesType,
  type Time,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";
import { Camera, Expand, Minus, RotateCcw, Spline, TrendingUp } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Bar, bollinger, ema, heikinAshi, macd, rsi, sma, vwap } from "../lib/indicators";
import { useLivePrice } from "../lib/live-prices";
import { usePerpMid, useSpotTick } from "../lib/market-streams";
import { formatSignedPct, signTone } from "../lib/sign";

export type ChartSource = {
  kind: "solana" | "binance" | "hyperliquid" | "hyperliquid-spot";
  id: string;
};
type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
type ChartType = "candles" | "bars" | "heikin" | "line" | "area";
type Indicator = "volume" | "sma20" | "sma50" | "ema21" | "bollinger" | "vwap" | "rsi" | "macd";
type Tool = "none" | "hline" | "trend" | "fib";
type Drawing =
  | { kind: "hline"; price: number }
  | { kind: "trend"; from: { time: number; price: number }; to: { time: number; price: number } }
  | { kind: "fib"; high: number; low: number };

const INTERVAL_SECONDS: Record<Interval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 14_400,
  "1d": 86_400,
};
const INDICATORS: Array<{ id: Indicator; label: string }> = [
  { id: "volume", label: "Volume" },
  { id: "sma20", label: "SMA 20" },
  { id: "sma50", label: "SMA 50" },
  { id: "ema21", label: "EMA 21" },
  { id: "bollinger", label: "Bollinger" },
  { id: "vwap", label: "VWAP" },
  { id: "rsi", label: "RSI 14" },
  { id: "macd", label: "MACD" },
];
const UP = "#4fd18b";
const DOWN = "#f07474";
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const SETTINGS_KEY = "sisera.chart.v1";
const NO_MARKERS: Array<{ price: number; label: string }> = [];

function readSettings(): { type?: ChartType; indicators?: Indicator[]; log?: boolean } {
  try {
    return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function writeSettings(value: object) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
  } catch {
    // Settings are a convenience; ignore storage failures.
  }
}
function readDrawings(key: string): Drawing[] {
  try {
    return JSON.parse(window.localStorage.getItem(`sisera.drawings.${key}`) ?? "[]");
  } catch {
    return [];
  }
}
function writeDrawings(key: string, drawings: Drawing[]) {
  try {
    window.localStorage.setItem(`sisera.drawings.${key}`, JSON.stringify(drawings));
  } catch {
    // Ignore storage failures.
  }
}

const formatPrice = (value: number) =>
  value >= 1000
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : value >= 1
      ? value.toFixed(value >= 100 ? 2 : 3)
      : value.toPrecision(4);

/** Live price for the chart's market, from whichever feed that market streams on. */
function useLiveLast(source: ChartSource): number | undefined {
  const solana = useLivePrice(source.kind === "solana" ? source.id : null);
  const spot = useSpotTick(source.kind === "binance" ? source.id : null);
  // Hyperliquid streams perp and spot prices together; spot pairs are keyed like "@142".
  const perp = usePerpMid(
    source.kind === "hyperliquid"
      ? source.id.replace(/USDT?$/, "")
      : source.kind === "hyperliquid-spot"
        ? source.id
        : null,
  );
  return source.kind === "solana" ? solana?.usd : source.kind === "binance" ? spot?.last : perp;
}

export function TradingChart({
  source,
  title,
  initialBars,
  defaultInterval = "1h",
  intervals = ["1m", "5m", "15m", "1h", "4h", "1d"],
  height = 480,
  markers = NO_MARKERS,
}: {
  source: ChartSource;
  title?: string;
  initialBars?: Bar[];
  defaultInterval?: Interval;
  intervals?: Interval[];
  height?: number;
  /** Fixed reference levels drawn across the chart, such as a prediction market's strike. */
  markers?: Array<{ price: number; label: string }>;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const [interval, setChartInterval] = useState<Interval>(defaultInterval);
  const [bars, setBars] = useState<Bar[]>(initialBars ?? []);
  const [status, setStatus] = useState<"loading" | "ready" | "empty">(
    initialBars?.length ? "ready" : "loading",
  );
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [indicators, setIndicators] = useState<Indicator[]>(["volume", "sma20"]);
  const [logScale, setLogScale] = useState(false);
  const [tool, setTool] = useState<Tool>("none");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [anchor, setAnchor] = useState<{ time: number; price: number } | null>(null);
  const [legend, setLegend] = useState<Bar | null>(null);
  const drawingKey = `${source.kind}:${source.id}`;
  const live = useLiveLast(source);

  // Restore per-browser preferences and this market's drawings.
  useEffect(() => {
    const settings = readSettings();
    if (settings.type) setChartType(settings.type);
    if (settings.indicators) setIndicators(settings.indicators);
    if (settings.log !== undefined) setLogScale(settings.log);
    setDrawings(readDrawings(drawingKey));
  }, [drawingKey]);
  useEffect(() => {
    writeSettings({ type: chartType, indicators, log: logScale });
  }, [chartType, indicators, logScale]);

  // Load candles whenever the timeframe changes.
  const initialUsed = useRef(Boolean(initialBars?.length));
  useEffect(() => {
    if (initialUsed.current && interval === defaultInterval) {
      initialUsed.current = false;
      return;
    }
    let cancelled = false;
    setStatus("loading");
    fetch(
      `/api/chart?source=${source.kind}&id=${encodeURIComponent(source.id)}&interval=${interval}`,
    )
      .then((response) => response.json() as Promise<{ data?: Bar[] }>)
      .then((payload) => {
        if (cancelled) return;
        setBars(payload.data ?? []);
        setStatus(payload.data?.length ? "ready" : "empty");
      })
      .catch(() => {
        if (!cancelled) setStatus("empty");
      });
    return () => {
      cancelled = true;
    };
  }, [source.kind, source.id, interval, defaultInterval]);

  const displayBars = useMemo(
    () => (chartType === "heikin" ? heikinAshi(bars) : bars),
    [bars, chartType],
  );

  // Build the chart. It is rebuilt when its data or layout changes; live ticks only update the last bar.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !displayBars.length) return;
    const fontFamily =
      getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
      "monospace";
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0c141b" },
        textColor: "#a5b1b7",
        fontFamily,
        fontSize: 11,
        panes: { separatorColor: "#2a3943", separatorHoverColor: "#43545c" },
      },
      grid: {
        vertLines: { color: "rgba(42,57,67,0.45)" },
        horzLines: { color: "rgba(42,57,67,0.45)" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: "#2a3943",
        mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      },
      timeScale: {
        borderColor: "#2a3943",
        timeVisible: INTERVAL_SECONDS[interval] < 86_400,
        secondsVisible: false,
      },
    });
    chartRef.current = chart;
    const time = (value: number) => value as UTCTimestamp;

    let main: ISeriesApi<SeriesType>;
    if (chartType === "line" || chartType === "area") {
      main =
        chartType === "line"
          ? chart.addSeries(LineSeries, { color: "#e9bd8c", lineWidth: 2 })
          : chart.addSeries(AreaSeries, {
              lineColor: "#e9bd8c",
              topColor: "rgba(233,189,140,0.28)",
              bottomColor: "rgba(233,189,140,0.02)",
              lineWidth: 2,
            });
      main.setData(displayBars.map((bar) => ({ time: time(bar.time), value: bar.close })));
    } else {
      main =
        chartType === "bars"
          ? chart.addSeries(BarSeries, { upColor: UP, downColor: DOWN })
          : chart.addSeries(CandlestickSeries, {
              upColor: UP,
              downColor: DOWN,
              borderUpColor: UP,
              borderDownColor: DOWN,
              wickUpColor: UP,
              wickDownColor: DOWN,
            });
      main.setData(displayBars.map((bar) => ({ ...bar, time: time(bar.time) })));
    }
    mainRef.current = main;

    const overlay = (
      points: Array<{ time: number; value: number }>,
      color: string,
      style = LineStyle.Solid,
    ) => {
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: style,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData(points.map((point) => ({ time: time(point.time), value: point.value })));
      return series;
    };

    if (indicators.includes("volume")) {
      const volume = chart.addSeries(HistogramSeries, {
        priceScaleId: "volume",
        priceFormat: { type: "volume" },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volume.setData(
        bars.map((bar) => ({
          time: time(bar.time),
          value: bar.volume,
          color: bar.close >= bar.open ? "rgba(79,209,139,0.35)" : "rgba(240,116,116,0.35)",
        })),
      );
    }
    if (indicators.includes("sma20")) overlay(sma(bars, 20), "#e9bd8c");
    if (indicators.includes("sma50")) overlay(sma(bars, 50), "#78b9ad");
    if (indicators.includes("ema21")) overlay(ema(bars, 21), "#c7b8ea");
    if (indicators.includes("vwap")) overlay(vwap(bars), "#f4d8b8", LineStyle.Dashed);
    if (indicators.includes("bollinger")) {
      const bands = bollinger(bars);
      overlay(bands.upper, "#8fa3b1");
      overlay(bands.middle, "#8fa3b1", LineStyle.Dotted);
      overlay(bands.lower, "#8fa3b1");
    }
    let pane = 1;
    if (indicators.includes("rsi")) {
      const series = chart.addSeries(
        LineSeries,
        { color: "#e9bd8c", lineWidth: 1, priceLineVisible: false },
        pane,
      );
      series.setData(rsi(bars).map((point) => ({ time: time(point.time), value: point.value })));
      series.createPriceLine({
        price: 70,
        color: DOWN,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: false,
        title: "",
      });
      series.createPriceLine({
        price: 30,
        color: UP,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: false,
        title: "",
      });
      chart.panes()[pane]?.setHeight(110);
      pane += 1;
    }
    if (indicators.includes("macd")) {
      const result = macd(bars);
      const histogram = chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        pane,
      );
      histogram.setData(
        result.histogram.map((point) => ({
          time: time(point.time),
          value: point.value,
          color: point.value >= 0 ? "rgba(79,209,139,0.6)" : "rgba(240,116,116,0.6)",
        })),
      );
      const line = chart.addSeries(
        LineSeries,
        { color: "#78b9ad", lineWidth: 1, priceLineVisible: false },
        pane,
      );
      line.setData(result.line.map((point) => ({ time: time(point.time), value: point.value })));
      const signal = chart.addSeries(
        LineSeries,
        { color: "#e9bd8c", lineWidth: 1, priceLineVisible: false },
        pane,
      );
      signal.setData(
        result.signal.map((point) => ({ time: time(point.time), value: point.value })),
      );
      chart.panes()[pane]?.setHeight(110);
    }

    for (const marker of markers)
      main.createPriceLine({
        price: marker.price,
        color: "#f4d8b8",
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: marker.label,
      });

    // Drawings: horizontal lines and Fibonacci levels are price lines; trend lines are 2-point series.
    for (const drawing of drawings) {
      if (drawing.kind === "hline")
        main.createPriceLine({
          price: drawing.price,
          color: "#e9bd8c",
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: "",
        });
      else if (drawing.kind === "fib")
        for (const level of FIB_LEVELS)
          main.createPriceLine({
            price: drawing.high - (drawing.high - drawing.low) * level,
            color: "#78b9ad",
            lineWidth: 1,
            lineStyle: level === 0 || level === 1 ? LineStyle.Solid : LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${(level * 100).toFixed(1)}%`,
          });
      else if (drawing.from.time !== drawing.to.time)
        overlay(
          [drawing.from, drawing.to]
            .sort((a, b) => a.time - b.time)
            .map((point) => ({ time: point.time, value: point.price })),
          "#e9bd8c",
        );
    }

    const onMove = (param: MouseEventParams<Time>) => {
      const data = param.seriesData.get(main) as
        | { open?: number; high?: number; low?: number; close?: number; value?: number }
        | undefined;
      if (!data || param.time === undefined) return setLegend(null);
      const close = data.close ?? data.value ?? 0;
      setLegend({
        time: Number(param.time),
        open: data.open ?? close,
        high: data.high ?? close,
        low: data.low ?? close,
        close,
        volume: 0,
      });
    };
    chart.subscribeCrosshairMove(onMove);
    chart.timeScale().fitContent();
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
    };
  }, [bars, displayBars, chartType, indicators, logScale, interval, drawings, markers]);

  // Clicks place drawings when a tool is active.
  useEffect(() => {
    const chart = chartRef.current;
    const main = mainRef.current;
    if (!chart || !main || tool === "none") return;
    const onClick = (param: MouseEventParams<Time>) => {
      if (!param.point || param.time === undefined) return;
      const price = main.coordinateToPrice(param.point.y);
      if (price == null) return;
      const point = { time: Number(param.time), price };
      const commit = (drawing: Drawing) => {
        const next = [...drawings, drawing];
        setDrawings(next);
        writeDrawings(drawingKey, next);
        setAnchor(null);
        setTool("none");
      };
      if (tool === "hline") return commit({ kind: "hline", price });
      if (!anchor) return setAnchor(point);
      if (tool === "trend") return commit({ kind: "trend", from: anchor, to: point });
      commit({
        kind: "fib",
        high: Math.max(anchor.price, price),
        low: Math.min(anchor.price, price),
      });
    };
    chart.subscribeClick(onClick);
    return () => chart.unsubscribeClick(onClick);
  }, [tool, anchor, drawings, drawingKey]);

  // Live ticks extend or update the last bar every second.
  useEffect(() => {
    const main = mainRef.current;
    const last = bars.at(-1);
    if (!main || !last || live == null || !Number.isFinite(live)) return;
    const step = INTERVAL_SECONDS[interval];
    const now = Math.floor(Date.now() / 1000);
    const bucket = now - (now % step);
    const bar: Bar =
      bucket > last.time
        ? {
            time: bucket,
            open: last.close,
            high: Math.max(last.close, live),
            low: Math.min(last.close, live),
            close: live,
            volume: 0,
          }
        : { ...last, high: Math.max(last.high, live), low: Math.min(last.low, live), close: live };
    try {
      if (chartType === "line" || chartType === "area")
        main.update({ time: bar.time as UTCTimestamp, value: bar.close });
      else if (chartType !== "heikin") main.update({ ...bar, time: bar.time as UTCTimestamp });
    } catch {
      // A live tick older than the last bar is ignored.
    }
  }, [live, bars, interval, chartType]);

  const toggleIndicator = (id: Indicator) =>
    setIndicators((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const screenshot = useCallback(() => {
    const canvas = chartRef.current?.takeScreenshot();
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `sisera-${source.id}-${interval}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [source.id, interval]);

  const shown = legend ?? bars.at(-1) ?? null;
  const first = bars[0];
  const lastClose = live ?? bars.at(-1)?.close;
  const periodChange = first && lastClose ? (lastClose / first.open - 1) * 100 : null;
  const barChange = shown ? (shown.close / shown.open - 1) * 100 : null;

  const toolButton = (id: Tool, label: string, icon: ReactNode) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={tool === id}
      onClick={() => {
        setTool((current) => (current === id ? "none" : id));
        setAnchor(null);
      }}
      className={`grid size-7 place-items-center border ${tool === id ? "border-bronze-300 text-bronze-200" : "border-transparent text-slate-400 hover:text-bone"}`}
    >
      {icon}
    </button>
  );

  return (
    <section ref={frameRef} className="border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
        {title && <span className="text-[13px] font-semibold text-bone">{title}</span>}
        <div className="flex border border-line">
          {intervals.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setChartInterval(option)}
              className={`px-2 py-1 font-mono text-[11px] ${interval === option ? "bg-bronze-300 text-ink" : "text-slate-300 hover:text-bone"}`}
            >
              {option}
            </button>
          ))}
        </div>
        <select
          value={chartType}
          onChange={(event) => setChartType(event.target.value as ChartType)}
          aria-label="Chart type"
          className="h-7 border border-line bg-ink px-1.5 text-[11px] text-slate-200"
        >
          <option value="candles">Candles</option>
          <option value="bars">Bars</option>
          <option value="heikin">Heikin-Ashi</option>
          <option value="line">Line</option>
          <option value="area">Area</option>
        </select>
        <details className="relative">
          <summary className="flex h-7 cursor-pointer list-none items-center gap-1.5 border border-line px-2 text-[11px] text-slate-200">
            <Spline size={12} /> Indicators ({indicators.length})
          </summary>
          <div className="absolute left-0 top-8 z-20 grid w-44 gap-px border border-line-strong bg-line shadow-xl">
            {INDICATORS.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-center gap-2 bg-ink-raised px-3 py-2 text-[12px] text-slate-200"
              >
                <input
                  type="checkbox"
                  checked={indicators.includes(option.id)}
                  onChange={() => toggleIndicator(option.id)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </details>
        <div className="flex items-center gap-0.5 border-l border-line pl-2">
          {toolButton("hline", "Horizontal line", <Minus size={14} />)}
          {toolButton("trend", "Trend line", <TrendingUp size={14} />)}
          {toolButton(
            "fib",
            "Fibonacci retracement",
            <span className="font-mono text-[10px]">Fib</span>,
          )}
          <button
            type="button"
            title="Clear drawings"
            aria-label="Clear drawings"
            onClick={() => {
              setDrawings([]);
              writeDrawings(drawingKey, []);
            }}
            className="grid size-7 place-items-center text-slate-400 hover:text-bone"
          >
            <RotateCcw size={13} />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setLogScale((value) => !value)}
            className={`h-7 border px-2 font-mono text-[11px] ${logScale ? "border-bronze-300 text-bronze-200" : "border-line text-slate-300"}`}
          >
            Log
          </button>
          <button
            type="button"
            title="Download image"
            aria-label="Download image"
            onClick={screenshot}
            className="grid size-7 place-items-center text-slate-400 hover:text-bone"
          >
            <Camera size={14} />
          </button>
          <button
            type="button"
            title="Full screen"
            aria-label="Full screen"
            onClick={() => void frameRef.current?.requestFullscreen?.()}
            className="grid size-7 place-items-center text-slate-400 hover:text-bone"
          >
            <Expand size={14} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 font-mono text-[11px] text-slate-400">
        {shown ? (
          <>
            <span>
              O <span className="text-bone">{formatPrice(shown.open)}</span>
            </span>
            <span>
              H <span className="text-bone">{formatPrice(shown.high)}</span>
            </span>
            <span>
              L <span className="text-bone">{formatPrice(shown.low)}</span>
            </span>
            <span>
              C{" "}
              <span className="text-bone">
                {formatPrice(legend ? shown.close : (lastClose ?? shown.close))}
              </span>
            </span>
            <span className={signTone(barChange)}>{formatSignedPct(barChange)}</span>
            {!legend && periodChange != null && (
              <span>
                Range{" "}
                <span className={signTone(periodChange)}>{formatSignedPct(periodChange)}</span>
              </span>
            )}
          </>
        ) : (
          <span>—</span>
        )}
        {tool !== "none" && (
          <span className="text-bronze-200">
            {tool === "hline"
              ? "Click the chart to place a line"
              : anchor
                ? "Click the second point"
                : "Click the first point"}
          </span>
        )}
      </div>
      <div className="relative" style={{ height }}>
        <div
          ref={containerRef}
          className={`absolute inset-0 ${tool !== "none" ? "cursor-crosshair" : ""}`}
        />
        {status !== "ready" && (
          <div className="absolute inset-0 grid place-items-center text-[13px] text-slate-400">
            {status === "loading" ? (
              <div className="skeleton h-full w-full" />
            ) : (
              "No price history for this timeframe yet."
            )}
          </div>
        )}
      </div>
    </section>
  );
}
