import { and, desc, eq, gt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, { max: 10, idle_timeout: 20, connect_timeout: 10 });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

export { schema };

/** A bounded read that also checks the schema version expected by this API build. */
export async function checkDatabaseReadiness(connectionString: string): Promise<boolean> {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 2, idle_timeout: 1 });
  try {
    const rows = await connection`
      SELECT EXISTS (
        SELECT 1 FROM _sisera_migrations WHERE name = '0014_repair_json_encoding.sql'
      ) AS migrated
    `;
    return rows[0]?.migrated === true;
  } finally {
    await connection.end();
  }
}

export async function listAccountEvents(connectionString: string, subject: string) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const rows = await connection`
      SELECT id::text, source, source_id::text AS "sourceId", mode, status, detail,
             occurred_at AS "occurredAt"
      FROM account_events WHERE subject = ${subject}
      ORDER BY occurred_at DESC LIMIT 200
    `;
    return rows.map((row) => ({
      id: String(row.id),
      source: String(row.source),
      sourceId: String(row.sourceId),
      mode: String(row.mode),
      status: String(row.status),
      detail: row.detail as Record<string, string>,
      occurredAt: new Date(row.occurredAt as string | Date).toISOString(),
    }));
  } finally {
    await connection.end();
  }
}

export type BridgeTransferInput = {
  requestId: string;
  tenantId: string;
  subject: string;
  originAddress: string;
  recipient: string;
  originChainId: number;
  destinationChainId: number;
  /** USDC sent for a bridge; null for a swap, which records its origin token instead. */
  originAmountUsdc: string | null;
  quotedOutputUsdc: string;
  originCurrency?: string | null;
  originSymbol?: string | null;
  originDecimals?: number | null;
  originAmountRaw?: string | null;
};

export async function createBridgeTransfer(
  connectionString: string,
  transfer: BridgeTransferInput,
) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const [created] = await connection`
      INSERT INTO bridge_transfers
        (request_id, tenant_id, subject, origin_address, recipient, origin_chain_id,
         destination_chain_id, origin_amount_usdc, quoted_output_usdc, origin_currency,
         origin_symbol, origin_decimals, origin_amount_raw)
      VALUES (${transfer.requestId}, ${transfer.tenantId}, ${transfer.subject},
              ${transfer.originAddress}, ${transfer.recipient}, ${transfer.originChainId},
              ${transfer.destinationChainId}, ${transfer.originAmountUsdc}, ${transfer.quotedOutputUsdc},
              ${transfer.originCurrency ?? null}, ${transfer.originSymbol ?? null},
              ${transfer.originDecimals ?? null}, ${transfer.originAmountRaw ?? null})
      ON CONFLICT (request_id) DO NOTHING RETURNING id
    `;
    if (!created) {
      const [existing] = await connection`
        SELECT subject, origin_address AS "originAddress", recipient,
               origin_chain_id AS "originChainId", destination_chain_id AS "destinationChainId",
               origin_amount_usdc::text AS "originAmountUsdc",
               origin_currency AS "originCurrency", origin_amount_raw::text AS "originAmountRaw"
        FROM bridge_transfers WHERE request_id = ${transfer.requestId}
      `;
      if (
        !existing ||
        existing.subject !== transfer.subject ||
        String(existing.originAddress).toLowerCase() !== transfer.originAddress.toLowerCase() ||
        existing.recipient !== transfer.recipient ||
        Number(existing.originChainId) !== transfer.originChainId ||
        Number(existing.destinationChainId) !== transfer.destinationChainId ||
        (existing.originAmountUsdc == null
          ? transfer.originAmountUsdc != null
          : Number(existing.originAmountUsdc) !== Number(transfer.originAmountUsdc)) ||
        (existing.originCurrency ?? null) !== (transfer.originCurrency ?? null) ||
        (existing.originAmountRaw ?? null) !== (transfer.originAmountRaw ?? null)
      )
        throw new Error("Bridge request ID belongs to a different quote");
    }
  } finally {
    await connection.end();
  }
}

export async function listBridgeTransfers(connectionString: string, subject: string) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const rows = await connection`
      SELECT request_id AS "requestId", origin_address AS "originAddress", recipient,
             origin_chain_id AS "originChainId", destination_chain_id AS "destinationChainId",
             origin_amount_usdc::text AS "originAmountUsdc",
             quoted_output_usdc::text AS "quotedOutputUsdc", status,
             origin_currency AS "originCurrency", origin_symbol AS "originSymbol",
             origin_decimals AS "originDecimals", origin_amount_raw::text AS "originAmountRaw",
             source_tx_hash AS "sourceTxHash", destination_tx_hash AS "destinationTxHash",
             quoted_at AS "quotedAt", updated_at AS "updatedAt"
      FROM bridge_transfers WHERE subject = ${subject}
      ORDER BY quoted_at DESC LIMIT 100
    `;
    return rows.map((row) => ({
      ...row,
      quotedAt: new Date(row.quotedAt as string | Date).toISOString(),
      updatedAt: new Date(row.updatedAt as string | Date).toISOString(),
    }));
  } finally {
    await connection.end();
  }
}

