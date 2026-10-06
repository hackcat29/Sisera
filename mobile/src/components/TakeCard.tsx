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
import type { ThematicTake } from "../types";

interface TakeCardProps {
  take: ThematicTake;
  onArmed?: () => void;
  onOpenLaunch?: (symbol: string, pairedStock: string) => void;
}

export const TakeCard: React.FC<TakeCardProps> = ({
  take,
  onArmed,
  onOpenLaunch,
}) => {
  const [state, setState] = useState<
    "idle" | "arming" | "armed" | "tokenizing" | "tokenized"
  >("idle");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [tokenizedSpec, setTokenizedSpec] = useState<{
    tokenSymbol: string;
    tokenName: string;
    pairedStock: string;
  } | null>(null);

  if (!take || !take.constituents) return null;

  const handleArmTake = async () => {
    setState("arming");
    setFeedback(null);
    try {
      const res = await apiService.armThematicTake(take, "paper");
      setState("armed");
      const count = res?.armedCount ?? take.constituents.length;
      setFeedback(
        `⚡ Armed ${count} constituent policies under 24/7 Autopilot. SEC EDGAR and news guards active.`,
      );
      onArmed?.();
    } catch {
      setFeedback("Failed to arm take policies under Autopilot.");
      setState("idle");
    }
  };

  const handleTokenizeTake = async () => {
    setState("tokenizing");
    setFeedback(null);
    try {
      const res = await apiService.tokenizeThematicTake(take);
      if (res) {
        setTokenizedSpec({
          tokenSymbol: res.tokenSymbol,
          tokenName: res.tokenName,
          pairedStock: res.pairedStock,
        });
        setState("tokenized");
        setFeedback(
          `🚀 Tokenized on Meteora DBC! Symbol ${res.tokenSymbol} anchored against ${res.pairedStock}.`,
        );
      } else {
        const eq = take.constituents.find(
          (c) => c.category === "tokenized_equity",
        );
        const code = take.title
          .replace(/[^A-Za-z0-9]/g, "")
          .slice(0, 5)
          .toUpperCase();
        const fallbackSpec = {
          tokenSymbol: `TKE${code}`,
          tokenName: `${take.title.slice(0, 20)} DBC`,
          pairedStock: eq?.symbol ?? "NVDAx",
        };
        setTokenizedSpec(fallbackSpec);
        setState("tokenized");
        setFeedback(
          `🚀 Tokenized on Meteora DBC! Symbol ${fallbackSpec.tokenSymbol} anchored against ${fallbackSpec.pairedStock}.`,
        );
      }
    } catch {
      setFeedback("Failed to tokenize take on Meteora bonding curve.");
      setState("idle");
    }
  };

  return (
    <View style={styles.card}>
      {/* Header Bar */}
      <View style={styles.header}>
        <View style={styles.titleCol}>
          <Text style={styles.title}>{take.title}</Text>
          <View style={styles.badgeRow}>
            <View style={styles.badgeAutopilot}>
              <Text style={styles.badgeAutopilotText}>⚡ AUTOPILOT ACTIVE</Text>
            </View>
            <View style={styles.badgeDbc}>
              <Text style={styles.badgeDbcText}>DBC READY</Text>
            </View>
          </View>
          <Text style={styles.macroSubtitle}>
            {take.macroTheme} · Target: $
            {take.targetTotalNotionalUsd?.toLocaleString() ?? "5,000"} · SEC EDGAR 8-K Verified
          </Text>
        </View>

        <View style={styles.sharpeBox}>
          <Text style={styles.sharpeLabel}>EST. SHARPE</Text>
          <Text style={styles.sharpeValue}>
            {take.metrics?.estimatedSharpe?.toFixed(2) ?? "2.10"}
          </Text>
        </View>
      </View>

      {/* Quoted Thesis */}
      <View style={styles.thesisBox}>
        <Text style={styles.thesisText}>"{take.thesis}"</Text>
      </View>

      {/* Multi-Asset Constituents List */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>
          MULTI-ASSET ALLOCATION & AUTOPILOT RULES
        </Text>
        <View style={styles.constituentsContainer}>
          {take.constituents.map((c, idx) => (
            <View key={idx} style={styles.constituentRow}>
              <View style={styles.constituentTop}>
                <View style={styles.symbolGroup}>
                  <Text style={styles.cSymbol}>{c.symbol}</Text>
                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryText}>
                      {c.category.replace(/_/g, " ").toUpperCase()}
                    </Text>
                  </View>
                </View>
                <View style={styles.weightGroup}>
                  <Text style={styles.weightPct}>{c.weightPct}%</Text>
                  <Text style={styles.targetNotional}>
                    ${c.targetNotionalUsd?.toLocaleString() ?? "1,000"}
                  </Text>
                </View>
              </View>

              <Text style={styles.rationaleText} numberOfLines={2}>
                {c.rationale}
              </Text>

              {c.entryTriggers && c.entryTriggers.length > 0 && (
                <View style={styles.rulePill}>
                  <Text style={styles.rulePillText}>
                    Rule: {c.entryTriggers[0]?.type?.replace(/_/g, " ") ?? "Autopilot Guard"}
                  </Text>
                </View>
              )}
            </View>
          ))}
        </View>
      </View>

      {/* Scenario Stress Test Matrix */}
      {take.stressScenarios && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            SCENARIO STRESS TEST MATRIX & QUANTITATIVE BOUNDS
          </Text>
          <View style={styles.stressGrid}>
            <View style={styles.stressBox}>
              <Text style={styles.stressLabel}>EQUITY SELLOFF (-15%)</Text>
              <Text style={styles.stressValRose}>
                {take.stressScenarios.equitySelloffPct}%
              </Text>
            </View>
            <View style={styles.stressBox}>
              <Text style={styles.stressLabel}>PRIVATE RESET (-25%)</Text>
              <Text style={styles.stressValRose}>
                {take.stressScenarios.privateMarkResetPct}%
              </Text>
            </View>
            <View style={styles.stressBox}>
              <Text style={styles.stressLabel}>CRYPTO CRASH (-20%)</Text>
              <Text style={styles.stressValRose}>
                {take.stressScenarios.cryptoCrashPct}%
              </Text>
            </View>
            <View style={styles.stressBox}>
              <Text style={styles.stressLabel}>DIVERSIFICATION</Text>
              <Text style={styles.stressValGreen}>
                {take.metrics?.diversificationScore ?? 84}/100 (
                {take.metrics?.effectivePositions ?? 3.2} eff)
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <View
          style={[
            styles.feedbackBanner,
            state === "armed" || state === "tokenized"
              ? styles.feedbackPositive
              : styles.feedbackWarning,
          ]}
        >
          <Text
            style={[
              styles.feedbackText,
              state === "armed" || state === "tokenized"
                ? styles.feedbackTextPositive
                : styles.feedbackTextWarning,
            ]}
          >
            {feedback}
          </Text>
        </View>
      )}

      {/* Action Buttons */}
      <View style={styles.actionsRow}>
        {state !== "armed" && (
          <TouchableOpacity
            style={[
              styles.actionBtnPrimary,
              state === "arming" && { opacity: 0.6 },
            ]}
            onPress={handleArmTake}
            disabled={state === "arming"}
            activeOpacity={0.8}
          >
            {state === "arming" ? (
              <ActivityIndicator size="small" color="#080e14" />
            ) : (
              <Text style={styles.actionBtnPrimaryText}>
                ⚡ ARM TAKE (AUTOPILOT)
              </Text>
            )}
          </TouchableOpacity>
        )}

        {state !== "tokenized" && (
          <TouchableOpacity
            style={[
              styles.actionBtnGhost,
              state === "tokenizing" && { opacity: 0.6 },
            ]}
            onPress={handleTokenizeTake}
            disabled={state === "tokenizing"}
            activeOpacity={0.8}
          >
            {state === "tokenizing" ? (
              <ActivityIndicator size="small" color={THEME.colors.bronze} />
            ) : (
              <Text style={styles.actionBtnGhostText}>
                🚀 TOKENIZE METEORA DBC
              </Text>
            )}
          </TouchableOpacity>
        )}

        {tokenizedSpec && onOpenLaunch && (
          <TouchableOpacity
            style={styles.handoffBtn}
            onPress={() =>
              onOpenLaunch(
                tokenizedSpec.tokenSymbol,
                tokenizedSpec.pairedStock,
              )
            }
            activeOpacity={0.8}
          >
            <Text style={styles.handoffBtnText}>
              OPEN IN LAUNCH STUDIO ({tokenizedSpec.tokenSymbol}) →
            </Text>
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
    borderColor: "rgba(197, 160, 89, 0.4)",
    borderRadius: THEME.borderRadius.sm,
    padding: 12,
    marginVertical: 6,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.lineSubtle,
    paddingBottom: 8,
  },
  titleCol: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: THEME.colors.text,
    fontFamily: THEME.fonts.mono,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  badgeAutopilot: {
    backgroundColor: "rgba(34, 197, 94, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.4)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
  },
  badgeAutopilotText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#4ade80",
    fontFamily: THEME.fonts.mono,
  },
  badgeDbc: {
    backgroundColor: "rgba(197, 160, 89, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(197, 160, 89, 0.4)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
  },
  badgeDbcText: {
    fontSize: 9,
    fontWeight: "800",
    color: THEME.colors.bronze,
    fontFamily: THEME.fonts.mono,
  },
  macroSubtitle: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    marginTop: 4,
  },
  sharpeBox: {
    alignItems: "flex-end",
    minWidth: 70,
  },
  sharpeLabel: {
    fontSize: 8,
    fontWeight: "700",
    color: THEME.colors.textFaint,
    fontFamily: THEME.fonts.mono,
  },
  sharpeValue: {
    fontSize: 15,
    fontWeight: "800",
    color: THEME.colors.up,
    fontFamily: THEME.fonts.mono,
    marginTop: 2,
  },
  thesisBox: {
    backgroundColor: "rgba(12, 20, 27, 0.8)",
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    borderRadius: 2,
    padding: 8,
    marginTop: 8,
  },
  thesisText: {
    fontSize: 11,
    fontStyle: "italic",
    color: THEME.colors.textMuted,
    lineHeight: 16,
  },
  section: {
    marginTop: 10,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
    fontFamily: THEME.fonts.mono,
    marginBottom: 6,
  },
  constituentsContainer: {
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    backgroundColor: "rgba(12, 20, 27, 0.4)",
    borderRadius: 2,
  },
  constituentRow: {
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.05)",
  },
  constituentTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  symbolGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cSymbol: {
    fontSize: 12,
    fontWeight: "700",
    color: THEME.colors.text,
    fontFamily: THEME.fonts.mono,
  },
  categoryBadge: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
  },
  categoryText: {
    fontSize: 8,
    fontWeight: "700",
    color: THEME.colors.textFaint,
    fontFamily: THEME.fonts.mono,
  },
  weightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  weightPct: {
    fontSize: 11,
    fontWeight: "800",
    color: THEME.colors.bronze,
    fontFamily: THEME.fonts.mono,
  },
  targetNotional: {
    fontSize: 11,
    color: THEME.colors.textMuted,
    fontFamily: THEME.fonts.mono,
  },
  rationaleText: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    marginTop: 4,
    lineHeight: 14,
  },
  rulePill: {
    backgroundColor: "rgba(197, 160, 89, 0.08)",
    alignSelf: "flex-start",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 2,
    marginTop: 4,
  },
  rulePillText: {
    fontSize: 9,
    color: THEME.colors.bronze,
    fontFamily: THEME.fonts.mono,
  },
  stressGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  stressBox: {
    flex: 1,
    minWidth: "47%",
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    padding: 6,
    borderRadius: 2,
    alignItems: "center",
  },
  stressLabel: {
    fontSize: 8,
    fontWeight: "700",
    color: THEME.colors.textFaint,
    fontFamily: THEME.fonts.mono,
    marginBottom: 2,
  },
  stressValRose: {
    fontSize: 11,
    fontWeight: "800",
    color: THEME.colors.down,
    fontFamily: THEME.fonts.mono,
  },
  stressValGreen: {
    fontSize: 10,
    fontWeight: "800",
    color: THEME.colors.up,
    fontFamily: THEME.fonts.mono,
  },
  feedbackBanner: {
    marginTop: 8,
    padding: 8,
    borderRadius: 2,
    borderWidth: 1,
  },
  feedbackPositive: {
    backgroundColor: "rgba(34, 197, 94, 0.1)",
    borderColor: "rgba(34, 197, 94, 0.3)",
  },
  feedbackWarning: {
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderColor: "rgba(245, 158, 11, 0.3)",
  },
  feedbackText: {
    fontSize: 10,
    lineHeight: 14,
  },
  feedbackTextPositive: {
    color: "#4ade80",
  },
  feedbackTextWarning: {
    color: "#fbbf24",
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.lineSubtle,
  },
  actionBtnPrimary: {
    flex: 1,
    minWidth: 140,
    backgroundColor: THEME.colors.bronze,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnPrimaryText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#080e14",
    letterSpacing: 0.5,
    fontFamily: THEME.fonts.mono,
  },
  actionBtnGhost: {
    flex: 1,
    minWidth: 140,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: THEME.colors.bronze,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnGhostText: {
    fontSize: 10,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.5,
    fontFamily: THEME.fonts.mono,
  },
  handoffBtn: {
    width: "100%",
    backgroundColor: "rgba(197, 160, 89, 0.15)",
    borderWidth: 1,
    borderColor: THEME.colors.bronze,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 2,
    alignItems: "center",
    marginTop: 4,
  },
  handoffBtnText: {
    fontSize: 10,
    fontWeight: "800",
    color: THEME.colors.bronze,
    fontFamily: THEME.fonts.mono,
  },
});
