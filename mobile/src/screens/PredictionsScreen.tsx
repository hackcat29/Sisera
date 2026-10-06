import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { TerminalHeader } from "../components/TerminalHeader";
import { THEME } from "../constants/theme";
import { apiService } from "../services/api";
import type { PredictionMarket } from "../types";

export const PredictionsScreen: React.FC = () => {
  const [markets, setMarkets] = useState<PredictionMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState("ALL");
  const [selectedMarket, setSelectedMarket] = useState<PredictionMarket | null>(null);
  const [betOutcome, setBetOutcome] = useState<"YES" | "NO">("YES");
  const [betAmount, setBetAmount] = useState("100");
  const [txSuccess, setTxSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadMarkets();
  }, []);

  const loadMarkets = async () => {
    try {
      // Connects to /api/platform/predictions or returns active markets
      const list = await apiService.getPredictionMarkets();
      setMarkets(list);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadMarkets();
  };

  const handlePlaceBet = async () => {
    const amt = parseFloat(betAmount) || 0;
    if (amt <= 0 || !selectedMarket) return;
    setTxSuccess(
      `Order placed: $${amt.toFixed(2)} on ${betOutcome} (${selectedMarket.title.slice(0, 32)}...)`
    );
    setTimeout(() => {
      setTxSuccess(null);
      setSelectedMarket(null);
    }, 1600);
  };

  const filtered = markets.filter((m) => {
    if (category === "ALL") return true;
    return m.category.toUpperCase() === category;
  });

  return (
    <View style={styles.container}>
      <TerminalHeader
        title="PREDICTION MARKETS"
        subtitle="JUPITER PREDICTIONS • PROBABILITY ORDER BOOKS"
        onRefresh={handleRefresh}
      />

      {/* Category Pills */}
      <View style={styles.catRow}>
        {(["ALL", "TECH", "EQUITY", "CRYPTO", "MACRO"] as const).map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[styles.catPill, category === cat && styles.catPillActive]}
            onPress={() => setCategory(cat)}
          >
            <Text style={[styles.catText, category === cat && styles.catTextActive]}>
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && !refreshing ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={THEME.colors.bronze} />
          <Text style={styles.loadingText}>Fetching live prediction orderbooks...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={THEME.colors.bronze}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.catTag}>
                  <Text style={styles.catTagText}>{item.category.toUpperCase()}</Text>
                </View>
                <Text style={styles.closesInText}>Closes: {item.closesAt}</Text>
              </View>

              <Text style={styles.marketTitle}>{item.title}</Text>

              {/* Probability meter */}
              <View style={styles.meterContainer}>
                <View style={styles.probHeader}>
                  <Text style={styles.yesText}>YES {item.yesProbabilityPct.toFixed(0)}%</Text>
                  <Text style={styles.noText}>NO {item.noProbabilityPct.toFixed(0)}%</Text>
                </View>

                <View style={styles.meterTrack}>
                  <View
                    style={[
                      styles.meterFillYes,
                      { width: `${item.yesProbabilityPct}%` },
                    ]}
                  />
                  <View
                    style={[
                      styles.meterFillNo,
                      { width: `${item.noProbabilityPct}%` },
                    ]}
                  />
                </View>
              </View>

              {/* Volume & Trade buttons */}
              <View style={styles.footerRow}>
                <Text style={styles.volText}>
                  VOL: ${(item.volumeUsd / 1000).toFixed(1)}k
                </Text>

                <View style={styles.actionGroup}>
                  <TouchableOpacity
                    style={[styles.btnOutcome, { borderColor: THEME.colors.up }]}
                    onPress={() => {
                      setSelectedMarket(item);
                      setBetOutcome("YES");
                    }}
                  >
                    <Text style={[styles.btnOutcomeText, { color: THEME.colors.up }]}>
                      BUY YES ({item.yesProbabilityPct}¢)
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.btnOutcome, { borderColor: THEME.colors.down }]}
                    onPress={() => {
                      setSelectedMarket(item);
                      setBetOutcome("NO");
                    }}
                  >
                    <Text style={[styles.btnOutcomeText, { color: THEME.colors.down }]}>
                      BUY NO ({item.noProbabilityPct}¢)
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        />
      )}

      {/* Prediction Trade Ticket Modal */}
      <Modal visible={!!selectedMarket} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>PREDICTION TICKET</Text>
              <TouchableOpacity onPress={() => setSelectedMarket(null)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedMarket && (
              <>
                <Text style={styles.modalSubtitle}>{selectedMarket.title}</Text>

                <View style={styles.toggleOutcome}>
                  <TouchableOpacity
                    style={[
                      styles.outcomeBtn,
                      betOutcome === "YES" && { backgroundColor: THEME.colors.up },
                    ]}
                    onPress={() => setBetOutcome("YES")}
                  >
                    <Text
                      style={[
                        styles.outcomeText,
                        betOutcome === "YES" && { color: THEME.colors.background },
                      ]}
                    >
                      YES • {selectedMarket.yesProbabilityPct}%
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.outcomeBtn,
                      betOutcome === "NO" && { backgroundColor: THEME.colors.down },
                    ]}
                    onPress={() => setBetOutcome("NO")}
                  >
                    <Text
                      style={[
                        styles.outcomeText,
                        betOutcome === "NO" && { color: THEME.colors.background },
                      ]}
                    >
                      NO • {selectedMarket.noProbabilityPct}%
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Amount */}
                <Text style={styles.amountLabel}>NOTIONAL USDC</Text>
                <TextInput
                  style={styles.amountInput}
                  keyboardType="numeric"
                  value={betAmount}
                  onChangeText={setBetAmount}
                />

                {/* Return estimation */}
                <View style={styles.payoutBox}>
                  <Text style={styles.payoutLabel}>POTENTIAL PAYOUT</Text>
                  <Text style={styles.payoutValue}>
                    $
                    {(
                      ((parseFloat(betAmount) || 0) /
                        ((betOutcome === "YES"
                          ? selectedMarket.yesProbabilityPct
                          : selectedMarket.noProbabilityPct) /
                          100))
                    ).toFixed(2)}{" "}
                    USDC
                  </Text>
                </View>

                {txSuccess && (
                  <View style={styles.successBox}>
                    <Text style={styles.successText}>✓ {txSuccess}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[
                    styles.confirmBtn,
                    {
                      backgroundColor:
                        betOutcome === "YES" ? THEME.colors.up : THEME.colors.down,
                    },
                  ]}
                  onPress={handlePlaceBet}
                >
                  <Text style={styles.confirmBtnText}>
                    SUBMIT {betOutcome} ORDER
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  catRow: {
    flexDirection: "row",
    backgroundColor: THEME.colors.surface,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.line,
  },
  catPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: THEME.colors.panel,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
  },
  catPillActive: {
    borderColor: THEME.colors.bronze,
    backgroundColor: THEME.colors.panelRaised,
  },
  catText: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.textFaint,
  },
  catTextActive: {
    color: THEME.colors.bronze,
  },
  list: {
    padding: THEME.spacing.md,
  },
  loadingBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 12,
    color: THEME.colors.textMuted,
    fontFamily: THEME.fonts.mono,
  },
  card: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 12,
    marginBottom: 10,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  catTag: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 2,
  },
  catTagText: {
    fontSize: 8,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.5,
  },
  closesInText: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
  },
  marketTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: THEME.colors.text,
    lineHeight: 18,
    marginBottom: 10,
  },
  meterContainer: {
    marginBottom: 10,
  },
  probHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  yesText: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.up,
  },
  noText: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.down,
  },
  meterTrack: {
    height: 6,
    flexDirection: "row",
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: THEME.colors.line,
  },
  meterFillYes: {
    backgroundColor: THEME.colors.up,
    height: "100%",
  },
  meterFillNo: {
    backgroundColor: THEME.colors.down,
    height: "100%",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: THEME.colors.lineSubtle,
    paddingTop: 8,
  },
  volText: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textMuted,
  },
  actionGroup: {
    flexDirection: "row",
    gap: 6,
  },
  btnOutcome: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 2,
    backgroundColor: THEME.colors.panelRaised,
  },
  btnOutcomeText: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(8, 14, 20, 0.85)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: THEME.colors.surface,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.lineStrong,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    padding: 16,
    paddingBottom: 36,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 1,
  },
  closeBtn: {
    fontSize: 16,
    color: THEME.colors.textFaint,
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    fontWeight: "700",
    color: THEME.colors.text,
    lineHeight: 18,
    marginBottom: 12,
  },
  toggleOutcome: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  outcomeBtn: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
    alignItems: "center",
    borderRadius: 2,
  },
  outcomeText: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.text,
  },
  amountLabel: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    fontWeight: "700",
    marginBottom: 4,
  },
  amountInput: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.text,
    borderRadius: 2,
    marginBottom: 12,
  },
  payoutBox: {
    backgroundColor: THEME.colors.surfaceRaised,
    padding: 10,
    borderRadius: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  payoutLabel: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    fontWeight: "700",
  },
  payoutValue: {
    fontSize: 13,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.up,
  },
  successBox: {
    backgroundColor: "rgba(79, 209, 139, 0.15)",
    borderColor: THEME.colors.up,
    borderWidth: 1,
    padding: 8,
    borderRadius: 2,
    marginBottom: 10,
  },
  successText: {
    fontSize: 11,
    color: THEME.colors.up,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
  },
  confirmBtn: {
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 2,
  },
  confirmBtnText: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "900",
    color: THEME.colors.background,
    letterSpacing: 1,
  },
});