/** Stores the unsigned origin transaction Sisera built for a bridge transfer. */
export async function attachBridgeTransaction(
  connectionString: string,
  subject: string,
  requestId: string,
  unsignedTransaction: string,
  expiresAt: Date,
) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const [row] = await connection`
      UPDATE bridge_transfers
      SET unsigned_transaction = ${unsignedTransaction}, unsigned_expires_at = ${expiresAt},
          updated_at = clock_timestamp()
      WHERE subject = ${subject} AND request_id = ${requestId} AND status = 'quoted'
      RETURNING id
    `;
    return Boolean(row);
  } finally {
    await connection.end();
  }
}

/** Takes the unsigned transaction for submission exactly once, while it is still valid. */
export async function claimBridgeTransaction(
  connectionString: string,
  subject: string,
  requestId: string,
) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const [row] = await connection`
      UPDATE bridge_transfers AS transfer
      SET unsigned_transaction = NULL, updated_at = clock_timestamp()
      FROM (
        SELECT id, unsigned_transaction FROM bridge_transfers
        WHERE subject = ${subject} AND request_id = ${requestId} AND status = 'quoted'
          AND unsigned_transaction IS NOT NULL AND unsigned_expires_at > clock_timestamp()
        FOR UPDATE
      ) AS pending
      WHERE transfer.id = pending.id
      RETURNING pending.unsigned_transaction AS "unsignedTransaction",
                transfer.origin_address AS "originAddress"
    `;
    return row
      ? {
          unsignedTransaction: String(row.unsignedTransaction),
          originAddress: String(row.originAddress),
        }
      : null;
  } finally {
    await connection.end();
  }
}

export async function getBridgeTransfer(
  connectionString: string,
  subject: string,
  requestId: string,
) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const [row] = await connection`
      SELECT id FROM bridge_transfers WHERE subject = ${subject} AND request_id = ${requestId}
    `;
    return Boolean(row);
  } finally {
    await connection.end();
  }
}

export async function markBridgeSourceSubmitted(
  connectionString: string,
  subject: string,
  requestId: string,
  sourceTxHash: string,
) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const [row] = await connection`
      UPDATE bridge_transfers SET
        status = CASE WHEN status = 'quoted' THEN 'source_submitted' ELSE status END,
        source_tx_hash = COALESCE(source_tx_hash, ${sourceTxHash}),
        source_submitted_at = CASE
          WHEN status IN ('quoted', 'source_submitted')
            THEN COALESCE(source_submitted_at, clock_timestamp())
          ELSE source_submitted_at END,
        updated_at = clock_timestamp()
      WHERE subject = ${subject} AND request_id = ${requestId}
        AND (source_tx_hash IS NULL OR source_tx_hash = ${sourceTxHash})
      RETURNING id
    `;
    return Boolean(row);
  } finally {
    await connection.end();
  }
}

export async function updateBridgeTransferStatus(
  connectionString: string,
  subject: string,
  requestId: string,
  status: string,
  sourceTxHash: string | null,
  destinationTxHash: string | null,
) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const [updated] = await connection`
      UPDATE bridge_transfers SET
        status = CASE WHEN lower(status) IN ('success', 'completed') THEN status ELSE ${status} END,
        source_tx_hash = COALESCE(${sourceTxHash}, source_tx_hash),
        destination_tx_hash = COALESCE(destination_tx_hash, ${destinationTxHash}),
        source_submitted_at = CASE
          WHEN ${status} = 'source_submitted'
            THEN COALESCE(source_submitted_at, clock_timestamp())
          ELSE source_submitted_at END,
        updated_at = clock_timestamp()
      WHERE subject = ${subject} AND request_id = ${requestId}
      RETURNING status, source_tx_hash AS "sourceTxHash", destination_tx_hash AS "destinationTxHash"
    `;
    return updated
      ? {
          status: String(updated.status),
          sourceTxHash: updated.sourceTxHash ? String(updated.sourceTxHash) : null,
          destinationTxHash: updated.destinationTxHash ? String(updated.destinationTxHash) : null,
        }
      : null;
  } finally {
    await connection.end();
  }
}

