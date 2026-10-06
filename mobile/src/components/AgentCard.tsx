import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { THEME } from "../constants/theme";
import type { AgentManifest } from "../types";

interface AgentCardProps {
  agent: AgentManifest;
  onTogglePause?: (agent: AgentManifest) => void;
  onTripKillSwitch?: (agent: AgentManifest) => void;
}

export const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  onTogglePause,
  onTripKillSwitch,
}) => {
  const isPaused = agent.lifecycleStage === "PAUSED";
  const capitalPct = Math.min(
    100,
    (agent.currentAllocatedUsd / agent.maxCapitalUsd) * 100
  );

  const autonomyColor =
    THEME.colors.autonomy[agent.autonomyLevel] || THEME.colors.bronze;

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.nameBlock}>
          <Text style={styles.name}>{agent.name}</Text>
          <Text style={styles.description} numberOfLines={2}>
            {agent.description}
          </Text>
        </View>

        <View style={[styles.autonomyBadge, { borderColor: autonomyColor }]}>
          <Text style={[styles.autonomyText, { color: autonomyColor }]}>
            {agent.autonomyLevel}
          </Text>
        </View>
      </View>

      {/* Stage & Sharpe */}
      <View style={styles.metricRow}>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>LIFECYCLE STAGE</Text>
          <View style={styles.stageTag}>
            <Text style={styles.stageText}>{agent.lifecycleStage}</Text>
          </View>
        </View>

        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>SHARPE RATIO</Text>
          <Text style={styles.sharpeValue}>{agent.sharpeRatio.toFixed(2)}</Text>
        </View>

        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>MAX DRAWDOWN</Text>
          <Text
            style={[
              styles.metricValue,
              {
                color:
                  agent.currentDailyDrawdownPct >
                  agent.maxDailyDrawdownPct * 0.75
                    ? THEME.colors.down
                    : THEME.colors.textMuted,
              },
            ]}
          >
            {agent.currentDailyDrawdownPct.toFixed(1)}% /{" "}
            {agent.maxDailyDrawdownPct.toFixed(1)}%
          </Text>
        </View>
      </View>

      {/* Capital Allocation Bar */}
      <View style={styles.capitalSection}>
        <View style={styles.capitalLabels}>
          <Text style={styles.capitalLabelText}>CAPITAL ALLOCATED</Text>
          <Text style={styles.capitalValues}>
            ${(agent.currentAllocatedUsd / 1_000).toFixed(1)}k / $
            {(agent.maxCapitalUsd / 1_000).toFixed(1)}k ({capitalPct.toFixed(0)}%)
          </Text>
        </View>

        <View style={styles.progressBarTrack}>
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${capitalPct}%`,
                backgroundColor:
                  agent.circuitBreakerTripped
                    ? THEME.colors.down
                    : THEME.colors.verdigris,
              },
            ]}
          />
        </View>
      </View>

      {/* Decision Audit Trail */}
      {agent.lastDecision && (
        <View style={styles.decisionBox}>
          <Text style={styles.decisionAction}>
            DECISION ({agent.lastDecision.timestamp}):{" "}
            <Text style={{ color: THEME.colors.bronze }}>
              {agent.lastDecision.action}
            </Text>
          </Text>
          <Text style={styles.decisionReason} numberOfLines={1}>
            {agent.lastDecision.reason}
          </Text>
        </View>
      )}

      {/* Action Controls: Pause / Kill Switch */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[
            styles.pauseButton,
            isPaused && { borderColor: THEME.colors.up },
          ]}
          onPress={() => onTogglePause?.(agent)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.pauseButtonText,
              isPaused && { color: THEME.colors.up },
            ]}
          >
            {isPaused ? "RESUME" : "PAUSE"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.killButton}
          onPress={() => onTripKillSwitch?.(agent)}
          activeOpacity={0.7}
        >
          <Text style={styles.killButtonText}>KILL SWITCH</Text>
        </TouchableOpacity>
      </View>
    </View>
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
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  nameBlock: {
    flex: 1,
    paddingRight: 8,
  },
  name: {
    fontSize: 15,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  description: {
    fontSize: 11,
    color: THEME.colors.textMuted,
    marginTop: 2,
    lineHeight: 15,
  },
  autonomyBadge: {
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: THEME.colors.surfaceRaised,
  },
  autonomyText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: THEME.colors.surface,
    padding: 8,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    marginVertical: 8,
  },
  metricItem: {
    flexDirection: "column",
  },
  metricLabel: {
    fontSize: 8,
    fontWeight: "700",
    color: THEME.colors.textFaint,
    letterSpacing: 0.5,
  },
  stageTag: {
    marginTop: 2,
  },
  stageText: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.bronze,
    fontWeight: "700",
  },
  sharpeValue: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.up,
    fontWeight: "700",
    marginTop: 2,
  },
  metricValue: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    marginTop: 2,
  },
  capitalSection: {
    marginBottom: 10,
  },
  capitalLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  capitalLabelText: {
    fontSize: 9,
    fontWeight: "700",
    color: THEME.colors.textFaint,
    letterSpacing: 0.5,
  },
  capitalValues: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textMuted,
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: THEME.colors.line,
    borderRadius: 2,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 2,
  },
  decisionBox: {
    backgroundColor: THEME.colors.surfaceRaised,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 2,
    marginBottom: 10,
    borderLeftWidth: 2,
    borderLeftColor: THEME.colors.bronze,
  },
  decisionAction: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textMuted,
    fontWeight: "600",
  },
  decisionReason: {
    fontSize: 10,
    color: THEME.colors.textFaint,
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.lineSubtle,
    paddingTop: 8,
  },
  pauseButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
    backgroundColor: THEME.colors.panelRaised,
    borderRadius: 2,
  },
  pauseButtonText: {
    fontSize: 10,
    fontWeight: "700",
    color: THEME.colors.textMuted,
    letterSpacing: 0.8,
  },
  killButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: THEME.colors.down,
    backgroundColor: "rgba(240, 116, 116, 0.1)",
    borderRadius: 2,
  },
  killButtonText: {
    fontSize: 10,
    fontWeight: "800",
    color: THEME.colors.down,
    letterSpacing: 0.8,
  },
});
