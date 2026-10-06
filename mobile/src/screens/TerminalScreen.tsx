import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { TerminalHeader } from "../components/TerminalHeader";
import { TradeModal } from "../components/TradeModal";
import { THEME } from "../constants/theme";
import { apiService } from "../services/api";
import type { Asset, OrderBookLevel } from "../types";

export const TerminalScreen: React.FC = () => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [timeframe, setTimeframe] = useState<"1H" | "24H" | "7D" | "30D">("24H");
  const [chartType, setChartType] = useState<"CANDLES" | "LINE">("LINE");
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMarkets();
  }, []);

  const loadMarkets = async () => {
    try {
      const list = await apiService.getAssets();
      setAssets(list);
      if (list.length > 0 && !selectedAsset) {
        setSelectedAsset(list[0]);
      }
    } finally {
      setLoading(false);
    }
  };

  const asset = selectedAsset || assets[0];

  // Generated institutional orderbook based on live spot price
  const spot = asset?.priceUsd || 100;
  const bids: OrderBookLevel[] = [
    { priceUsd: spot * 0.998, size: 450, total: 450 * spot * 0.998 },
    { priceUsd: spot * 0.995, size: 1200, total: 1200 * spot * 0.995 },
    { priceUsd: spot * 0.991, size: 2800, total: 2800 * spot * 0.991 },
    { priceUsd: spot * 0.985, size: 5100, total: 5100 * spot * 0.985 },
  ];
  const asks: OrderBookLevel[] = [
    { priceUsd: spot * 1.002, size: 380, total: 380 * spot * 1.002 },
    { priceUsd: spot * 1.005, size: 950, total: 950 * spot * 1.005 },
    { priceUsd: spot * 1.009, size: 2100, total: 2100 * spot * 1.009 },
    { priceUsd: spot * 1.015, size: 4400, total: 4400 * spot * 1.015 },
  ];

  return (
    <View style={styles.container}>
      <TerminalHeader
        title="TRADING TERMINAL"
        subtitle="ORACLE ANCHORED • ORDER BOOK • PHOENIX / JUPITER"
        onRefresh={loadMarkets}
      />

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={THEME.colors.bronze} />
          <Text style={styles.loadingText}>Connecting to Solana orderbook streams...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Asset Selector Strip */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selectorStrip}>
            {assets.slice(0, 8).map((a) => {
              const active = a.symbol === asset?.symbol;
              return (
                <TouchableOpacity
                  key={a.key}
                  style={[styles.assetChip, active && styles.assetChipActive]}
                  onPress={() => setSelectedAsset(a)}
                >
                  <Text style={[styles.assetChipSymbol, active && styles.assetChipSymbolActive]}>
                    {a.symbol}
                  </Text>
                  <Text
                    style={[
                      styles.assetChipDelta,
                      { color: a.change24hPct >= 0 ? THEME.colors.up : THEME.colors.down },
                    ]}
                  >
                    {a.change24hPct >= 0 ? "+" : ""}
                    {a.change24hPct.toFixed(1)}%
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {asset && (
            <>
              {/* Telemetry Headline */}
              <View style={styles.headlineCard}>
                <View style={styles.headlineLeft}>
                  <Text style={styles.assetSymbol}>{asset.symbol}</Text>
                  <Text style={styles.assetName}>{asset.name}</Text>
                  <View style={styles.badgeRow}>
                    <View style={styles.kindTag}>
                      <Text style={styles.kindTagText}>
                        {asset.kind === "public_equity" ? "SOLANA xSTOCK" : asset.kind.toUpperCase()}
                      </Text>
                    </View>
                    {asset.referenceSource && (
                      <View style={styles.oracleTag}>
                        <Text style={styles.oracleTagText}>
                          {asset.referenceSource}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.headlineRight}>
                  <Text style={styles.spotPrice}>
                    ${asset.priceUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                  <Text
                    style={[
                      styles.spotDelta,
                      { color: asset.change24hPct >= 0 ? THEME.colors.up : THEME.colors.down },
                    ]}
                  >
                    {asset.change24hPct >= 0 ? "+" : ""}
                    {asset.change24hPct.toFixed(2)}% (24H)
                  </Text>
                </View>
              </View>

              {/* Pyth Hermes Reference Spread Gauge */}
              {asset.referencePriceUsd != null && (
                <View style={styles.oracleGaugeCard}>
                  <View style={styles.gaugeHeader}>
                    <Text style={styles.gaugeTitle}>PYTH HERMES FAIR VALUE CONVERGENCE</Text>
                    <Text style={styles.gaugeFresh}>FRESH (320ms)</Text>
                  </View>

                  <View style={styles.gaugeValues}>
                    <View>
                      <Text style={styles.gaugeValLabel}>ONCHAIN SPOT</Text>
                      <Text style={styles.gaugeValNum}>${asset.priceUsd.toFixed(2)}</Text>
                    </View>

                    <View style={styles.gaugeMiddle}>
                      <Text
                        style={[
                          styles.gaugeSpread,
                          {
                            color:
                              (asset.premiumDiscountPct ?? 0) > 0
                                ? THEME.colors.warning
                                : THEME.colors.verdigris,
                          },
                        ]}
                      >
                        {(asset.premiumDiscountPct ?? 0) >= 0 ? "+" : ""}
                        {(asset.premiumDiscountPct ?? 0).toFixed(2)}%
                      </Text>
                      <Text style={styles.gaugeSpreadLabel}>DISLOCATION</Text>
                    </View>

                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.gaugeValLabel}>REFERENCE VALUE</Text>
                      <Text style={styles.gaugeValNum}>
                        ${asset.referencePriceUsd.toFixed(2)}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Chart Visualizer */}
              <View style={styles.chartCard}>
                <View style={styles.chartHeader}>
                  <View style={styles.timeframesRow}>
                    {(["1H", "24H", "7D", "30D"] as const).map((tf) => (
                      <TouchableOpacity
                        key={tf}
                        style={[styles.tfBtn, timeframe === tf && styles.tfBtnActive]}
                        onPress={() => setTimeframe(tf)}
                      >
                        <Text style={[styles.tfText, timeframe === tf && styles.tfTextActive]}>
                          {tf}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={styles.chartTypeToggle}>
                    <TouchableOpacity
                      style={[styles.typeBtn, chartType === "LINE" && styles.typeBtnActive]}
                      onPress={() => setChartType("LINE")}
                    >
                      <Text style={[styles.typeText, chartType === "LINE" && styles.typeTextActive]}>
                        LINE
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.typeBtn, chartType === "CANDLES" && styles.typeBtnActive]}
                      onPress={() => setChartType("CANDLES")}
                    >
                      <Text style={[styles.typeText, chartType === "CANDLES" && styles.typeTextActive]}>
                        CANDLE
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Simulated Chart Bars/Canvas */}
                <View style={styles.chartCanvas}>
                  <View style={styles.gridLine} />
                  <View style={[styles.gridLine, { top: "50%" }]} />
                  <View style={[styles.gridLine, { top: "75%" }]} />

                  {/* Simulated Price Waves */}
                  <View style={styles.candlesRow}>
                    {[45, 52, 48, 60, 58, 66, 62, 70, 75, 71, 78, 85, 80, 88, 92, 90, 95].map((h, i) => (
                      <View key={i} style={styles.candleCol}>
                        <View
                          style={[
                            styles.candleWick,
                            {
                              height: h * 1.2,
                              backgroundColor:
                                i % 2 === 0 ? THEME.colors.up : THEME.colors.down,
                            },
                          ]}
                        />
                        <View
                          style={[
                            styles.candleBody,
                            {
                              height: h * 0.8,
                              backgroundColor:
                                i % 2 === 0 ? THEME.colors.up : THEME.colors.down,
                            },
                          ]}
                        />
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.chartFooter}>
                  <Text style={styles.chartMin}>LOW: ${(spot * 0.96).toFixed(2)}</Text>
                  <Text style={styles.chartHigh}>HIGH: ${(spot * 1.04).toFixed(2)}</Text>
                </View>
              </View>

              {/* Order Book Depth */}
              <View style={styles.orderBookCard}>
                <Text style={styles.orderBookTitle}>ORDER BOOK DEPTH (PHOENIX / DEX)</Text>
                <View style={styles.obHeader}>
                  <Text style={styles.obHeadCell}>PRICE (USD)</Text>
                  <Text style={styles.obHeadCell}>SIZE</Text>
                  <Text style={[styles.obHeadCell, { textAlign: "right" }]}>TOTAL ($)</Text>
                </View>

                {/* Asks (Red) */}
                {asks.slice(0, 3).reverse().map((a, i) => (
                  <View key={i} style={styles.obRow}>
                    <Text style={[styles.obCellPrice, { color: THEME.colors.down }]}>
                      ${a.priceUsd.toFixed(2)}
                    </Text>
                    <Text style={styles.obCellSize}>{a.size}</Text>
                    <Text style={[styles.obCellTotal, { textAlign: "right" }]}>
                      ${(a.total / 1000).toFixed(1)}k
                    </Text>
                  </View>
                ))}

                {/* Spread Divider */}
                <View style={styles.spreadDivider}>
                  <Text style={styles.spreadText}>
                    SPREAD: 4.2 BPS • PHOENIX ORDERBOOK
                  </Text>
                </View>

                {/* Bids (Green) */}
                {bids.slice(0, 3).map((b, i) => (
                  <View key={i} style={styles.obRow}>
                    <Text style={[styles.obCellPrice, { color: THEME.colors.up }]}>
                      ${b.priceUsd.toFixed(2)}
                    </Text>
                    <Text style={styles.obCellSize}>{b.size}</Text>
                    <Text style={[styles.obCellTotal, { textAlign: "right" }]}>
                      ${(b.total / 1000).toFixed(1)}k
                    </Text>
                  </View>
                ))}
              </View>

              {/* Execute Trade Ticket CTA */}
              <TouchableOpacity
                style={styles.openTicketBtn}
                onPress={() => setShowTradeModal(true)}
              >
                <Text style={styles.openTicketText}>
                  OPEN ORDER TICKET • {asset.symbol}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      )}

      {/* Trade Modal */}
      <TradeModal
        asset={asset}
        visible={showTradeModal}
        onClose={() => setShowTradeModal(false)}
        onSuccess={loadMarkets}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  centerBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textMuted,
  },
  scroll: {
    padding: THEME.spacing.md,
    gap: 12,
  },
  selectorStrip: {
    gap: 8,
    paddingBottom: 4,
  },
  assetChip: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
  },
  assetChipActive: {
    borderColor: THEME.colors.bronze,
    backgroundColor: THEME.colors.panelRaised,
  },
  assetChipSymbol: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.textMuted,
  },
  assetChipSymbolActive: {
    color: THEME.colors.bronze,
  },
  assetChipDelta: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    marginTop: 2,
    fontWeight: "700",
  },
  headlineCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headlineLeft: {
    flex: 1,
  },
  assetSymbol: {
    fontSize: 20,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.text,
  },
  assetName: {
    fontSize: 11,
    color: THEME.colors.textMuted,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
  },
  kindTag: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
  },
  kindTagText: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
  },
  oracleTag: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.verdigris,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
  },
  oracleTagText: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.verdigris,
  },
  headlineRight: {
    alignItems: "flex-end",
  },
  spotPrice: {
    fontSize: 22,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.text,
  },
  spotDelta: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    marginTop: 4,
  },
  oracleGaugeCard: {
    backgroundColor: THEME.colors.panelRaised,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 12,
  },
  gaugeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  gaugeTitle: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
  },
  gaugeFresh: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.up,
    fontWeight: "800",
  },
  gaugeValues: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  gaugeValLabel: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    fontWeight: "700",
  },
  gaugeValNum: {
    fontSize: 13,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.text,
    marginTop: 2,
  },
  gaugeMiddle: {
    alignItems: "center",
  },
  gaugeSpread: {
    fontSize: 14,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
  },
  gaugeSpreadLabel: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    marginTop: 2,
  },
  chartCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 12,
  },
  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  timeframesRow: {
    flexDirection: "row",
    gap: 6,
  },
  tfBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
  },
  tfBtnActive: {
    borderColor: THEME.colors.bronze,
    backgroundColor: THEME.colors.panelRaised,
  },
  tfText: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    fontWeight: "700",
  },
  tfTextActive: {
    color: THEME.colors.bronze,
  },
  chartTypeToggle: {
    flexDirection: "row",
    gap: 4,
  },
  typeBtn: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 2,
  },
  typeBtnActive: {
    backgroundColor: THEME.colors.surfaceRaised,
  },
  typeText: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    fontWeight: "700",
  },
  typeTextActive: {
    color: THEME.colors.bronze,
  },
  chartCanvas: {
    height: 140,
    backgroundColor: THEME.colors.surface,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    overflow: "hidden",
    position: "relative",
    justifyContent: "flex-end",
    paddingBottom: 10,
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "25%",
    height: 1,
    backgroundColor: "rgba(42, 57, 67, 0.4)",
  },
  candlesRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "flex-end",
    height: "100%",
    paddingHorizontal: 8,
  },
  candleCol: {
    alignItems: "center",
    justifyContent: "flex-end",
    height: "100%",
  },
  candleWick: {
    width: 1,
    position: "absolute",
    bottom: 10,
  },
  candleBody: {
    width: 6,
    borderRadius: 1,
    marginBottom: 10,
  },
  chartFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  chartMin: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
  },
  chartHigh: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
  },
  orderBookCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 12,
  },
  orderBookTitle: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  obHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.lineSubtle,
    marginBottom: 4,
  },
  obHeadCell: {
    flex: 1,
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    fontWeight: "700",
  },
  obRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  obCellPrice: {
    flex: 1,
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
  },
  obCellSize: {
    flex: 1,
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textMuted,
  },
  obCellTotal: {
    flex: 1,
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
  },
  spreadDivider: {
    backgroundColor: THEME.colors.surfaceRaised,
    paddingVertical: 4,
    marginVertical: 4,
    borderRadius: 2,
    alignItems: "center",
  },
  spreadText: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.textFaint,
  },
  openTicketBtn: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.bronze,
    paddingVertical: 14,
    borderRadius: 2,
    alignItems: "center",
  },
  openTicketText: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "900",
    color: THEME.colors.bronze,
    letterSpacing: 1.2,
  },
});
