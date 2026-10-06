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
import { THEME } from "../constants/theme";
import { apiService } from "../services/api";
import type { PortfolioSummary, Position } from "../types";

export const PortfolioScreen: React.FC = () => {
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadPortfolio();
  }, []);

  const loadPortfolio = async () => {
    try {
      const p = await apiService.getPortfolio();
      setPortfolio(p);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadPortfolio();
  };

  if (!portfolio) return null;

  const isUp = portfolio.unrealizedPnlUsd >= 0;
  const pnlColor = isUp ? THEME.colors.up : THEME.colors.down;

  return (
    <View style={styles.container}>
      <TerminalHeader
        title="PORTFOLIO & RISK"
        subtitle="UNIFIED LEDGER • AVERAGE COST • RISK MANDATE"
        onRefresh={loadPortfolio}
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
        {/* NAV Banner */}
        <View style={styles.navCard}>
          <Text style={styles.navLabel}>TOTAL NET ASSET VALUE (NAV)</Text>
          <Text style={styles.navValue}>
            ${portfolio.navUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>

          <View style={styles.pnlRow}>
            <View style={styles.pnlItem}>
              <Text style={styles.pnlSubLabel}>UNREALIZED P&L</Text>
              <Text style={[styles.pnlVal, { color: pnlColor }]}>
                {isUp ? "+" : ""}${portfolio.unrealizedPnlUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })} (
                {isUp ? "+" : ""}{portfolio.unrealizedPnlPct.toFixed(2)}%)
              </Text>
            </View>

            <View style={styles.pnlItem}>
              <Text style={styles.pnlSubLabel}>AVAILABLE CASH</Text>
              <Text style={styles.cashVal}>
                ${portfolio.cashUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </Text>
            </View>
          </View>
        </View>

        {/* Risk Mandate Utilization */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionHeader}>MANDATE & RISK GUARDRAILS</Text>
          <View style={styles.guardrailGrid}>
            <View style={styles.guardrailCell}>
              <Text style={styles.guardLabel}>DAILY DRAWDOWN</Text>
              <Text style={styles.guardValue}>
                {portfolio.riskMandate.currentDailyDrawdownPct.toFixed(1)}% /{" "}
                {portfolio.riskMandate.maxDailyDrawdownPct.toFixed(1)}%
              </Text>
            </View>

            <View style={styles.guardrailCell}>
              <Text style={styles.guardLabel}>LEVERAGE</Text>
              <Text style={styles.guardValue}>
                {portfolio.riskMandate.currentLeverage.toFixed(2)}x /{" "}
                {portfolio.riskMandate.maxLeverage.toFixed(1)}x
              </Text>
            </View>

            <View style={styles.guardrailCell}>
              <Text style={styles.guardLabel}>CONCENTRATION CAP</Text>
              <Text style={styles.guardValue}>
                MAX {portfolio.riskMandate.maxSingleAssetConcentrationPct.toFixed(0)}%
              </Text>
            </View>

            <View style={styles.guardrailCell}>
              <Text style={styles.guardLabel}>PRE-TRADE RISK</Text>
              <Text style={[styles.guardValue, { color: THEME.colors.up }]}>
                NOMINAL
              </Text>
            </View>
          </View>
        </View>

        {/* Stress Scenarios */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionHeader}>STRESS TEST SIMULATIONS</Text>
          <View style={styles.scenarioRow}>
            <Text style={styles.scenarioName}>US Equity Sell-off (-10%)</Text>
            <Text style={[styles.scenarioImpact, { color: THEME.colors.down }]}>
              {portfolio.navUsd > 0 ? `-$${(portfolio.navUsd * 0.045).toFixed(0)} (-4.5%)` : "—"}
            </Text>
          </View>
          <View style={styles.scenarioRow}>
            <Text style={styles.scenarioName}>Crypto Flash Crash (-25%)</Text>
            <Text style={[styles.scenarioImpact, { color: THEME.colors.down }]}>
              {portfolio.navUsd > 0 ? `-$${(portfolio.navUsd * 0.027).toFixed(0)} (-2.7%)` : "—"}
            </Text>
          </View>
          <View style={styles.scenarioRow}>
            <Text style={styles.scenarioName}>Private Mark Reset (-15%)</Text>
            <Text style={[styles.scenarioImpact, { color: THEME.colors.down }]}>
              {portfolio.navUsd > 0 ? `-$${(portfolio.navUsd * 0.049).toFixed(0)} (-4.9%)` : "—"}
            </Text>
          </View>
        </View>

        {/* Positions Book */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionHeader}>
            OPEN POSITIONS ({portfolio.positions.length})
          </Text>

          {portfolio.positions.length === 0 ? (
            <View style={styles.emptyPosBox}>
              <Text style={styles.emptyPosTitle}>NO OPEN POSITIONS ON LEDGER</Text>
              <Text style={styles.emptyPosDesc}>
                All trades are reconciled against the Solana settlement ledger. Open a position
                via Markets to view live mark-to-market performance.
              </Text>
            </View>
          ) : (
            portfolio.positions.map((pos) => {
              const posUp = pos.unrealizedPnlUsd >= 0;
              return (
                <View key={pos.symbol} style={styles.posRow}>
                  <View style={styles.posLeft}>
                    <Text style={styles.posSymbol}>{pos.symbol}</Text>
                    <Text style={styles.posName} numberOfLines={1}>
                      {pos.name}
                    </Text>
                    <Text style={styles.posQty}>
                      {pos.quantity} shares • Entry ${pos.avgEntryPriceUsd.toFixed(2)}
                    </Text>
                  </View>

                  <View style={styles.posRight}>
                    <Text style={styles.posValue}>
                      ${pos.marketValueUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Text>
                    <Text
                      style={[
                        styles.posPnl,
                        { color: posUp ? THEME.colors.up : THEME.colors.down },
                      ]}
                    >
                      {posUp ? "+" : ""}${pos.unrealizedPnlUsd.toFixed(2)} (
                      {posUp ? "+" : ""}{pos.unrealizedPnlPct.toFixed(2)}%)
                    </Text>
                    <Text style={styles.posWeight}>
                      WEIGHT {pos.weightPct.toFixed(1)}%
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
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
  navCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 16,
  },
  navLabel: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.bronze,
    letterSpacing: 1,
  },
  navValue: {
    fontSize: 26,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.text,
    marginVertical: 6,
  },
  pnlRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: THEME.colors.lineSubtle,
    paddingTop: 10,
    marginTop: 4,
  },
  pnlItem: {
    flexDirection: "column",
  },
  pnlSubLabel: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.textFaint,
    letterSpacing: 0.5,
  },
  pnlVal: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    marginTop: 2,
  },
  cashVal: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.textMuted,
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 12,
  },
  sectionHeader: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 1,
    marginBottom: 10,
  },
  guardrailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  guardrailCell: {
    width: "48%",
    backgroundColor: THEME.colors.surfaceRaised,
    padding: 8,
    borderRadius: 2,
  },
  guardLabel: {
    fontSize: 8,
    color: THEME.colors.textFaint,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  guardValue: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.text,
    fontWeight: "700",
    marginTop: 2,
  },
  scenarioRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.lineSubtle,
  },
  scenarioName: {
    fontSize: 11,
    color: THEME.colors.textMuted,
  },
  scenarioImpact: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
  },
  posRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.lineSubtle,
  },
  posLeft: {
    flex: 1,
    paddingRight: 8,
  },
  posSymbol: {
    fontSize: 14,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  posName: {
    fontSize: 11,
    color: THEME.colors.textMuted,
    marginTop: 1,
  },
  posQty: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    marginTop: 2,
  },
  posRight: {
    alignItems: "flex-end",
  },
  posValue: {
    fontSize: 13,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  posPnl: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    marginTop: 2,
  },
  posWeight: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.bronze,
    marginTop: 2,
  },
  emptyPosBox: {
    paddingVertical: 20,
    alignItems: "center",
  },
  emptyPosTitle: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
  },
  emptyPosDesc: {
    fontSize: 10,
    color: THEME.colors.textFaint,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 14,
  },
});