export async function getAccountPreferences(connectionString: string, subject: string) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const [row] = await connection`
      SELECT refresh_interval_ms AS "refreshIntervalMs", failed_order_alerts AS "failedOrderAlerts",
             leaderboard_opt_in AS "leaderboardOptIn"
      FROM account_preferences WHERE subject = ${subject}
    `;
    return row
      ? {
          refreshIntervalMs: Number(row.refreshIntervalMs),
          failedOrderAlerts: Boolean(row.failedOrderAlerts),
          leaderboardOptIn: Boolean(row.leaderboardOptIn),
        }
      : { refreshIntervalMs: 30000, failedOrderAlerts: true, leaderboardOptIn: false };
  } finally {
    await connection.end();
  }
}

export async function saveAccountPreferences(
  connectionString: string,
  subject: string,
  preferences: {
    refreshIntervalMs: number;
    failedOrderAlerts: boolean;
    leaderboardOptIn: boolean | undefined;
  },
) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const leaderboardOptIn = preferences.leaderboardOptIn ?? null;
    const [saved] = await connection`
      INSERT INTO account_preferences (subject, refresh_interval_ms, failed_order_alerts, leaderboard_opt_in)
      VALUES (${subject}, ${preferences.refreshIntervalMs}, ${preferences.failedOrderAlerts}, COALESCE(${leaderboardOptIn}, false))
      ON CONFLICT (subject) DO UPDATE SET
        refresh_interval_ms = EXCLUDED.refresh_interval_ms,
        failed_order_alerts = EXCLUDED.failed_order_alerts,
        leaderboard_opt_in = COALESCE(${leaderboardOptIn}, account_preferences.leaderboard_opt_in),
        updated_at = now()
      RETURNING leaderboard_opt_in AS "leaderboardOptIn"
    `;
    return { ...preferences, leaderboardOptIn: Boolean(saved?.leaderboardOptIn) };
  } finally {
    await connection.end();
  }
}

export async function listLeaderboardParticipants(connectionString: string): Promise<Set<string>> {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const rows = await connection`
      SELECT subject FROM account_preferences WHERE leaderboard_opt_in = true
    `;
    return new Set(rows.map((row) => String(row.subject)));
  } finally {
    await connection.end();
  }
}

export async function listAccountAlerts(connectionString: string, subject: string) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const rows = await connection`
      WITH latest AS (
        SELECT DISTINCT ON (source, source_id)
          id, source, source_id, status, detail, occurred_at
        FROM account_events
        WHERE subject = ${subject}
        ORDER BY source, source_id, occurred_at DESC, id DESC
      ), eligible AS (
        SELECT id, source, source_id, status, detail, occurred_at
        FROM latest
        WHERE ((status IN ('failed', 'unknown', 'rejected')
                AND source IN ('solana_swap_orders', 'market_live_orders', 'prediction_orders')
                AND COALESCE((SELECT failed_order_alerts FROM account_preferences
                              WHERE subject = ${subject}), true))
            OR (source = 'trading_policies' AND status IN ('awaiting_approval', 'failed', 'invalidated'))
            OR (source = 'agent_orders' AND status IN ('awaiting_approval', 'failed'))
            OR (source = 'token_launches' AND status = 'failed')
            OR (source = 'agent_state_events' AND status = 'paused'))
        UNION ALL
        SELECT id, 'bridge_transfers', id, 'delayed',
               jsonb_build_object('requestId', request_id), source_submitted_at
        FROM bridge_transfers
        WHERE subject = ${subject} AND status = 'source_submitted'
          AND source_submitted_at <= now() - interval '15 minutes'
      )
      SELECT eligible.id::text, eligible.source, eligible.source_id::text AS "sourceId",
             eligible.status, eligible.detail, eligible.occurred_at AS "occurredAt",
             acknowledgement.acknowledged_at AS "acknowledgedAt"
      FROM eligible
      LEFT JOIN alert_acknowledgements AS acknowledgement
        ON acknowledgement.subject = ${subject} AND acknowledgement.alert_id = eligible.id
      ORDER BY eligible.occurred_at DESC LIMIT 200
    `;
    return rows.map((row) => ({
      id: String(row.id),
      source: String(row.source),
      sourceId: String(row.sourceId),
      status: String(row.status),
      detail: row.detail as Record<string, string>,
      occurredAt: new Date(row.occurredAt as Date).toISOString(),
      acknowledgedAt: row.acknowledgedAt
        ? new Date(row.acknowledgedAt as Date).toISOString()
        : null,
    }));
  } finally {
    await connection.end();
  }
}

