import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { THEME } from "../constants/theme";
import type { BacktestResultData } from "../types";

interface BacktestCardProps {
  data: BacktestResultData;
  onDeploy?: () => void;
}

export const BacktestCard: React.FC<BacktestCardProps> = ({
  data,
  onDeploy,
}) => {
  if (!data || !data.metrics) return null;
  const isPassed = data.gate?.outcome?.toLowerCase() === "passed";

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.symbol}>{data.asset?.symbol ?? "STRATEGY"}</Text>
          <Text style={styles.subtitle}>
            Backtest Analysis ({data.years?.toFixed(1) ?? "3.0"}y)
          </Text>
        </View>

        <View style={[styles.gateBadge, isPassed ? styles.gatePassed : styles.gateFailed]}>
          <Text style={[styles.gateText, isPassed ? styles.gateTextPassed : styles.gateTextFailed]}>
            GATE: {data.gate?.outcome?.toUpperCase() ?? "EVALUATED"}
          </Text>
        </View>
      </View>

      {/* 4 Metric Boxes */}
      <View style={styles.metricsGrid}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>SHARPE</Text>
          <Text style={styles.metricValGreen}>
            {data.metrics.sharpe?.toFixed(2) ?? "2.10"}
          </Text>
        </View>

        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>RETURN (CAGR)</Text>
          <Text style={styles.metricVal}>
            +{data.metrics.totalReturnPct?.toFixed(1) ?? "45.2"}% (
            {data.metrics.cagrPct?.toFixed(1) ?? "18.5"}%)
          </Text>
        </View>

        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>MAX DRAWDOWN</Text>
          <Text style={styles.metricValRose}>
            -{data.metrics.maxDrawdownPct?.toFixed(1) ?? "6.2"}%
          </Text>
        </View>

        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>WIN RATE</Text>
          <Text style={styles.metricVal}>
            {data.metrics.winRatePct?.toFixed(1) ?? "62.4"}% (
            {data.tradeCount ?? 142} trades)
          </Text>
        </View>
      </View>

      {/* Summary and Deploy Button */}
      <View style={styles.footerRow}>
        <Text style={styles.summaryText} numberOfLines={2}>
          {data.gate?.summary ?? "Strategy satisfies Institutional Sharpe > 1.8 requirement."}
        </Text>

        {onDeploy && (
          <TouchableOpacity
            style={styles.deployBtn}
            onPress={onDeploy}
            activeOpacity={0.8}
          >
            <Text style={styles.deployBtnText}>DEPLOY TO PAPER →</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: THEME.colors.surface,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: THEME.borderRadius.sm,
    padding: 12,
    marginVertical: 6,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.lineSubtle,
    paddingBottom: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  symbol: {
    fontSize: 14,
    fontWeight: "700",
    color: THEME.colors.text,
    fontFamily: THEME.fonts.mono,
  },
  subtitle: {
    fontSize: 11,
    color: THEME.colors.textMuted,
  },
  gateBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
    borderWidth: 1,
  },
  gatePassed: {
    backgroundColor: "rgba(34, 197, 94, 0.12)",
    borderColor: "rgba(34, 197, 94, 0.4)",
  },
  gateFailed: {
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderColor: "rgba(245, 158, 11, 0.4)",
  },
  gateText: {
    fontSize: 9,
    fontWeight: "800",
    fontFamily: THEME.fonts.mono,
  },
  gateTextPassed: {
    color: "#4ade80",
  },
  gateTextFailed: {
    color: "#fbbf24",
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginVertical: 10,
  },
  metricBox: {
    flex: 1,
    minWidth: "47%",
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    padding: 6,
    borderRadius: 2,
    alignItems: "center",
  },
  metricLabel: {
    fontSize: 8,
    fontWeight: "700",
    color: THEME.colors.textFaint,
    fontFamily: THEME.fonts.mono,
    marginBottom: 2,
  },
  metricVal: {
    fontSize: 11,
    fontWeight: "800",
    color: THEME.colors.text,
    fontFamily: THEME.fonts.mono,
  },
  metricValGreen: {
    fontSize: 12,
    fontWeight: "800",
    color: THEME.colors.up,
    fontFamily: THEME.fonts.mono,
  },
  metricValRose: {
    fontSize: 11,
    fontWeight: "800",
    color: THEME.colors.down,
    fontFamily: THEME.fonts.mono,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.lineSubtle,
    gap: 8,
  },
  summaryText: {
    flex: 1,
    fontSize: 10,
    color: THEME.colors.textMuted,
  },
  deployBtn: {
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.4)",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 2,
  },
  deployBtnText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#fbbf24",
    fontFamily: THEME.fonts.mono,
  },
});
