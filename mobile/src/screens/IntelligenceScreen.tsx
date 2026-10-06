import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { BacktestCard } from "../components/BacktestCard";
import { BasisArbitrageCard } from "../components/BasisArbitrageCard";
import { EventRow } from "../components/EventRow";
import { TakeCard } from "../components/TakeCard";
import { TerminalHeader } from "../components/TerminalHeader";
import { THEME } from "../constants/theme";
import { apiService } from "../services/api";
import type { CopilotCard, CopilotMessage, MarketEvent } from "../types";
import { LaunchScreen } from "./LaunchScreen";

const SUGGESTED_QUERIES = [
  "Build me a thematic take on humanoid robotics and automation",
  "Create a thesis basket on the AI compute and power grid squeeze",
  "Scan delta-neutral basis arbitrage & funding harvester",
  "Thematic take: Private AI labs vs public semiconductor giants",
  "Why is OpenAI trading above its mark?",
  "What changed in the last hour?",
  "Which tokenized stocks are furthest from fair value?",
  "Backtest BTC Momentum Alpha strategy",
  "Show me arguments for and against buying Anthropic",
  "Buy $2,000 of OpenAI if premium falls below 3%",
];

export const IntelligenceScreen: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"COPILOT" | "EVENTS">("COPILOT");
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      id: "copilot-welcome",
      role: "assistant",
      content:
        "Connected to Sisera AI Live Terminal. Ask me about multi-asset thematic takes, fair-value dislocations, news impact on your portfolio, or compile structured trading policies.",
      timestamp: "Online",
      provenance: {
        model: "sisera-platform-copilot",
        sources: ["Live Production API", "Pyth Hermes", "SEC EDGAR"],
      },
    },
  ]);
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [launchModal, setLaunchModal] = useState<{
    symbol: string;
    pairedStock: string;
  } | null>(null);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    const list = await apiService.getEvents();
    setEvents(list);
  };

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    setInput("");
    const userMsg: CopilotMessage = {
      id: `usr-${Date.now()}`,
      role: "user",
      content: query,
      timestamp: "Just now",
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const reply = await apiService.askCopilot(query);
      setMessages((prev) => [...prev, reply]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: "Unable to reach intelligence layer. Operating in fail-closed safety state.",
          timestamp: "Just now",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <TerminalHeader
        title="SISERA AI INTELLIGENCE"
        subtitle="COPILOT • SEC EDGAR • CORROBORATED EVENTS"
        onRefresh={loadEvents}
      />

      {/* Mode Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === "COPILOT" && styles.tabItemActive]}
          onPress={() => setActiveTab("COPILOT")}
        >
          <Text
            style={[styles.tabText, activeTab === "COPILOT" && styles.tabTextActive]}
          >
            ASK SISERA AI
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === "EVENTS" && styles.tabItemActive]}
          onPress={() => setActiveTab("EVENTS")}
        >
          <Text
            style={[styles.tabText, activeTab === "EVENTS" && styles.tabTextActive]}
          >
            CLASSIFIED EVENTS ({events.length})
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === "COPILOT" ? (
        <KeyboardAvoidingView
          style={styles.copilotView}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        >
          {/* Quick Prompts Carousel */}
          <View style={styles.promptsContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.promptsScroll}>
              {SUGGESTED_QUERIES.map((q, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.promptPill}
                  onPress={() => handleSend(q)}
                >
                  <Text style={styles.promptPillText}>{q}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Messages Feed */}
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messagesList}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            renderItem={({ item }) => {
              const isUser = item.role === "user";
              return (
                <View
                  style={[
                    styles.messageBubble,
                    isUser ? styles.userBubble : styles.assistantBubble,
                  ]}
                >
                  <View style={styles.messageHeader}>
                    <Text style={styles.roleLabel}>
                      {isUser ? "OPERATOR" : "SISERA AI"}
                    </Text>
                    <Text style={styles.timestamp}>{item.timestamp}</Text>
                  </View>

                  <Text style={styles.messageContent}>{item.content}</Text>

                  {/* Render Structured Intelligence Cards */}
                  {item.cards?.map((card: CopilotCard, cIdx: number) => {
                    if (card.type === "take_card" && card.data) {
                      return (
                        <TakeCard
                          key={cIdx}
                          take={card.data}
                          onArmed={() => loadEvents()}
                          onOpenLaunch={(symbol, pairedStock) =>
                            setLaunchModal({ symbol, pairedStock })
                          }
                        />
                      );
                    }

                    if (card.type === "backtest_result" && card.data) {
                      return (
                        <BacktestCard
                          key={cIdx}
                          data={card.data}
                          onDeploy={() => {
                            setMessages((prev) => [
                              ...prev,
                              {
                                id: `deploy-${Date.now()}`,
                                role: "assistant",
                                content: `🚀 Strategy ${card.data.asset?.symbol ?? "BTC/USDT"} has been promoted to PAPER lifecycle stage under POLICY_AUTO (Level 3). Live order book validation active.`,
                                timestamp: "Just now",
                              },
                            ]);
                          }}
                        />
                      );
                    }

                    if (card.type === "basis_arbitrage" && card.data) {
                      return <BasisArbitrageCard key={cIdx} data={card.data} />;
                    }

                    return (
                      <View key={cIdx} style={styles.intelligenceCard}>
                        {card.title && (
                          <Text style={styles.cardTitle}>◆ {card.title}</Text>
                        )}

                        {card.type === "ranking" && Array.isArray(card.data) && (
                          <View style={styles.cardTable}>
                            {card.data.map((row: any, rIdx: number) => (
                              <View key={rIdx} style={styles.tableRow}>
                                <Text style={styles.tableCellSymbol}>{row.symbol}</Text>
                                <Text style={styles.tableCell}>{row.spot}</Text>
                                <Text style={styles.tableCellSpread}>{row.spread}</Text>
                              </View>
                            ))}
                          </View>
                        )}

                        {card.type === "arguments" && card.data && (
                          <View style={styles.argumentsBox}>
                            <Text style={styles.bullCase}>
                              BULL: {card.data.bull}
                            </Text>
                            <Text style={styles.bearCase}>
                              BEAR: {card.data.bear}
                            </Text>
                          </View>
                        )}

                        {card.type === "impact" && card.data && (
                          <View style={styles.impactBox}>
                            <Text style={styles.impactStatus}>
                              STATUS: {card.data.mandateCleared ? "MANDATE APPROVED" : "FLAGGED"}
                            </Text>
                            <Text style={styles.impactRoute}>
                              ROUTING: {card.data.route}
                            </Text>
                          </View>
                        )}

                        {card.type === "policy_draft" && card.data && (
                          <View style={styles.policyDraftBox}>
                            <Text style={styles.policyHeader}>
                              POLICY: {card.data.policyId}
                            </Text>
                            <Text style={styles.policyCondition}>
                              IF {card.data.condition}
                            </Text>
                            <Text style={styles.policyStatus}>
                              STATUS: {card.data.status}
                            </Text>
                          </View>
                        )}
                      </View>
                    );
                  })}

                  {item.provenance && (
                    <View style={styles.provenanceRow}>
                      <Text style={styles.provenanceText}>
                        PROVENANCE: {item.provenance.model}
                      </Text>
                    </View>
                  )}
                </View>
              );
            }}
          />

          {/* Input Bar */}
          <View style={styles.inputBar}>
            <TextInput
              style={styles.chatInput}
              value={input}
              onChangeText={setInput}
              placeholder="Ask Sisera AI or compile a policy..."
              placeholderTextColor={THEME.colors.textFaint}
              onSubmitEditing={() => handleSend()}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={styles.sendButton}
              onPress={() => handleSend()}
              disabled={loading || !input.trim()}
            >
              {loading ? (
                <ActivityIndicator size="small" color={THEME.colors.background} />
              ) : (
                <Text style={styles.sendText}>SEND</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      ) : (
        /* Events Stream */
        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.eventsList}
          renderItem={({ item }) => <EventRow event={item} />}
        />
      )}

      {/* Launch Studio Modal handoff */}
      <Modal visible={!!launchModal} animationType="slide">
        {launchModal && (
          <LaunchScreen
            initialSymbol={launchModal.symbol}
            initialName={`${launchModal.symbol} Take Token`}
            initialPairedStock={launchModal.pairedStock as any}
            onClose={() => setLaunchModal(null)}
          />
        )}
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: THEME.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.line,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  tabItemActive: {
    borderBottomWidth: 2,
    borderBottomColor: THEME.colors.bronze,
  },
  tabText: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.colors.textFaint,
    letterSpacing: 0.8,
  },
  tabTextActive: {
    color: THEME.colors.bronze,
  },
  copilotView: {
    flex: 1,
  },
  promptsContainer: {
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.lineSubtle,
    backgroundColor: THEME.colors.surfaceRaised,
    paddingVertical: 6,
  },
  promptsScroll: {
    paddingHorizontal: THEME.spacing.md,
    gap: 6,
  },
  promptPill: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  promptPillText: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    fontWeight: "600",
  },
  messagesList: {
    padding: THEME.spacing.md,
    paddingBottom: 20,
  },
  messageBubble: {
    borderRadius: 2,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  userBubble: {
    backgroundColor: THEME.colors.panelRaised,
    borderColor: THEME.colors.lineStrong,
    alignSelf: "flex-end",
    maxWidth: "85%",
  },
  assistantBubble: {
    backgroundColor: THEME.colors.surface,
    borderColor: THEME.colors.line,
    alignSelf: "flex-start",
    maxWidth: "96%",
    width: "96%",
  },
  messageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  roleLabel: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 1,
  },
  timestamp: {
    fontSize: 9,
    color: THEME.colors.textFaint,
    fontFamily: THEME.fonts.mono,
  },
  messageContent: {
    fontSize: 13,
    color: THEME.colors.text,
    lineHeight: 19,
  },
  intelligenceCard: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
    borderRadius: 2,
    padding: 10,
    marginTop: 10,
  },
  cardTitle: {
    fontSize: 10,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  cardTable: {
    gap: 4,
  },
  tableRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.lineSubtle,
  },
  tableCellSymbol: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  tableCell: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textMuted,
  },
  tableCellSpread: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.up,
  },
  argumentsBox: {
    gap: 6,
  },
  bullCase: {
    fontSize: 11,
    color: THEME.colors.up,
    lineHeight: 16,
  },
  bearCase: {
    fontSize: 11,
    color: THEME.colors.down,
    lineHeight: 16,
  },
  impactBox: {
    gap: 4,
  },
  impactStatus: {
    fontSize: 11,
    fontWeight: "700",
    color: THEME.colors.up,
    fontFamily: THEME.fonts.mono,
  },
  impactRoute: {
    fontSize: 10,
    color: THEME.colors.textMuted,
  },
  policyDraftBox: {
    gap: 4,
  },
  policyHeader: {
    fontSize: 10,
    color: THEME.colors.bronze,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
  },
  policyCondition: {
    fontSize: 11,
    color: THEME.colors.text,
    fontFamily: THEME.fonts.mono,
  },
  policyStatus: {
    fontSize: 10,
    color: THEME.colors.verdigris,
    fontWeight: "700",
  },
  provenanceRow: {
    marginTop: 8,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.lineSubtle,
  },
  provenanceText: {
    fontSize: 8,
    color: THEME.colors.textFaint,
    fontFamily: THEME.fonts.mono,
  },
  inputBar: {
    flexDirection: "row",
    backgroundColor: THEME.colors.surface,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.line,
    padding: 8,
    gap: 8,
  },
  chatInput: {
    flex: 1,
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: THEME.colors.text,
    fontSize: 13,
  },
  sendButton: {
    backgroundColor: THEME.colors.bronze,
    paddingHorizontal: 16,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: {
    fontSize: 11,
    fontWeight: "900",
    color: THEME.colors.background,
    letterSpacing: 1,
  },
  eventsList: {
    padding: THEME.spacing.md,
  },
});