export async function acknowledgeAccountAlert(
  connectionString: string,
  subject: string,
  alertId: string,
) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const [row] = await connection`
      SELECT id FROM account_events
      WHERE id = ${alertId}::uuid AND subject = ${subject}
        AND (status IN ('failed', 'unknown', 'rejected')
          OR (source = 'trading_policies' AND status IN ('awaiting_approval', 'invalidated'))
          OR (source = 'agent_orders' AND status = 'awaiting_approval')
          OR (source = 'agent_state_events' AND status = 'paused'))
      UNION ALL
      SELECT id FROM bridge_transfers
      WHERE id = ${alertId}::uuid AND subject = ${subject}
        AND status = 'source_submitted'
        AND source_submitted_at <= now() - interval '15 minutes'
      LIMIT 1
    `;
    if (!row) return false;
    await connection`
      INSERT INTO alert_acknowledgements (subject, alert_id)
      VALUES (${subject}, ${alertId}::uuid) ON CONFLICT DO NOTHING
    `;
    return true;
  } finally {
    await connection.end();
  }
}

export async function listAgentManifests(
  connectionString: string,
  tenantId: string,
  subject: string,
) {
  const connection = createDatabase(connectionString);
  try {
    return await connection.db
      .select()
      .from(schema.agentManifests)
      .where(
        and(
          eq(schema.agentManifests.tenantId, tenantId),
          or(
            eq(schema.agentManifests.ownerSubject, subject),
            sql`${schema.agentManifests.policy}->>'subject' = ${subject}`,
          ),
        ),
      )
      .orderBy(desc(schema.agentManifests.createdAt))
      .limit(100);
  } finally {
    await connection.close();
  }
}

export async function createAgentManifest(
  connectionString: string,
  manifest: typeof schema.agentManifests.$inferInsert,
) {
  const connection = createDatabase(connectionString);
  try {
    const [created] = await connection.db
      .insert(schema.agentManifests)
      .values(manifest)
      .returning();
    return created;
  } finally {
    await connection.close();
  }
}

export type SolanaSwapOrder = typeof schema.solanaSwapOrders.$inferInsert;

export async function applySolanaPaperTrade(
  connectionString: string,
  subject: string,
  order: SolanaSwapOrder,
  decide: (state: { cashUsd: string; holdings: Record<string, string> }) => {
    cashUsd: string;
    holdings: Record<string, string>;
  },
) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    return await connection.begin(async (transaction) => {
      await transaction`INSERT INTO solana_paper_accounts (subject) VALUES (${subject}) ON CONFLICT DO NOTHING`;
      const [account] =
        await transaction`SELECT cash_usd::text AS cash_usd, holdings FROM solana_paper_accounts WHERE subject = ${subject} FOR UPDATE`;
      if (!account) throw new Error("Paper account unavailable");
      const next = decide({
        cashUsd: String(account.cash_usd),
        holdings: account.holdings as Record<string, string>,
      });
      await transaction`UPDATE solana_paper_accounts SET cash_usd = ${next.cashUsd}, holdings = ${JSON.stringify(next.holdings)}::text::jsonb, updated_at = now() WHERE subject = ${subject}`;
      await transaction`INSERT INTO solana_swap_orders (id, tenant_id, subject, wallet, input_mint, output_mint, in_amount, out_amount, risk_decision, mode, status, book, arrival_price_usd) VALUES (${order.id}, ${order.tenantId}, ${subject}, ${order.wallet}, ${order.inputMint}, ${order.outputMint}, ${order.inAmount}, ${order.outAmount}, ${JSON.stringify(order.riskDecision)}::text::jsonb, 'paper', 'paper_filled', ${order.book ?? "manual"}, ${order.arrivalPriceUsd ?? null})`;
      return next;
    });
  } finally {
    await connection.end();
  }
}

export async function saveSolanaSwapOrder(connectionString: string, order: SolanaSwapOrder) {
  const connection = createDatabase(connectionString);
  try {
    await connection.db.insert(schema.solanaSwapOrders).values(order);
  } finally {
    await connection.close();
  }
}

export async function claimSolanaSwapOrder(connectionString: string, id: string, subject: string) {
  const connection = createDatabase(connectionString);
  try {
    const [order] = await connection.db
      .update(schema.solanaSwapOrders)
      .set({ status: "submitting", updatedAt: new Date() })
      .where(
        and(
          eq(schema.solanaSwapOrders.id, id),
          eq(schema.solanaSwapOrders.subject, subject),
          eq(schema.solanaSwapOrders.status, "prepared"),
          gt(schema.solanaSwapOrders.expiresAt, new Date()),
        ),
      )
      .returning();
    return order ?? null;
  } finally {
    await connection.close();
  }
}

