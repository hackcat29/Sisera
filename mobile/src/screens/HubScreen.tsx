import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { EventRow } from "../components/EventRow";
import { TerminalHeader } from "../components/TerminalHeader";
import { THEME } from "../constants/theme";
import { apiService } from "../services/api";
import type { AuditLogEntry, MarketEvent, SocialPost } from "../types";
import { LaunchScreen } from "./LaunchScreen";
import { PredictionsScreen } from "./PredictionsScreen";
import { SettingsScreen } from "./SettingsScreen";

export const HubScreen: React.FC = () => {
  const [activeSubView, setActiveSubView] = useState<
    "MENU" | "PREDICTIONS" | "LAUNCH" | "MACRO" | "SOCIAL" | "BRIDGE" | "AUDIT" | "LEADERBOARD" | "CONFIG"
  >("MENU");

  const [macroEvents, setMacroEvents] = useState<MarketEvent[]>([]);
  const [leaderboard, setLeaderboard] = useState<Array<{ name: string; pnlUsd: number; returnPct: number }>>([]);
  const [bridgeAmount, setBridgeAmount] = useState("1000");
  const [bridgeSuccess, setBridgeSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadHubData();
  }, []);

  const loadHubData = async () => {
    const [macro, leaders] = await Promise.all([
      apiService.getMacroEvents(),
      apiService.getLeaderboard(),
    ]);
    setMacroEvents(macro);
    setLeaderboard(leaders);
  };

  const socialPosts: SocialPost[] = [
    {
      id: "soc-1",
      platform: "X",
      author: "@solaboratory",
      content: "OpenAI secondary market clearing at $157B implies significant margin expansion over last cap table round. Tokenized equity liquidity on Solana reaching ATH.",
      timestamp: "12m ago",
      sentiment: "BULLISH",
      symbol: "OPENAI",
    },
    {
      id: "soc-2",
      platform: "TELEGRAM",
      author: "Sisera Intelligence Alpha",
      content: "NVIDIA Form 8-K contract confirms multi-GW datacenter rack commitments. Blackwell deliveries pacing ahead of Street expectations.",
      timestamp: "45m ago",
      sentiment: "BULLISH",
      symbol: "NVDAx",
    },
    {
      id: "soc-3",
      platform: "DISCORD",
      author: "QuantOps",
      content: "Circuit breaker evaluation passed for BTC Alpha v2. Max implementation shortfall at 0.8bps, well below 3x limit.",
      timestamp: "1h ago",
      sentiment: "NEUTRAL",
    },
  ];

  const auditLogs: AuditLogEntry[] = [
    {
      id: "aud-01",
      eventType: "TRADE_EXECUTION",
      title: "Filled BUY 450 NVDAx via Phoenix",
      detail: "Filled at $124.85 USD • Jupiter Smart Order Routing • 1.2bps slippage",
      timestamp: "14m ago",
      status: "CONFIRMED",
      txHash: "5YQh...A83B",
    },
    {
      id: "aud-02",
      eventType: "POLICY_TRIGGER",
      title: "Evaluated OpenAI Accumulation Policy",
      detail: "Trigger passed: premium (4.67%) within limit • Risk engine clearance approved",
      timestamp: "32m ago",
      status: "EVALUATED",
    },
    {
      id: "aud-03",
      eventType: "AGENT_PROMOTION",
      title: "Agent 'BTC Momentum Alpha v2' Promoted to PAPER",
      detail: "Completed backtest (Sharpe 2.14 > 1.8 cap) & stress tests (max DD 0.8% < 10%)",
      timestamp: "2h ago",
      status: "CONFIRMED",
    },
    {
      id: "aud-04",
      eventType: "MANDATE_CHECK",
      title: "Pre-Trade Mandate Rebalance Check",
      detail: "Single asset concentration at 22.6% (below 25.0% mandate ceiling)",
      timestamp: "3h ago",
      status: "CONFIRMED",
    },
  ];

  if (activeSubView === "PREDICTIONS") {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backBar} onPress={() => setActiveSubView("MENU")}>
          <Text style={styles.backText}>‹ BACK TO TERMINAL HUB</Text>
        </TouchableOpacity>
        <PredictionsScreen />
      </View>
    );
  }

  if (activeSubView === "LAUNCH") {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backBar} onPress={() => setActiveSubView("MENU")}>
          <Text style={styles.backText}>‹ BACK TO TERMINAL HUB</Text>
        </TouchableOpacity>
        <LaunchScreen />
      </View>
    );
  }

  if (activeSubView === "CONFIG") {
    return (
      <View style={styles.container}>
        <TouchableOpacity style={styles.backBar} onPress={() => setActiveSubView("MENU")}>
          <Text style={styles.backText}>‹ BACK TO TERMINAL HUB</Text>
        </TouchableOpacity>
        <SettingsScreen />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TerminalHeader
        title="TERMINAL HUB"
        subtitle="MACRO • PREDICTIONS • BRIDGE • SOCIAL • AUDIT"
        onRefresh={loadHubData}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {activeSubView === "MENU" && (
          <>
            {/* Quick Hub Grid */}
            <View style={styles.grid}>
              {[
                { id: "PREDICTIONS", title: "PREDICTION MARKETS", desc: "Jupiter & Panta probability books" },
                { id: "LAUNCH", title: "LAUNCH STUDIO", desc: "Meteora DBC & Pump.fun stock pairs" },
                { id: "MACRO", title: "MACRO REGIME", desc: "Fed rates, Treasury yields, PCE stream" },
                { id: "SOCIAL", title: "SOCIAL INTELLIGENCE", desc: "Real-time X, Telegram, Discord feeds" },
                { id: "BRIDGE", title: "USDC BRIDGE", desc: "HyperEVM ⇄ Solana cross-chain bridge" },
                { id: "AUDIT", title: "AUDIT & ALERTS", desc: "Append-only execution & promotion ledger" },
                { id: "LEADERBOARD", title: "LEADERBOARD", desc: "Top autonomous agents ranked by return" },
                { id: "CONFIG", title: "RPC & TELEMETRY", desc: "Endpoints, Solana cluster, and auth" },
              ].map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.gridCard}
                  onPress={() => setActiveSubView(item.id as any)}
                >
                  <Text style={styles.gridTitle}>◆ {item.title}</Text>
                  <Text style={styles.gridDesc}>{item.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Subview: MACRO REGIME */}
        {activeSubView === "MACRO" && (
          <View style={styles.subSection}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setActiveSubView("MENU")}>
              <Text style={styles.backBtnText}>‹ HUB MENU</Text>
            </TouchableOpacity>

            <View style={styles.macroGauges}>
              <View style={styles.gaugeBox}>
                <Text style={styles.gaugeLab}>FED FUNDS RATE</Text>
                <Text style={styles.gaugeNum}>4.50%</Text>
              </View>
              <View style={styles.gaugeBox}>
                <Text style={styles.gaugeLab}>2Y/10Y SPREAD</Text>
                <Text style={[styles.gaugeNum, { color: THEME.colors.up }]}>+18 bps</Text>
              </View>
              <View style={styles.gaugeBox}>
                <Text style={styles.gaugeLab}>CORE PCE YOY</Text>
                <Text style={styles.gaugeNum}>2.60%</Text>
              </View>
              <View style={styles.gaugeBox}>
                <Text style={styles.gaugeLab}>MACRO REGIME</Text>
                <Text style={[styles.gaugeNum, { color: THEME.colors.bronze }]}>EXPANSION</Text>
              </View>
            </View>

            <Text style={styles.sectionHeading}>CLASSIFIED MACRO EVENTS</Text>
            {macroEvents.map((evt) => (
              <EventRow key={evt.id} event={evt} />
            ))}
          </View>
        )}

        {/* Subview: SOCIAL INTELLIGENCE */}
        {activeSubView === "SOCIAL" && (
          <View style={styles.subSection}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setActiveSubView("MENU")}>
              <Text style={styles.backBtnText}>‹ HUB MENU</Text>
            </TouchableOpacity>

            <Text style={styles.sectionHeading}>REAL-TIME SOCIAL INTELLIGENCE</Text>
            {socialPosts.map((post) => (
              <View key={post.id} style={styles.socialCard}>
                <View style={styles.socialHeader}>
                  <View style={styles.platformBadge}>
                    <Text style={styles.platformText}>{post.platform}</Text>
                  </View>
                  <Text style={styles.socialAuthor}>{post.author}</Text>
                  <Text style={styles.socialTime}>{post.timestamp}</Text>
                </View>
                <Text style={styles.socialContent}>{post.content}</Text>
                {post.symbol && (
                  <Text style={styles.socialTag}>TAG: {post.symbol}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Subview: USDC BRIDGE */}
        {activeSubView === "BRIDGE" && (
          <View style={styles.subSection}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setActiveSubView("MENU")}>
              <Text style={styles.backBtnText}>‹ HUB MENU</Text>
            </TouchableOpacity>

            <View style={styles.bridgeCard}>
              <Text style={styles.bridgeTitle}>HYPEREVM ⇄ SOLANA USDC BRIDGE</Text>
              <Text style={styles.bridgeDesc}>
                Native Circle CCTP & Relay cross-chain bridge. Reconciles into unified portfolio.
              </Text>

              <Text style={styles.fieldLabel}>BRIDGE AMOUNT (USDC)</Text>
              <TextInput
                style={styles.bridgeInput}
                value={bridgeAmount}
                onChangeText={setBridgeAmount}
                keyboardType="numeric"
              />

              <View style={styles.bridgeRouteBox}>
                <Text style={styles.routeText}>SOURCE: Solana Mainnet</Text>
                <Text style={styles.routeText}>DESTINATION: HyperEVM Core</Text>
                <Text style={styles.routeText}>ESTIMATED TIME: ~35 seconds</Text>
                <Text style={styles.routeText}>FEE: $0.15 USDC</Text>
              </View>

              {bridgeSuccess && (
                <View style={styles.successPill}>
                  <Text style={styles.successPillText}>✓ {bridgeSuccess}</Text>
                </View>
              )}

              <TouchableOpacity
                style={styles.bridgeSubmitBtn}
                onPress={() => {
                  setBridgeSuccess(`Bridged $${bridgeAmount} USDC to HyperEVM.`);
                  setTimeout(() => setBridgeSuccess(null), 2000);
                }}
              >
                <Text style={styles.bridgeSubmitText}>CONFIRM CROSS-CHAIN BRIDGE</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Subview: AUDIT & ALERTS */}
        {activeSubView === "AUDIT" && (
          <View style={styles.subSection}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setActiveSubView("MENU")}>
              <Text style={styles.backBtnText}>‹ HUB MENU</Text>
            </TouchableOpacity>

            <Text style={styles.sectionHeading}>APPEND-ONLY AUDIT & RISK LEDGER</Text>
            {auditLogs.map((log) => (
              <View key={log.id} style={styles.auditCard}>
                <View style={styles.auditHeader}>
                  <View style={styles.auditBadge}>
                    <Text style={styles.auditBadgeText}>{log.eventType}</Text>
                  </View>
                  <Text style={styles.auditStatus}>{log.status}</Text>
                  <Text style={styles.auditTime}>{log.timestamp}</Text>
                </View>
                <Text style={styles.auditTitle}>{log.title}</Text>
                <Text style={styles.auditDetail}>{log.detail}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Subview: LEADERBOARD */}
        {activeSubView === "LEADERBOARD" && (
          <View style={styles.subSection}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setActiveSubView("MENU")}>
              <Text style={styles.backBtnText}>‹ HUB MENU</Text>
            </TouchableOpacity>

            <Text style={styles.sectionHeading}>AUTONOMOUS AGENTS LEADERBOARD</Text>
            {leaderboard.map((item, idx) => (
              <View key={idx} style={styles.leaderRow}>
                <Text style={styles.leaderRank}>#{idx + 1}</Text>
                <View style={{ flex: 1, paddingHorizontal: 8 }}>
                  <Text style={styles.leaderName}>{item.name}</Text>
                </View>
                <Text style={styles.leaderReturn}>+{item.returnPct.toFixed(1)}%</Text>
                <Text style={styles.leaderPnl}>+${(item.pnlUsd / 1000).toFixed(1)}k</Text>
              </View>
            ))}
          </View>
        )}
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
  grid: {
    gap: 8,
  },
  gridCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 12,
  },
  gridTitle: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
  },
  gridDesc: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    marginTop: 3,
  },
  backBar: {
    backgroundColor: THEME.colors.surfaceRaised,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.line,
  },
  backText: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
  },
  subSection: {
    gap: 10,
  },
  backBtn: {
    alignSelf: "flex-start",
    backgroundColor: THEME.colors.panelRaised,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    marginBottom: 6,
  },
  backBtnText: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.bronze,
  },
  sectionHeading: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
  },
  macroGauges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 6,
  },
  gaugeBox: {
    width: "48%",
    backgroundColor: THEME.colors.panel,
    padding: 10,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: THEME.colors.line,
  },
  gaugeLab: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    fontWeight: "700",
  },
  gaugeNum: {
    fontSize: 14,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.text,
    marginTop: 2,
  },
  socialCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 12,
  },
  socialHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  platformBadge: {
    backgroundColor: THEME.colors.surfaceRaised,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
  },
  platformText: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
  },
  socialAuthor: {
    fontSize: 10,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  socialTime: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    marginLeft: "auto",
  },
  socialContent: {
    fontSize: 11,
    color: THEME.colors.textMuted,
    lineHeight: 16,
  },
  socialTag: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.verdigris,
    marginTop: 6,
    fontWeight: "700",
  },
  bridgeCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 14,
    gap: 8,
  },
  bridgeTitle: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
  },
  bridgeDesc: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    lineHeight: 14,
  },
  fieldLabel: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.textFaint,
    marginTop: 6,
  },
  bridgeInput: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.text,
    fontWeight: "700",
  },
  bridgeRouteBox: {
    backgroundColor: THEME.colors.surfaceRaised,
    padding: 10,
    borderRadius: 2,
    gap: 4,
    marginVertical: 4,
  },
  routeText: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textMuted,
  },
  successPill: {
    backgroundColor: "rgba(79, 209, 139, 0.15)",
    borderColor: THEME.colors.up,
    borderWidth: 1,
    padding: 8,
    borderRadius: 2,
  },
  successPillText: {
    fontSize: 11,
    color: THEME.colors.up,
    fontWeight: "700",
  },
  bridgeSubmitBtn: {
    backgroundColor: THEME.colors.bronze,
    paddingVertical: 12,
    borderRadius: 2,
    alignItems: "center",
  },
  bridgeSubmitText: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "900",
    color: THEME.colors.background,
    letterSpacing: 1,
  },
  auditCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 10,
  },
  auditHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  auditBadge: {
    backgroundColor: THEME.colors.surfaceRaised,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
  },
  auditBadgeText: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
  },
  auditStatus: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.up,
  },
  auditTime: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    marginLeft: "auto",
  },
  auditTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  auditDetail: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    marginTop: 2,
  },
  leaderRow: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  leaderRank: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    width: 28,
  },
  leaderName: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  leaderReturn: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.up,
    marginRight: 10,
  },
  leaderPnl: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.textMuted,
  },
});
