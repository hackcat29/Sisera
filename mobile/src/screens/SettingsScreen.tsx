import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { TerminalHeader } from "../components/TerminalHeader";
import { THEME } from "../constants/theme";
import { apiService } from "../services/api";

export const SettingsScreen: React.FC = () => {
  const [apiUrl, setApiUrl] = useState(apiService.getBaseUrl());
  const [token, setToken] = useState("");
  const [network, setNetwork] = useState<"MAINNET" | "DEVNET">("MAINNET");
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSave = () => {
    apiService.setBaseUrl(apiUrl);
    apiService.setAuthToken(token.trim() ? token.trim() : null);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  return (
    <View style={styles.container}>
      <TerminalHeader
        title="SETTINGS & TELEMETRY"
        subtitle="RPC CONNECTIONS • API ROUTING • RISK PREFERENCES"
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Network Cluster */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>SOLANA NETWORK CLUSTER</Text>
          <View style={styles.clusterRow}>
            {(["MAINNET", "DEVNET"] as const).map((net) => (
              <TouchableOpacity
                key={net}
                style={[
                  styles.clusterBtn,
                  network === net && styles.clusterBtnActive,
                ]}
                onPress={() => setNetwork(net)}
              >
                <Text
                  style={[
                    styles.clusterBtnText,
                    network === net && styles.clusterBtnTextActive,
                  ]}
                >
                  {net === "MAINNET" ? "SOLANA MAINNET-BETA" : "SOLANA DEVNET"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>
            Feeds anchor to Pyth Hermes equity oracles on Solana Mainnet.
          </Text>
        </View>

        {/* Backend Endpoint */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>SISERA API ENDPOINT</Text>
          <TextInput
            style={styles.input}
            value={apiUrl}
            onChangeText={setApiUrl}
            placeholder="https://sisera.xyz"
            placeholderTextColor={THEME.colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>
            Defaults to production (https://sisera.xyz). For local development,
            specify http://localhost:3000 or your Contabo VPS address.
          </Text>
        </View>

        {/* Operator Session / Auth Token */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>OPERATOR SESSION / AUTH TOKEN</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            placeholder="Bearer access token (optional)..."
            placeholderTextColor={THEME.colors.textFaint}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>
            Required for private portfolio ledger access and armed policy execution.
          </Text>
        </View>

        {/* Save CTA */}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveBtnText}>
            {savedNotice ? "✓ CONFIGURATION APPLIED" : "APPLY TELEMETRY SETTINGS"}
          </Text>
        </TouchableOpacity>

        {/* Architecture & Institutional Specifications */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>ARCHITECTURE SPECIFICATIONS</Text>
          <View style={styles.specRow}>
            <Text style={styles.specKey}>PLATFORM RUNTIME</Text>
            <Text style={styles.specVal}>React Native 0.76 • Expo SDK 52</Text>
          </View>
          <View style={styles.specRow}>
            <Text style={styles.specKey}>SUPPORTED OS</Text>
            <Text style={styles.specVal}>iOS 15+ • Android 8+ (API 26+)</Text>
          </View>
          <View style={styles.specRow}>
            <Text style={styles.specKey}>ORACLE LAYER</Text>
            <Text style={styles.specVal}>Pyth Network Hermes Equity Feeds</Text>
          </View>
          <View style={styles.specRow}>
            <Text style={styles.specKey}>ORDER ROUTING</Text>
            <Text style={styles.specVal}>Jupiter Smart Order Routing (SOR)</Text>
          </View>
          <View style={styles.specRow}>
            <Text style={styles.specKey}>GOVERNANCE MODEL</Text>
            <Text style={styles.specVal}>ADR-008 & ADR-009 Mandate Guardrails</Text>
          </View>
        </View>
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
  card: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 14,
    gap: 8,
  },
  cardTitle: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
  },
  clusterRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  clusterBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    alignItems: "center",
  },
  clusterBtnActive: {
    borderColor: THEME.colors.bronze,
    backgroundColor: THEME.colors.panelRaised,
  },
  clusterBtnText: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textFaint,
    fontWeight: "700",
  },
  clusterBtnTextActive: {
    color: THEME.colors.bronze,
  },
  input: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: THEME.colors.text,
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
  },
  hint: {
    fontSize: 10,
    color: THEME.colors.textFaint,
    lineHeight: 14,
  },
  saveBtn: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.bronze,
    paddingVertical: 12,
    borderRadius: 2,
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 1,
  },
  specRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.lineSubtle,
  },
  specKey: {
    fontSize: 9,
    color: THEME.colors.textFaint,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  specVal: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.text,
  },
});