export async function finishSolanaSwapOrder(
  connectionString: string,
  id: string,
  status: "confirmed" | "failed" | "unknown",
  signature?: string,
) {
  const connection = createDatabase(connectionString);
  try {
    await connection.db
      .update(schema.solanaSwapOrders)
      .set({ status, signature: signature ?? null, updatedAt: new Date() })
      .where(eq(schema.solanaSwapOrders.id, id));
  } finally {
    await connection.close();
  }
}

export async function listSolanaSwapOrders(connectionString: string, subject: string) {
  const connection = createDatabase(connectionString);
  try {
    return await connection.db
      .select({
        id: schema.solanaSwapOrders.id,
        mode: schema.solanaSwapOrders.mode,
        status: schema.solanaSwapOrders.status,
        wallet: schema.solanaSwapOrders.wallet,
        inputMint: schema.solanaSwapOrders.inputMint,
        outputMint: schema.solanaSwapOrders.outputMint,
        inAmount: schema.solanaSwapOrders.inAmount,
        outAmount: schema.solanaSwapOrders.outAmount,
        signature: schema.solanaSwapOrders.signature,
        createdAt: schema.solanaSwapOrders.createdAt,
      })
      .from(schema.solanaSwapOrders)
      .where(eq(schema.solanaSwapOrders.subject, subject))
      .orderBy(desc(schema.solanaSwapOrders.createdAt))
      .limit(50);
  } finally {
    await connection.close();
  }
}

export async function listPaperAccounts(connectionString: string) {
  const connection = createDatabase(connectionString);
  try {
    return await connection.db.select().from(schema.solanaPaperAccounts).limit(1000);
  } finally {
    await connection.close();
  }
}

export type MarketPaperState = {
  cashUsd: string;
  spotHoldings: Record<string, string>;
  perpPositions: Record<string, { size: string; entryPrice: string }>;
};

export async function applyMarketPaperOrder(
  connectionString: string,
  order: {
    id: string;
    tenantId: string;
    subject: string;
    venue: "binance" | "hyperliquid";
    symbol: string;
    side: "buy" | "sell";
    quantity: string;
    fillPrice: string;
    feeUsd: string;
  },
  decide: (state: MarketPaperState) => MarketPaperState,
) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    return await connection.begin(async (transaction) => {
      await transaction`INSERT INTO market_paper_accounts (subject) VALUES (${order.subject}) ON CONFLICT DO NOTHING`;
      const [account] =
        await transaction`SELECT cash_usd::text AS cash_usd, spot_holdings, perp_positions FROM market_paper_accounts WHERE subject = ${order.subject} FOR UPDATE`;
      if (!account) throw new Error("Paper account unavailable");
      const next = decide({
        cashUsd: String(account.cash_usd),
        spotHoldings: account.spot_holdings as Record<string, string>,
        perpPositions: account.perp_positions as Record<
          string,
          { size: string; entryPrice: string }
        >,
      });
      await transaction`UPDATE market_paper_accounts SET cash_usd = ${next.cashUsd}, spot_holdings = ${JSON.stringify(next.spotHoldings)}::text::jsonb, perp_positions = ${JSON.stringify(next.perpPositions)}::text::jsonb, updated_at = now() WHERE subject = ${order.subject}`;
      await transaction`INSERT INTO market_paper_orders (id, tenant_id, subject, venue, symbol, side, quantity, fill_price, fee_usd) VALUES (${order.id}, ${order.tenantId}, ${order.subject}, ${order.venue}, ${order.symbol}, ${order.side}, ${order.quantity}, ${order.fillPrice}, ${order.feeUsd})`;
      return next;
    });
  } finally {
    await connection.end();
  }
}

export async function listMarketPaperOrders(connectionString: string, subject: string) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    return await connection`SELECT id, venue, symbol, side, quantity::text, fill_price::text AS "fillPrice", fee_usd::text AS "feeUsd", status, created_at AS "createdAt" FROM market_paper_orders WHERE subject = ${subject} ORDER BY created_at DESC LIMIT 50`;
  } finally {
    await connection.end();
  }
}

export async function createMarketLiveOrder(
  connectionString: string,
  order: {
    id: string;
    tenantId: string;
    subject: string;
    venue: "binance" | "hyperliquid";
    symbol: string;
    side: "buy" | "sell";
    quantity: string;
    clientOrderId: string;
  },
) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    await connection`INSERT INTO market_live_orders (id, tenant_id, subject, venue, symbol, side, quantity, client_order_id, status) VALUES (${order.id}, ${order.tenantId}, ${order.subject}, ${order.venue}, ${order.symbol}, ${order.side}, ${order.quantity}, ${order.clientOrderId}, 'submitting')`;
  } finally {
    await connection.end();
  }
}

