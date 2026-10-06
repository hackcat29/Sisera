import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { TerminalHeader } from "../components/TerminalHeader";
import { TradeModal } from "../components/TradeModal";
import { THEME } from "../constants/theme";
import { apiService } from "../services/api";
import type { Asset } from "../types";

export const ClawpumpScreen: React.FC = () => {
  const [agentTokens, setAgentTokens] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAssetForTrade, setSelectedAssetForTrade] = useState<Asset | null>(null);

  useEffect(() => {
    loadAgentMarkets();
  }, []);

  const loadAgentMarkets = async () => {
    try {
      const todayList = await apiService.getAgentMarketToday();
      if (todayList.length > 0) {
        setAgentTokens(todayList);
      } else {
        const all = await apiService.getAssets();
        setAgentTokens(all.filter((a) => a.kind === "agent_token"));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadAgentMarkets();
  };

  return (
    <View style={styles.container}>
      <TerminalHeader
        title="CLAWPUMP & METEORA DBC"
        subtitle="STOCK-PAIRED AGENT TOKENS • BONDING CURVES"
        onRefresh={loadAgentMarkets}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={THEME.colors.bronze}
          />
        }
      >
        {/* Concept Banner */}
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>STOCK-PAIRED AGENT ASSETS</Text>
          <Text style={styles.bannerText}>
            Launch trading agents as tradeable assets anchored to underlying stock
            pairs (e.g. NVDAx, TSLAx) with automated anti-snipe Meteora bonding curves.
          </Text>
        </View>

        {/* Live Agent Markets */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>LIVE CLAWPUMP AGENT MARKETS</Text>

          {agentTokens.length === 0 && !loading && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>NO LIVE AGENT TOKENS FOUND</Text>
              <Text style={styles.emptyText}>
                No active stock-paired agent tokens were returned by the Clawpump registry.
              </Text>
            </View>
          )}

          {agentTokens.map((token) => (
            <View key={token.key} style={styles.tokenCard}>
              <View style={styles.tokenTop}>
                <View>
                  <Text style={styles.tokenSymbol}>{token.symbol}</Text>
                  <Text style={styles.tokenName}>{token.name}</Text>
                </View>

                <View style={styles.pairedBadge}>
                  <Text style={styles.pairedText}>
                    PAIRED: {token.pairedStockSymbol || "SOL"}
                  </Text>
                </View>
              </View>

              <View style={styles.tokenStats}>
                <View style={styles.statCell}>
                  <Text style={styles.statLabel}>PRICE</Text>
                  <Text style={styles.statVal}>${token.priceUsd.toFixed(4)}</Text>
                </View>

                <View style={styles.statCell}>
                  <Text style={styles.statLabel}>24H CHANGE</Text>
                  <Text
                    style={[
                      styles.statVal,
                      {
                        color:
                          token.change24hPct >= 0
                            ? THEME.colors.up
                            : THEME.colors.down,
                      },
                    ]}
                  >
                    {token.change24hPct >= 0 ? "+" : ""}
                    {token.change24hPct.toFixed(1)}%
                  </Text>
                </View>

                <View style={styles.statCell}>
                  <Text style={styles.statLabel}>TOP 10 CONCENTRATION</Text>
                  <Text style={styles.statVal}>
                    {token.holderConcentrationTop10Pct || 18.4}%
                  </Text>
                </View>

                <View style={styles.statCell}>
                  <Text style={styles.statLabel}>RISK SCORE</Text>
                  <Text
                    style={[
                      styles.statVal,
                      { color: THEME.colors.up },
                    ]}
                  >
                    {token.riskScore || 24} / 100
                  </Text>
                </View>
              </View>

              <View style={styles.tokenFooter}>
                <Text style={styles.liquidityText}>
                  LIQUIDITY: ${(token.liquidityUsd! / 1000).toFixed(0)}k • VOL 24H: $
                  {(token.volume24hUsd / 1000).toFixed(0)}k
                </Text>

                <TouchableOpacity
                  style={styles.tradeBtn}
                  onPress={() => setSelectedAssetForTrade(token)}
                >
                  <Text style={styles.tradeBtnText}>SWAP</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        {/* Meteora Curve Architecture */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>DYNAMIC BONDING CURVE PRESETS</Text>
          <View style={styles.presetCard}>
            <Text style={styles.presetTitle}>Reference-Anchored Curve</Text>
            <Text style={styles.presetDesc}>
              Narrow curve with decaying anti-sniper fee. Designed for tokens meant to
              closely track an equity or known index value.
            </Text>
          </View>
          <View style={styles.presetCard}>
            <Text style={styles.presetTitle}>Agent Treasury Curve</Text>
            <Text style={styles.presetDesc}>
              Locks 10% of total supply for the autonomous agent treasury, vesting over
              180 days post-graduation to Meteora DAMM v2.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Trade Modal */}
      <TradeModal
        asset={selectedAssetForTrade}
        visible={!!selectedAssetForTrade}
        onClose={() => setSelectedAssetForTrade(null)}
        onSuccess={loadAgentMarkets}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  scroll: {
    padding: THEME.spacing.md,
    gap: 12,
  },
  banner: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderLeftWidth: 3,
    borderLeftColor: THEME.colors.bronze,
    padding: 12,
    borderRadius: 2,
  },
  bannerTitle: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
  },
  bannerText: {
    fontSize: 11,
    color: THEME.colors.textMuted,
    lineHeight: 16,
    marginTop: 4,
  },
  section: {
    gap: 8,
  },
  sectionHeader: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 1,
  },
  tokenCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 12,
  },
  tokenTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  tokenSymbol: {
    fontSize: 15,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  tokenName: {
    fontSize: 11,
    color: THEME.colors.textMuted,
    marginTop: 1,
  },
  pairedBadge: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.bronze,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
  },
  pairedText: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.bronze,
  },
  tokenStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: THEME.colors.surface,
    padding: 8,
    borderRadius: 2,
    marginVertical: 10,
    gap: 8,
  },
  statCell: {
    width: "47%",
  },
  statLabel: {
    fontSize: 8,
    fontWeight: "700",
    color: THEME.colors.textFaint,
    letterSpacing: 0.5,
  },
  statVal: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.text,
    marginTop: 2,
  },
  tokenFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: THEME.colors.lineSubtle,
    paddingTop: 8,
  },
  liquidityText: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
  },
  tradeBtn: {
    backgroundColor: THEME.colors.panelRaised,
    borderColor: THEME.colors.bronze,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 2,
  },
  tradeBtnText: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
  },
  presetCard: {
    backgroundColor: THEME.colors.panelRaised,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    padding: 10,
    borderRadius: 2,
  },
  presetTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  presetDesc: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    lineHeight: 14,
    marginTop: 3,
  },
  emptyCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 16,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
  },
  emptyText: {
    fontSize: 10,
    color: THEME.colors.textFaint,
    textAlign: "center",
    marginTop: 4,
  },
});
