import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { THEME } from "../constants/theme";
import type { Asset } from "../types";

interface MarketCardProps {
  asset: Asset;
  onTrade?: (asset: Asset) => void;
  onSelect?: (asset: Asset) => void;
}

export const MarketCard: React.FC<MarketCardProps> = ({
  asset,
  onTrade,
  onSelect,
}) => {
  const isUp = asset.change24hPct >= 0;
  const pnlColor = isUp ? THEME.colors.up : THEME.colors.down;

  const kindLabel =
    asset.kind === "public_equity"
      ? "xSTOCK"
      : asset.kind === "pre_ipo"
      ? "PRE-IPO"
      : "AGENT";

  const divergenceText =
    asset.premiumDiscountPct != null
      ? `${asset.premiumDiscountPct >= 0 ? "+" : ""}${asset.premiumDiscountPct.toFixed(2)}%`
      : null;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onSelect?.(asset)}
      activeOpacity={0.8}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleGroup}>
          <Text style={styles.symbol}>{asset.symbol}</Text>
          <View style={styles.kindBadge}>
            <Text style={styles.kindText}>{kindLabel}</Text>
          </View>
        </View>

        <View style={styles.priceGroup}>
          <Text style={styles.price}>
            ${asset.priceUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Text>
          <Text style={[styles.delta, { color: pnlColor }]}>
            {isUp ? "+" : ""}
            {asset.change24hPct.toFixed(2)}%
          </Text>
        </View>
      </View>

      <Text style={styles.name} numberOfLines={1}>
        {asset.name}
      </Text>

      {/* Fair value / reference layer */}
      {asset.referencePriceUsd != null && (
        <View style={styles.refRow}>
          <Text style={styles.refLabel}>
            REF ({asset.referenceSource || "Pyth"}):
          </Text>
          <Text style={styles.refValue}>
            ${asset.referencePriceUsd.toFixed(2)}
          </Text>
          {divergenceText && (
            <Text
              style={[
                styles.spreadBadge,
                {
                  color:
                    (asset.premiumDiscountPct ?? 0) > 0
                      ? THEME.colors.warning
                      : THEME.colors.verdigris,
                },
              ]}
            >
              GAP: {divergenceText}
            </Text>
          )}
        </View>
      )}

      {/* Footer with Volume & Quick Trade */}
      <View style={styles.footerRow}>
        <View style={styles.volGroup}>
          <Text style={styles.statLabel}>24H VOL</Text>
          <Text style={styles.statValue}>
            ${(asset.volume24hUsd / 1_000_000).toFixed(2)}M
          </Text>
        </View>

        {asset.liquidityUsd != null && (
          <View style={styles.volGroup}>
            <Text style={styles.statLabel}>LIQUIDITY</Text>
            <Text style={styles.statValue}>
              ${(asset.liquidityUsd / 1_000_000).toFixed(2)}M
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.tradeButton}
          onPress={() => onTrade?.(asset)}
          activeOpacity={0.7}
        >
          <Text style={styles.tradeButtonText}>TRADE</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: THEME.borderRadius.sm,
    padding: THEME.spacing.md,
    marginBottom: THEME.spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  titleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  symbol: {
    fontSize: 16,
    fontWeight: "700",
    color: THEME.colors.text,
    fontFamily: THEME.fonts.mono,
  },
  kindBadge: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderColor: THEME.colors.lineStrong,
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  kindText: {
    fontSize: 9,
    fontWeight: "700",
    color: THEME.colors.bronze,
    letterSpacing: 0.5,
  },
  priceGroup: {
    alignItems: "flex-end",
  },
  price: {
    fontSize: 16,
    fontWeight: "700",
    color: THEME.colors.text,
    fontFamily: THEME.fonts.mono,
  },
  delta: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
    fontFamily: THEME.fonts.mono,
  },
  name: {
    fontSize: 12,
    color: THEME.colors.textMuted,
    marginTop: 2,
    marginBottom: 8,
  },
  refRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 2,
    gap: 6,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
  },
  refLabel: {
    fontSize: 10,
    color: THEME.colors.textFaint,
    fontWeight: "600",
  },
  refValue: {
    fontSize: 10,
    color: THEME.colors.text,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
  },
  spreadBadge: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    marginLeft: "auto",
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: THEME.colors.lineSubtle,
    paddingTop: 8,
  },
  volGroup: {
    flexDirection: "column",
  },
  statLabel: {
    fontSize: 9,
    color: THEME.colors.textFaint,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 11,
    color: THEME.colors.textMuted,
    fontFamily: THEME.fonts.mono,
    marginTop: 1,
  },
  tradeButton: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderColor: THEME.colors.bronze,
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  tradeButtonText: {
    fontSize: 11,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 1,
  },
});