export async function updateMarketLiveOrder(
  connectionString: string,
  id: string,
  status: "filled" | "rejected" | "unknown" | "open" | "cancelled",
  venueOrderId?: string,
  fill?: { priceUsd: string; feeUsd: string; quantity?: string },
) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    await connection`UPDATE market_live_orders SET status = ${status}, venue_order_id = ${venueOrderId ?? null}, fill_price = ${fill?.priceUsd ?? null}, fee_usd = ${fill?.feeUsd ?? null}, quantity = COALESCE(${fill?.quantity ?? null}::numeric, quantity), updated_at = now() WHERE id = ${id}`;
  } finally {
    await connection.end();
  }
}

export type HyperliquidPreparedOrder = {
  id: string;
  tenantId: string;
  subject: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  clientOrderId: string;
  accountAddress: string;
  preparedActions: unknown;
  expiresAt: Date;
  leverage: string;
  marginUsd: string | null;
  reduceOnly: boolean;
  marketType: "perp" | "spot";
  orderType: "market" | "limit";
  limitPrice: string | null;
};

/** Records a risk-checked Hyperliquid order whose exact actions await the user's signature. */
export async function prepareHyperliquidOrder(
  connectionString: string,
  order: HyperliquidPreparedOrder,
) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    await connection`
      INSERT INTO market_live_orders
        (id, tenant_id, subject, venue, symbol, side, quantity, client_order_id, status,
         account_address, prepared_actions, expires_at, leverage, margin_usd, reduce_only,
         market_type, order_type, limit_price)
      VALUES (${order.id}, ${order.tenantId}, ${order.subject}, 'hyperliquid', ${order.symbol},
              ${order.side}, ${order.quantity}, ${order.clientOrderId}, 'prepared',
              ${order.accountAddress.toLowerCase()}, ${JSON.stringify(order.preparedActions)}::text::jsonb,
              ${order.expiresAt}, ${order.leverage}, ${order.marginUsd}, ${order.reduceOnly},
              ${order.marketType}, ${order.orderType}, ${order.limitPrice})
    `;
  } finally {
    await connection.end();
  }
}

/** Moves an unexpired prepared order to submitting exactly once, so it can only be sent once. */
export async function claimHyperliquidOrder(connectionString: string, id: string, subject: string) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    const [row] = await connection`
      UPDATE market_live_orders SET status = 'submitting', updated_at = now()
      WHERE id = ${id} AND subject = ${subject} AND venue = 'hyperliquid'
        AND status = 'prepared' AND expires_at > now()
      RETURNING id, symbol, side, quantity::text, client_order_id AS "clientOrderId",
                account_address AS "accountAddress", prepared_actions AS "preparedActions",
                leverage::text, reduce_only AS "reduceOnly"
    `;
    return row
      ? {
          id: String(row.id),
          symbol: String(row.symbol),
          side: row.side as "buy" | "sell",
          quantity: String(row.quantity),
          clientOrderId: String(row.clientOrderId),
          accountAddress: String(row.accountAddress),
          preparedActions: row.preparedActions as unknown,
          leverage: String(row.leverage),
          reduceOnly: Boolean(row.reduceOnly),
        }
      : null;
  } finally {
    await connection.end();
  }
}

/** Live Hyperliquid orders whose outcome was not confirmed when they were submitted. */
export async function listUnreconciledHyperliquidOrders(connectionString: string, subject: string) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    const rows = await connection`
      SELECT id, client_order_id AS "clientOrderId", account_address AS "accountAddress",
             symbol, quantity::text, status, updated_at AS "updatedAt"
      FROM market_live_orders
      WHERE subject = ${subject} AND venue = 'hyperliquid'
        AND (status = 'open'
          OR (status IN ('submitting', 'unknown') AND updated_at < now() - interval '20 seconds'))
      ORDER BY created_at DESC LIMIT 40
    `;
    return rows.map((row) => ({
      id: String(row.id),
      clientOrderId: String(row.clientOrderId),
      accountAddress: String(row.accountAddress),
      symbol: String(row.symbol),
      quantity: String(row.quantity),
      status: String(row.status),
      updatedAt: new Date(row.updatedAt as string | Date),
    }));
  } finally {
    await connection.end();
  }
}

/** Marks prepared orders that were never signed as expired, so they leave the pending list. */
export async function expireHyperliquidOrders(connectionString: string, subject: string) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    await connection`
      UPDATE market_live_orders SET status = 'expired', updated_at = now()
      WHERE subject = ${subject} AND venue = 'hyperliquid' AND status = 'prepared'
        AND expires_at <= now()
    `;
  } finally {
    await connection.end();
  }
}

