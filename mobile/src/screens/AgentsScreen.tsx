import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { AgentCard } from "../components/AgentCard";
import { TerminalHeader } from "../components/TerminalHeader";
import { THEME } from "../constants/theme";
import { apiService } from "../services/api";
import type { AgentManifest, AutonomyLevel } from "../types";

export const AgentsScreen: React.FC = () => {
  const [agents, setAgents] = useState<AgentManifest[]>([]);
  const [filterAutonomy, setFilterAutonomy] = useState<"ALL" | AutonomyLevel>("ALL");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadAgents();
  }, []);

  const loadAgents = async () => {
    try {
      const list = await apiService.getAgents();
      setAgents(list);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadAgents();
  };

  const handleTogglePause = async (agent: AgentManifest) => {
    await apiService.toggleAgentPause(agent.id);
    loadAgents();
  };

  const handleTripKillSwitch = async (agent: AgentManifest) => {
    await apiService.tripKillSwitch(agent.id);
    loadAgents();
  };

  const handleDeployTemplate = () => {
    // Declarative manifest template from AGENTS.md §3
    const template: AgentManifest = {
      id: `custom-btc-alpha-${Date.now().toString(36)}`,
      name: "BTC Momentum Alpha v2",
      description: "Multi-timeframe trend following with dynamic funding rate filter (AGENTS.md)",
      autonomyLevel: "POLICY_AUTO",
      lifecycleStage: "PAPER",
      maxCapitalUsd: 100000,
      currentAllocatedUsd: 25000,
      maxTradeNotionalUsd: 25000,
      maxDailyDrawdownPct: 3.5,
      currentDailyDrawdownPct: 0.2,
      openPositionsCount: 1,
      maxOpenPositions: 2,
      sharpeRatio: 2.15,
      universe: ["binance:BTC/USDT", "hyperliquid:BTC-USD"],
      lastDecision: {
        action: "HOLD",
        reason: "EMA 12/26 cross active; funding rate percentile nominal at 42%",
        timestamp: "just now",
      },
      circuitBreakerTripped: false,
    };
    setAgents((prev) => [template, ...prev]);
  };

  const filteredAgents = agents.filter((a) => {
    if (filterAutonomy === "ALL") return true;
    return a.autonomyLevel === filterAutonomy;
  });

  return (
    <View style={styles.container}>
      <TerminalHeader
        title="AUTONOMOUS AGENTS"
        subtitle="AGENTS.md • 7-STAGE PROMOTION • PRE-TRADE RISK"
        onRefresh={loadAgents}
      />

      {/* Institutional Invariant Notice */}
      <View style={styles.governanceNotice}>
        <Text style={styles.noticeHeading}>INSTITUTIONAL GOVERNANCE (ADR-008)</Text>
        <Text style={styles.noticeBody}>
          Agents never execute directly against venues. Structured orders submit to
          deterministic pre-trade risk engine within hard capital & drawdown limits.
        </Text>
      </View>

      {/* Autonomy Level Filters */}
      <View style={styles.filtersBar}>
        {(
          [
            "ALL",
            "POLICY_AUTO",
            "AUTONOMOUS",
            "CONFIRM",
            "EMERGENCY_RISK_ONLY",
          ] as const
        ).map((lvl) => {
          const isActive = filterAutonomy === lvl;
          return (
            <TouchableOpacity
              key={lvl}
              style={[styles.filterPill, isActive && styles.filterPillActive]}
              onPress={() => setFilterAutonomy(lvl)}
            >
              <Text
                style={[
                  styles.filterText,
                  isActive && styles.filterTextActive,
                ]}
              >
                {lvl === "EMERGENCY_RISK_ONLY" ? "RISK ONLY" : lvl}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Agent Fleet List */}
      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={THEME.colors.bronze} />
          <Text style={styles.loadingText}>Loading autonomous agent registry...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredAgents}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>NO REGISTERED AGENTS FOUND</Text>
              <Text style={styles.emptyDesc}>
                No autonomous trading agents are currently active on your account ledger.
                Under institutional governance, agents execute in deterministically sandboxed
                environments through the 7-stage promotion pipeline.
              </Text>

              <TouchableOpacity
                style={styles.deployTemplateBtn}
                onPress={handleDeployTemplate}
                activeOpacity={0.8}
              >
                <Text style={styles.deployTemplateText}>
                  + DEPLOY BTC ALPHA TEMPLATE (AGENTS.MD)
                </Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => (
            <AgentCard
              agent={item}
              onTogglePause={handleTogglePause}
              onTripKillSwitch={handleTripKillSwitch}
            />
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  governanceNotice: {
    backgroundColor: THEME.colors.panelRaised,
    borderLeftWidth: 3,
    borderLeftColor: THEME.colors.bronze,
    padding: 10,
    marginHorizontal: THEME.spacing.md,
    marginTop: THEME.spacing.sm,
    borderRadius: 2,
  },
  noticeHeading: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
  },
  noticeBody: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    lineHeight: 14,
    marginTop: 2,
  },
  filtersBar: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.lineSubtle,
  },
  filterPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
  },
  filterPillActive: {
    borderColor: THEME.colors.bronze,
    backgroundColor: THEME.colors.panel,
  },
  filterText: {
    fontSize: 9,
    fontWeight: "700",
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
  },
  filterTextActive: {
    color: THEME.colors.bronze,
  },
  list: {
    padding: THEME.spacing.md,
  },
  loadingContainer: {
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
  emptyCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 20,
    alignItems: "center",
    marginTop: 12,
  },
  emptyTitle: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 1,
  },
  emptyDesc: {
    fontSize: 11,
    color: THEME.colors.textMuted,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  deployTemplateBtn: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.bronze,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 2,
  },
  deployTemplateText: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
  },
});
