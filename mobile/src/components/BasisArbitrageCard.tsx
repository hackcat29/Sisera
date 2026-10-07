import React, { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { THEME } from "../constants/theme";
import { apiService } from "../services/api";
import type { BasisArbitrageOpportunity } from "../types";

export interface BasisArbitrageCardProps {
  data: {
    opportunities: BasisArbitrageOpportunity[];
    recommended?: BasisArbitrageOpportunity;
    suggestedNotionalUsd?: number;
  };
  onArmed?: () => void;
}

export const BasisArbitrageCard: React.FC<BasisArbitrageCardProps> = ({
  data,
  onArmed,
}) => {
  const [armingAsset, setArmingAsset] = useState<string | null>(null);
  const [armedStatus, setArmedStatus] = useState<Record<string, string>>({});

  if (!data || !data.opportunities || data.opportunities.length === 0) {
    return null;
  }

  const suggestedNotional = data.suggestedNotionalUsd || 10_000;

  const handleArm = async (asset: string) => {
    setArmingAsset(asset);
    try {
      const res = await apiService.armBasisHarvester(asset, suggestedNotional, 1);
      if (res) {
        setArmedStatus((prev) => ({
          ...prev,
          [asset]: "Research draft created",
        }));
        onArmed?.();
      } else {
        setArmedStatus((prev) => ({ ...prev, [asset]: "Arming failed" }));
      }
    } catch {
      setArmedStatus((prev) => ({ ...prev, [asset]: "Arming error" }));
    } finally {
      setArmingAsset(null);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerBadges}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>FUNDING CARRY</Text>
          </View>
          <Text style={styles.headerSub}>Variable funding</Text>
        </View>
        <View style={styles.capitalBox}>
          <Text style={styles.capitalLabel}>Capital Target:</Text>
          <Text style={styles.capitalValue}>
            ${suggestedNotional.toLocaleString()}
          </Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>
        CROSS-VENUE FUNDING RATE HARVESTING
      </Text>

      {/* Opportunities List */}
      <View style={styles.list}>
        {data.opportunities.map((opp) => {
          const isArming = armingAsset === opp.asset;
          const status = armedStatus[opp.asset];

          return (
            <View key={opp.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <View style={styles.assetRow}>
                  <Text style={styles.assetSymbol}>{opp.asset}</Text>
                  <View style={styles.venueBadge}>
                    <Text style={styles.venueText}>
                      +{opp.spotVenue.replace("_", " ")} / -{opp.perpVenue.replace("_", " ")}
                    </Text>
                  </View>
                </View>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>{opp.status.toUpperCase()}</Text>
                </View>
              </View>

              {/* Yield & Risk Metrics */}
              <View style={styles.metricsRow}>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>PERP FUNDING</Text>
                  <Text style={[styles.metricValue, { color: THEME.colors.up }]}>
                    +{opp.fundingRateAprPct.toFixed(1)}%
                  </Text>
                </View>

                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>BORROW COST</Text>
                  <Text style={[styles.metricValue, { color: THEME.colors.down }]}>
                    -{opp.borrowCostAprPct.toFixed(1)}%
                  </Text>
                </View>

                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>MODELED NET APR</Text>
                  <Text style={[styles.metricValue, styles.netAprValue]}>
                    +{opp.netYieldAprPct.toFixed(1)}%
                  </Text>
                </View>

                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>LIQ. BUFFER</Text>
                  <Text style={styles.metricValue}>
                    {opp.liquidationBufferPct == null ? "—" : `${opp.liquidationBufferPct}%`}
                  </Text>
                </View>
              </View>

              {/* Action Button */}
              <View style={styles.actionRow}>
                {status ? (
                  <View style={styles.armedBadge}>
                    <Text style={styles.armedText}>✓ {status}</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.deployBtn, isArming && styles.btnDisabled]}
                    onPress={() => handleArm(opp.asset)}
                    disabled={isArming}
                  >
                    {isArming ? (
                      <ActivityIndicator size="small" color="#030806" />
                    ) : (
                      <Text style={styles.deployBtnText}>
                        CREATE DRAFT
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* Footer Disclaimer */}
      <Text style={styles.footerNote}>
        Variable funding · modeled fees · basis and margin risk.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.4)",
    borderRadius: 2,
    padding: 12,
    marginVertical: 6,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.line,
    paddingBottom: 8,
  },
  headerBadges: {
    flex: 1,
    gap: 4,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
  },
  badgeText: {
    color: "#34D399",
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
  },
  headerSub: {
    color: THEME.colors.textMuted,
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
  },
  capitalBox: {
    alignItems: "flex-end",
  },
  capitalLabel: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    textTransform: "uppercase",
  },
  capitalValue: {
    fontSize: 13,
    fontFamily: THEME.fonts.mono,
    color: "#34D399",
    fontWeight: "800",
  },
  sectionTitle: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: "#34D399",
    letterSpacing: 0.6,
  },
  list: {
    gap: 8,
  },
  itemCard: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 10,
    gap: 8,
  },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  assetSymbol: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.text,
  },
  venueBadge: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 2,
  },
  venueText: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textMuted,
  },
  statusBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  statusText: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    color: "#34D399",
    fontWeight: "700",
  },
  metricsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: THEME.colors.panel,
    padding: 8,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
  },
  metricItem: {
    alignItems: "center",
  },
  metricLabel: {
    fontSize: 7,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    fontWeight: "700",
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  netAprValue: {
    fontSize: 11,
    fontWeight: "800",
    color: "#34D399",
  },
  actionRow: {
    alignItems: "flex-end",
  },
  deployBtn: {
    backgroundColor: "#10B981",
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: {
    opacity: 0.6,
  },
  deployBtnText: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: "#030806",
  },
  armedBadge: {
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    borderWidth: 1,
    borderColor: "#10B981",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 2,
  },
  armedText: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: "#34D399",
  },
  footerNote: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    lineHeight: 12,
  },
});