export async function listMarketLiveOrders(connectionString: string, subject: string) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    return await connection`SELECT id, venue, symbol, side, quantity::text, client_order_id AS "clientOrderId", venue_order_id AS "venueOrderId", status, fill_price::text AS "fillPrice", fee_usd::text AS "feeUsd", leverage::text, margin_usd::text AS "marginUsd", reduce_only AS "reduceOnly", market_type AS "marketType", order_type AS "orderType", limit_price::text AS "limitPrice", created_at AS "createdAt" FROM market_live_orders WHERE subject = ${subject} AND status <> 'prepared' AND status <> 'expired' ORDER BY created_at DESC LIMIT 50`;
  } finally {
    await connection.end();
  }
}

export type PredictionPaperState = {
  cashUsd: string;
  positions: Record<string, { contracts: string; costUsd: string }>;
};

export async function applyPredictionPaperOrder(
  connectionString: string,
  order: {
    id: string;
    tenantId: string;
    subject: string;
    marketId: string;
    outcome: "yes" | "no";
    depositUsd: string;
    fillPriceUsd: string;
    closesAt: string;
  },
  decide: (state: PredictionPaperState) => {
    state: PredictionPaperState;
    contracts: string;
    feeUsd: string;
  },
) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    return await connection.begin(async (transaction) => {
      await transaction`INSERT INTO prediction_paper_accounts (subject) VALUES (${order.subject}) ON CONFLICT DO NOTHING`;
      const [account] =
        await transaction`SELECT cash_usd::text AS "cashUsd", positions FROM prediction_paper_accounts WHERE subject = ${order.subject} FOR UPDATE`;
      if (!account) throw new Error("Prediction paper account unavailable");
      const [existing] = await transaction`
        SELECT id::text, subject, market_id AS "marketId", outcome,
               deposit_usd::text AS "depositUsd", fill_price_usd::text AS "fillPriceUsd",
               contracts::text, fee_usd::text AS "feeUsd", status
        FROM prediction_paper_orders WHERE id = ${order.id}::uuid
      `;
      if (existing) {
        if (
          existing.subject !== order.subject ||
          existing.marketId !== order.marketId ||
          existing.outcome !== order.outcome ||
          existing.depositUsd !== order.depositUsd
        )
          throw new Error("Prediction paper request ID is already used");
        return existing;
      }
      const settled = decide({
        cashUsd: String(account.cashUsd),
        positions: account.positions as PredictionPaperState["positions"],
      });
      await transaction`
        UPDATE prediction_paper_accounts
        SET cash_usd = ${settled.state.cashUsd},
            positions = ${JSON.stringify(settled.state.positions)}::text::jsonb,
            updated_at = now()
        WHERE subject = ${order.subject}
      `;
      const [created] = await transaction`
        INSERT INTO prediction_paper_orders
          (id, tenant_id, subject, market_id, outcome, deposit_usd, fill_price_usd,
           contracts, fee_usd, closes_at)
        VALUES (${order.id}, ${order.tenantId}, ${order.subject}, ${order.marketId},
                ${order.outcome}, ${order.depositUsd}, ${order.fillPriceUsd},
                ${settled.contracts}, ${settled.feeUsd}, ${order.closesAt})
        RETURNING id::text, market_id AS "marketId", outcome,
                  deposit_usd::text AS "depositUsd", fill_price_usd::text AS "fillPriceUsd",
                  contracts::text, fee_usd::text AS "feeUsd", status
      `;
      return created;
    });
  } finally {
    await connection.end();
  }
}

export async function getPredictionPaperAccount(connectionString: string, subject: string) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    const [account] = await connection`
      SELECT cash_usd::text AS "cashUsd", positions, updated_at AS "updatedAt"
      FROM prediction_paper_accounts WHERE subject = ${subject}
    `;
    return account ?? { cashUsd: "10000", positions: {}, updatedAt: null };
  } finally {
    await connection.end();
  }
}

export async function listPredictionPaperOrders(connectionString: string, subject: string) {
  const connection = postgres(connectionString, { max: 1, connect_timeout: 3 });
  try {
    return await connection`
      SELECT id::text, market_id AS "marketId", outcome,
             deposit_usd::text AS "depositUsd", fill_price_usd::text AS "fillPriceUsd",
             contracts::text, fee_usd::text AS "feeUsd", status,
             closes_at AS "closesAt", created_at AS "createdAt"
      FROM prediction_paper_orders WHERE subject = ${subject}
      ORDER BY created_at DESC LIMIT 100
    `;
  } finally {
    await connection.end();
  }
}

