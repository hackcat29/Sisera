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
  const [activeTab, setActiveTab] = useState<"FLEET" | "VAULTS">("FLEET");
  const [vaults, setVaults] = useState<any[]>([]);
  const [pendingProposal, setPendingProposal] = useState<{
    id: string;
    agentName: string;
    action: string;
    symbol: string;
    sizeUsd: number;
    reason: string;
  } | null>({
    id: "prop-sample-01",
    agentName: "OpenAI Discount Arb",
    action: "BUY",
    symbol: "OpenAI PreStocks",
    sizeUsd: 2500,
    reason: "Mark discount widened to -7.4% with 0 high-severity negative events.",
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [panicLoading, setPanicLoading] = useState(false);

  useEffect(() => {
    loadAgents();
    loadVaults();
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

  const loadVaults = async () => {
    try {
      const list = await apiService.getVaultLeaderboard();
      if (list && list.length > 0) {
        setVaults(list);
      } else {
        setVaults([
          {
            agentId: "btc_momentum_alpha_v2",
            name: "BTC Momentum Alpha v2",
            creator: "sisera-quant",
            stage: "LIVE",
            sharpeRatio: 2.34,
            maxDrawdownPct: 4.8,
            totalAumUsd: 284500,
            pnl30dPct: 18.4,
          },
          {
            agentId: "nvda_breakout_v1",
            name: "NVDAx Momentum Surge",
            creator: "apex-capital",
            stage: "LIMITED_LIVE",
            sharpeRatio: 2.15,
            maxDrawdownPct: 6.2,
            totalAumUsd: 142000,
            pnl30dPct: 14.1,
          },
          {
            agentId: "openai_discount_arb",
            name: "OpenAI Mark Arbitrageur",
            creator: "premarket-labs",
            stage: "PAPER",
            sharpeRatio: 1.95,
            maxDrawdownPct: 5.1,
            totalAumUsd: 98000,
            pnl30dPct: 9.8,
          },
        ]);
      }
    } catch {
      // fallback
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadAgents();
    loadVaults();
  };

  const handleTogglePause = async (agent: AgentManifest) => {
    await apiService.toggleAgentPause(agent.id);
    loadAgents();
  };

  const handleTripKillSwitch = async (agent: AgentManifest) => {
    await apiService.tripKillSwitch(agent.id);
    loadAgents();
  };

  const handleGlobalPanic = async () => {
    setPanicLoading(true);
    try {
      await apiService.emergencyHaltAll("Global emergency panic triggered by mobile operator");
      setPendingProposal(null);
      await loadAgents();
    } finally {
      setPanicLoading(false);
    }
  };

  const handleApproveProposal = async () => {
    if (!pendingProposal) return;
    await apiService.approveAgentOrder(pendingProposal.id);
    setPendingProposal(null);
    loadAgents();
  };

  const handleRejectProposal = async () => {
    if (!pendingProposal) return;
    await apiService.rejectAgentOrder(pendingProposal.id);
    setPendingProposal(null);
  };

  const handleDeployTemplate = () => {
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
        onRefresh={handleRefresh}
      />

      {/* Global Fleet Panic Bar */}
      <View style={styles.panicBar}>
        <TouchableOpacity
          style={[styles.panicBtn, panicLoading && { opacity: 0.6 }]}
          onPress={handleGlobalPanic}
          disabled={panicLoading}
          activeOpacity={0.8}
        >
          <Text style={styles.panicBtnText}>
            {panicLoading ? "HALTING FLEET..." : "⚠ GLOBAL PANIC: HALT FLEET & CANCEL ORDERS"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Autonomy Level 2: CONFIRM Action Card */}
      {pendingProposal && (
        <View style={styles.proposalCard}>
          <View style={styles.proposalHeader}>
            <Text style={styles.proposalTag}>LEVEL 2: CONFIRM REQUIRED</Text>
            <Text style={styles.proposalAgent}>{pendingProposal.agentName}</Text>
          </View>
          <Text style={styles.proposalAction}>
            {pendingProposal.action} ${pendingProposal.sizeUsd.toLocaleString()} of{" "}
            {pendingProposal.symbol}
          </Text>
          <Text style={styles.proposalReason}>{pendingProposal.reason}</Text>
          <View style={styles.proposalButtons}>
            <TouchableOpacity
              style={styles.approveBtn}
              onPress={handleApproveProposal}
              activeOpacity={0.8}
            >
              <Text style={styles.approveBtnText}>✓ ONE-TAP APPROVE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.rejectBtn}
              onPress={handleRejectProposal}
              activeOpacity={0.8}
            >
              <Text style={styles.rejectBtnText}>✕ REJECT</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Mode Navigation: Fleet vs Copy Vaults */}
      <View style={styles.tabsRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "FLEET" && styles.tabBtnActive]}
          onPress={() => setActiveTab("FLEET")}
        >
          <Text style={[styles.tabBtnText, activeTab === "FLEET" && styles.tabBtnTextActive]}>
            FLEET REGISTRY ({filteredAgents.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "VAULTS" && styles.tabBtnActive]}
          onPress={() => setActiveTab("VAULTS")}
        >
          <Text style={[styles.tabBtnText, activeTab === "VAULTS" && styles.tabBtnTextActive]}>
            COPY VAULTS LEADERBOARD ({vaults.length})
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === "FLEET" ? (
        <>
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
        </>
      ) : (
        /* Copy Vaults Leaderboard */
        <FlatList
          data={vaults}
          keyExtractor={(item) => item.agentId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.vaultCard}>
              <View style={styles.vaultTop}>
                <View>
                  <Text style={styles.vaultName}>{item.name}</Text>
                  <Text style={styles.vaultCreator}>by @{item.creator}</Text>
                </View>
                <View style={styles.vaultBadge}>
                  <Text style={styles.vaultBadgeText}>{item.stage}</Text>
                </View>
              </View>

              <View style={styles.vaultGrid}>
                <View style={styles.vaultCell}>
                  <Text style={styles.vaultCellLabel}>SHARPE RATIO</Text>
                  <Text style={styles.vaultCellValEmerald}>{item.sharpeRatio.toFixed(2)}</Text>
                </View>
                <View style={styles.vaultCell}>
                  <Text style={styles.vaultCellLabel}>30D PNL</Text>
                  <Text style={styles.vaultCellVal}>+{item.pnl30dPct}%</Text>
                </View>
                <View style={styles.vaultCell}>
                  <Text style={styles.vaultCellLabel}>TOTAL AUM</Text>
                  <Text style={styles.vaultCellVal}>${item.totalAumUsd.toLocaleString()}</Text>
                </View>
                <View style={styles.vaultCell}>
                  <Text style={styles.vaultCellLabel}>MAX DD</Text>
                  <Text style={styles.vaultCellValRose}>-{item.maxDrawdownPct}%</Text>
                </View>
              </View>

              <View style={styles.vaultFooter}>
                <Text style={styles.vaultFeeNotice}>
                  20% Perf Fee • 30% Auto-Buyback to Meteora DBC
                </Text>
                <TouchableOpacity style={styles.copyBtn} activeOpacity={0.8}>
                  <Text style={styles.copyBtnText}>COPY DEPOSIT →</Text>
                </TouchableOpacity>
              </View>
            </View>
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
  panicBar: {
    paddingHorizontal: THEME.spacing.md,
    paddingTop: THEME.spacing.sm,
  },
  panicBtn: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.5)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 2,
    alignItems: "center",
  },
  panicBtnText: {
    color: "#f87171",
    fontFamily: THEME.fonts.mono,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  proposalCard: {
    backgroundColor: THEME.colors.panelRaised,
    borderWidth: 1,
    borderColor: THEME.colors.bronze,
    marginHorizontal: THEME.spacing.md,
    marginTop: THEME.spacing.sm,
    padding: 12,
    borderRadius: 2,
  },
  proposalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  proposalTag: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
  },
  proposalAgent: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textMuted,
  },
  proposalAction: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.text,
    marginTop: 2,
  },
  proposalReason: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    marginTop: 4,
    lineHeight: 14,
  },
  proposalButtons: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  approveBtn: {
    flex: 2,
    backgroundColor: "rgba(16, 185, 129, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.5)",
    paddingVertical: 6,
    borderRadius: 2,
    alignItems: "center",
  },
  approveBtnText: {
    color: "#34d399",
    fontFamily: THEME.fonts.mono,
    fontSize: 10,
    fontWeight: "800",
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    paddingVertical: 6,
    borderRadius: 2,
    alignItems: "center",
  },
  rejectBtnText: {
    color: THEME.colors.textFaint,
    fontFamily: THEME.fonts.mono,
    fontSize: 10,
    fontWeight: "700",
  },
  tabsRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.lineSubtle,
    marginTop: 8,
    paddingHorizontal: THEME.spacing.md,
    gap: 12,
  },
  tabBtn: {
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabBtnActive: {
    borderBottomColor: THEME.colors.bronze,
  },
  tabBtnText: {
    fontSize: 10,
    fontWeight: "700",
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    letterSpacing: 0.5,
  },
  tabBtnTextActive: {
    color: THEME.colors.bronze,
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
  vaultCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 14,
    marginBottom: 12,
  },
  vaultTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  vaultName: {
    fontSize: 13,
    fontWeight: "800",
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.text,
  },
  vaultCreator: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    marginTop: 2,
  },
  vaultBadge: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.bronze,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
  },
  vaultBadgeText: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
  },
  vaultGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    paddingVertical: 8,
    marginBottom: 10,
  },
  vaultCell: {
    width: "50%",
    paddingVertical: 4,
  },
  vaultCellLabel: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    fontWeight: "700",
  },
  vaultCellVal: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.text,
    marginTop: 1,
  },
  vaultCellValEmerald: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: "#34d399",
    marginTop: 1,
  },
  vaultCellValRose: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: "#f87171",
    marginTop: 1,
  },
  vaultFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  vaultFeeNotice: {
    fontSize: 9,
    color: THEME.colors.textFaint,
    flex: 1,
    paddingRight: 8,
  },
  copyBtn: {
    backgroundColor: "rgba(217, 119, 6, 0.15)",
    borderWidth: 1,
    borderColor: THEME.colors.bronze,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 2,
  },
  copyBtnText: {
    color: THEME.colors.bronze,
    fontFamily: THEME.fonts.mono,
    fontSize: 9,
    fontWeight: "800",
  },
});
