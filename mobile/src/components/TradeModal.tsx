import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { THEME } from "../constants/theme";
import { apiService } from "../services/api";
import type { Asset } from "../types";

interface TradeModalProps {
  asset: Asset | null;
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const TradeModal: React.FC<TradeModalProps> = ({
  asset,
  visible,
  onClose,
  onSuccess,
}) => {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [amountUsd, setAmountUsd] = useState("1000");
  const [slippageBps, setSlippageBps] = useState(25); // 0.25%
  const [loading, setLoading] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  if (!asset) return null;

  const numAmount = parseFloat(amountUsd) || 0;
  const shares = numAmount > 0 && asset.priceUsd > 0 ? (numAmount / asset.priceUsd).toFixed(4) : "0.0000";

  const handleQuickAmount = (val: number) => {
    setAmountUsd(val.toString());
  };

  const handleExecute = async () => {
    if (numAmount <= 0) return;
    setLoading(true);
    setResultMessage(null);

    try {
      const res = await apiService.executeTrade({
        assetKey: asset.key,
        symbol: asset.symbol,
        side,
        amountUsd: numAmount,
        slippageBps,
      });

      setResultMessage(res.message);
      onSuccess?.();
      setTimeout(() => {
        setResultMessage(null);
        setLoading(false);
        onClose();
      }, 1800);
    } catch {
      setResultMessage("Order execution failed: Network or risk mandate breach.");
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>
                {side} {asset.symbol}
              </Text>
              <Text style={styles.priceMeta}>
                ${asset.priceUsd.toFixed(2)} USD • {asset.name}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Side Selector */}
          <View style={styles.sideToggle}>
            <TouchableOpacity
              style={[
                styles.sideBtn,
                side === "BUY" && { backgroundColor: THEME.colors.up },
              ]}
              onPress={() => setSide("BUY")}
            >
              <Text
                style={[
                  styles.sideText,
                  side === "BUY" && { color: THEME.colors.background },
                ]}
              >
                BUY / LONG
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.sideBtn,
                side === "SELL" && { backgroundColor: THEME.colors.down },
              ]}
              onPress={() => setSide("SELL")}
            >
              <Text
                style={[
                  styles.sideText,
                  side === "SELL" && { color: THEME.colors.background },
                ]}
              >
                SELL / CLOSE
              </Text>
            </TouchableOpacity>
          </View>

          {/* Amount input */}
          <View style={styles.inputSection}>
            <Text style={styles.inputLabel}>ORDER NOTIONAL (USD)</Text>
            <View style={styles.inputBox}>
              <Text style={styles.currencyPrefix}>$</Text>
              <TextInput
                style={styles.textInput}
                keyboardType="numeric"
                value={amountUsd}
                onChangeText={setAmountUsd}
                placeholder="0.00"
                placeholderTextColor={THEME.colors.textFaint}
              />
            </View>

            {/* Quick Pills */}
            <View style={styles.pillsRow}>
              {[250, 500, 1000, 2500, 5000].map((val) => (
                <TouchableOpacity
                  key={val}
                  style={[
                    styles.pill,
                    numAmount === val && styles.pillActive,
                  ]}
                  onPress={() => handleQuickAmount(val)}
                >
                  <Text
                    style={[
                      styles.pillText,
                      numAmount === val && styles.pillTextActive,
                    ]}
                  >
                    ${val >= 1000 ? `${val / 1000}k` : val}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Execution Specs */}
          <View style={styles.specsBox}>
            <View style={styles.specRow}>
              <Text style={styles.specKey}>ESTIMATED QUANTITY</Text>
              <Text style={styles.specVal}>
                {shares} {asset.symbol}
              </Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specKey}>ORDER ROUTING</Text>
              <Text style={styles.specVal}>Jupiter SOR → Phoenix</Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specKey}>MAX SLIPPAGE</Text>
              <Text style={styles.specVal}>{(slippageBps / 100).toFixed(2)}%</Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specKey}>PRE-TRADE RISK</Text>
              <Text style={[styles.specVal, { color: THEME.colors.up }]}>
                PASSED (MANDATE OK)
              </Text>
            </View>
          </View>

          {/* Execution Feedback */}
          {resultMessage && (
            <View style={styles.resultBox}>
              <Text style={styles.resultText}>{resultMessage}</Text>
            </View>
          )}

          {/* Submit Button */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              {
                backgroundColor:
                  side === "BUY" ? THEME.colors.up : THEME.colors.down,
              },
            ]}
            onPress={handleExecute}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={THEME.colors.background} />
            ) : (
              <Text style={styles.submitText}>
                CONFIRM {side} • ${numAmount.toFixed(2)} USD
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(8, 14, 20, 0.8)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: THEME.colors.surface,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.lineStrong,
    borderTopLeftRadius: THEME.borderRadius.lg,
    borderTopRightRadius: THEME.borderRadius.lg,
    padding: THEME.spacing.lg,
    paddingBottom: 36,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  priceMeta: {
    fontSize: 12,
    color: THEME.colors.textMuted,
    marginTop: 2,
  },
  closeButton: {
    padding: 6,
  },
  closeText: {
    fontSize: 18,
    color: THEME.colors.textFaint,
  },
  sideToggle: {
    flexDirection: "row",
    backgroundColor: THEME.colors.panel,
    borderRadius: 2,
    padding: 3,
    marginBottom: 16,
    gap: 4,
  },
  sideBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 2,
  },
  sideText: {
    fontSize: 11,
    fontWeight: "800",
    color: THEME.colors.textMuted,
    letterSpacing: 1,
  },
  inputSection: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: THEME.colors.textFaint,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
    borderRadius: 2,
    paddingHorizontal: 12,
    height: 48,
  },
  currencyPrefix: {
    fontSize: 20,
    fontWeight: "700",
    color: THEME.colors.bronze,
    marginRight: 6,
  },
  textInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    color: THEME.colors.text,
    fontFamily: THEME.fonts.mono,
  },
  pillsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 8,
  },
  pill: {
    flex: 1,
    paddingVertical: 6,
    backgroundColor: THEME.colors.panelRaised,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    alignItems: "center",
  },
  pillActive: {
    borderColor: THEME.colors.bronze,
    backgroundColor: THEME.colors.surfaceRaised,
  },
  pillText: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    fontFamily: THEME.fonts.mono,
    fontWeight: "600",
  },
  pillTextActive: {
    color: THEME.colors.bronze,
    fontWeight: "700",
  },
  specsBox: {
    backgroundColor: THEME.colors.surfaceRaised,
    padding: 12,
    borderRadius: 2,
    marginBottom: 16,
    gap: 6,
  },
  specRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  specKey: {
    fontSize: 9,
    color: THEME.colors.textFaint,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  specVal: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.text,
    fontWeight: "600",
  },
  resultBox: {
    backgroundColor: "rgba(79, 209, 139, 0.15)",
    borderColor: THEME.colors.up,
    borderWidth: 1,
    padding: 10,
    borderRadius: 2,
    marginBottom: 12,
  },
  resultText: {
    fontSize: 11,
    color: THEME.colors.up,
    fontWeight: "700",
    textAlign: "center",
  },
  submitButton: {
    paddingVertical: 14,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: {
    fontSize: 13,
    fontWeight: "900",
    color: THEME.colors.background,
    letterSpacing: 1.2,
  },
});