export async function savePredictionOrder(
  connectionString: string,
  order: {
    id: string;
    tenantId: string;
    subject: string;
    wallet: string;
    marketId: string;
    outcome: "yes" | "no";
    depositAmount: string;
    orderPubkey: string;
    unsignedTransaction: string;
    expiresAt: Date;
    priceUsd?: number | null;
    contracts?: number | null;
    feeUsd?: number | null;
  },
) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    await connection`INSERT INTO prediction_orders (
      id, tenant_id, subject, wallet, market_id, outcome, deposit_amount, order_pubkey, unsigned_transaction, status, expires_at, price_usd, contracts, fee_usd
    ) VALUES (
      ${order.id}, ${order.tenantId}, ${order.subject}, ${order.wallet}, ${order.marketId}, ${order.outcome}, ${order.depositAmount}, ${order.orderPubkey}, ${order.unsignedTransaction}, 'prepared', ${order.expiresAt}, ${order.priceUsd ?? null}, ${order.contracts ?? null}, ${order.feeUsd ?? null}
    )`;
  } finally {
    await connection.end();
  }
}

export async function claimPredictionOrder(connectionString: string, id: string, subject: string) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    const [order] =
      await connection`UPDATE prediction_orders SET status = 'submitting', updated_at = now() WHERE id = ${id} AND subject = ${subject} AND status = 'prepared' AND expires_at > now() RETURNING wallet, unsigned_transaction AS "unsignedTransaction", order_pubkey AS "orderPubkey"`;
    return order ?? null;
  } finally {
    await connection.end();
  }
}

export async function finishPredictionOrder(
  connectionString: string,
  id: string,
  status: "submitted" | "confirmed" | "failed" | "unknown",
  signature?: string,
) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    await connection`UPDATE prediction_orders SET status = ${status}, signature = ${signature ?? null}, updated_at = now() WHERE id = ${id}`;
  } finally {
    await connection.end();
  }
}

export async function listPredictionOrders(connectionString: string, subject: string) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    return await connection`SELECT id, wallet, market_id AS "marketId", outcome, deposit_amount AS "depositAmount", order_pubkey AS "orderPubkey", status, signature, price_usd AS "priceUsd", contracts, fee_usd AS "feeUsd", created_at AS "createdAt" FROM prediction_orders WHERE subject = ${subject} ORDER BY created_at DESC LIMIT 50`;
  } finally {
    await connection.end();
  }
}

export async function listMarketPaperAccounts(connectionString: string) {
  const connection = postgres(connectionString, { max: 2, connect_timeout: 10 });
  try {
    return await connection`SELECT subject, cash_usd::text AS "cashUsd", spot_holdings AS "spotHoldings", perp_positions AS "perpPositions", updated_at AS "updatedAt" FROM market_paper_accounts LIMIT 1000`;
  } finally {
    await connection.end();
  }
}

export async function recordSolanaWebhookEvents(
  connectionString: string,
  events: Array<{ signature: string; eventType: string }>,
) {
  if (!events.length) return 0;
  const connection = createDatabase(connectionString);
  try {
    const uniqueEvents = [...new Map(events.map((event) => [event.signature, event])).values()];
    const inserted = await connection.db
      .insert(schema.solanaWebhookEvents)
      .values(uniqueEvents)
      .onConflictDoNothing()
      .returning({ signature: schema.solanaWebhookEvents.signature });
    return inserted.length;
  } finally {
    await connection.close();
  }
}

export async function resolvePrivyMembership(connectionString: string, privyUserId: string) {
  const connection = createDatabase(connectionString);
  try {
    const userId = `privy:${privyUserId}`;
    const personalOrganizationId = `personal:${privyUserId}`;
    await connection.db
      .insert(schema.siseraUsers)
      .values({ id: userId, privyUserId })
      .onConflictDoNothing();
    const existing = await connection.db
      .select({
        organizationId: schema.organizationMemberships.organizationId,
        role: schema.organizationMemberships.role,
      })
      .from(schema.organizationMemberships)
      .where(eq(schema.organizationMemberships.userId, userId))
      .limit(20);
    if (existing.length) return { userId, memberships: existing };
    await connection.db
      .insert(schema.organizations)
      .values({ id: personalOrganizationId, name: "Personal workspace" })
      .onConflictDoNothing();
    await connection.db
      .insert(schema.organizationMemberships)
      .values({ userId, organizationId: personalOrganizationId, role: "trader" })
      .onConflictDoNothing();
    return { userId, memberships: [{ organizationId: personalOrganizationId, role: "trader" }] };
  } finally {
    await connection.close();
  }
}
export * from "./platform.js";

export * from "./marketplace.js";
export * from "./research.js";
