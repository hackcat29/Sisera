export type EvidenceFill = {
  id: string;
  mode: string;
  venue: string;
  instrumentKey: string;
  side: string;
  quantity: number;
  priceUsd: number;
  feeUsd: number;
  signature: string | null;
  occurredAt: string;
  verified: boolean;
};

/** FIFO attribution scoped to one immutable version and one execution mode. No assumed capital denominator. */
export function strategyPerformance(fills: EvidenceFill[]) {
  const unique = [
    ...new Map(
      fills.map((f) => [f.signature ? `${f.signature}:${f.instrumentKey}:${f.side}` : f.id, f]),
    ).values(),
  ]
    .filter(
      (f) =>
        f.quantity > 0 &&
        f.priceUsd > 0 &&
        Number.isFinite(f.quantity * f.priceUsd) &&
        f.feeUsd >= 0,
    )
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const lots = new Map<string, Array<{ quantity: number; price: number; fee: number }>>();
  let gross = 0;
  let net = 0;
  let fees = 0;
  let volume = 0;
  let closes = 0;
  let wins = 0;
  let peak = 0;
  let drawdown = 0;
  let unmatched = 0;
  const curve: Array<{ time: string; pnlUsd: number }> = [];
  for (const f of unique) {
    const key = `${f.venue}:${f.instrumentKey}`;
    const queue = lots.get(key) ?? [];
    const direction = f.side === "buy" ? 1 : -1;
    let remaining = f.quantity;
    let matched = 0;
    let basisFee = 0;
    let realized = 0;
    while (remaining > 1e-12 && queue[0] && Math.sign(queue[0].quantity) !== direction) {
      const lot = queue[0];
      const quantity = Math.min(remaining, Math.abs(lot.quantity));
      realized += (f.priceUsd - lot.price) * quantity * Math.sign(lot.quantity);
      const fee = (lot.fee * quantity) / Math.abs(lot.quantity);
      basisFee += fee;
      lot.fee -= fee;
      lot.quantity += quantity * direction;
      matched += quantity;
      remaining -= quantity;
      if (Math.abs(lot.quantity) < 1e-12) queue.shift();
    }
    if (matched > 0) {
      const adjusted = realized - basisFee - (f.feeUsd * matched) / f.quantity;
      gross += realized;
      net += adjusted;
      closes++;
      if (adjusted > 0) wins++;
      peak = Math.max(peak, net);
      drawdown = Math.max(drawdown, peak - net);
      curve.push({ time: f.occurredAt, pnlUsd: net });
    }
    if (remaining > 1e-12) {
      if (direction > 0 || f.venue === "hyperliquid")
        queue.push({
          quantity: remaining * direction,
          price: f.priceUsd,
          fee: (f.feeUsd * remaining) / f.quantity,
        });
      else unmatched++;
    }
    lots.set(key, queue);
    fees += f.feeUsd;
    volume += f.quantity * f.priceUsd;
  }
  return {
    trades: unique.length,
    closedTrades: closes,
    grossRealizedUsd: closes && !unmatched ? gross : null,
    feeAdjustedRealizedUsd: closes && !unmatched ? net : null,
    recordedFeesUsd: fees,
    volumeUsd: volume,
    winRatePct: closes && !unmatched ? (wins / closes) * 100 : null,
    realizedDrawdownUsd: closes && !unmatched ? drawdown : null,
    firstTradeAt: unique[0]?.occurredAt ?? null,
    lastTradeAt: unique.at(-1)?.occurredAt ?? null,
    observedDays: unique.length
      ? Math.max(
          1,
          Math.ceil(
            (Date.parse(unique.at(-1)?.occurredAt ?? "") -
              Date.parse(unique[0]?.occurredAt ?? "")) /
              86400000,
          ),
        )
      : 0,
    unmatchedSells: unmatched,
    verifiedTrades: unique.filter((f) => f.verified).length,
    openPositions: [...lots].flatMap(([instrument, queue]) =>
      queue.length ? [{ instrument, quantity: queue.reduce((s, l) => s + l.quantity, 0) }] : [],
    ),
    curve,
    status: !unique.length ? "no_history" : unmatched ? "unknown_basis" : "recorded",
  };
}
