import React, { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { TerminalHeader } from "../components/TerminalHeader";
import { THEME } from "../constants/theme";

export const LaunchScreen: React.FC = () => {
  const [name, setName] = useState("Alpha Trend Sentinel");
  const [symbol, setSymbol] = useState("ATS");
  const [pairedStock, setPairedStock] = useState<"NVDAx" | "AAPLx" | "TSLAx" | "SOL">("NVDAx");
  const [curvePreset, setCurvePreset] = useState<"ANCHORED" | "OPEN" | "TREASURY">("ANCHORED");
  const [initialSol, setInitialSol] = useState("2.5");
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const handleSimulateAndLaunch = async () => {
    setLoading(true);
    setTxHash(null);
    setTimeout(() => {
      setLoading(false);
      setTxHash(`5YQh...${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
    }, 1800);
  };

  return (
    <View style={styles.container}>
      <TerminalHeader
        title="LAUNCH STUDIO"
        subtitle="METEORA DBC • STOCK-PAIRED AGENTS • PUMP.FUN"
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Banner */}
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>STOCK-ANCHORED LAUNCH WORKFLOW</Text>
          <Text style={styles.bannerDesc}>
            Deploy your autonomous trading agent as a tradable SPL token paired directly with a tokenized stock.
            Features decaying anti-snipe fees and graduation into Meteora DAMM v2.
          </Text>
        </View>

        {/* Form Fields */}
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>AGENT TOKEN NAME</Text>
          <TextInput
            style={styles.textInput}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Nvidia Momentum Agent"
            placeholderTextColor={THEME.colors.textFaint}
          />

          <Text style={styles.fieldLabel}>TICKER SYMBOL</Text>
          <TextInput
            style={styles.textInput}
            value={symbol}
            onChangeText={setSymbol}
            placeholder="e.g. NVDA-AI"
            placeholderTextColor={THEME.colors.textFaint}
            autoCapitalize="characters"
          />

          <Text style={styles.fieldLabel}>STOCK PAIRING ANCHOR</Text>
          <View style={styles.pairRow}>
            {(["NVDAx", "AAPLx", "TSLAx", "SOL"] as const).map((pair) => (
              <TouchableOpacity
                key={pair}
                style={[styles.pairBtn, pairedStock === pair && styles.pairBtnActive]}
                onPress={() => setPairedStock(pair)}
              >
                <Text style={[styles.pairText, pairedStock === pair && styles.pairTextActive]}>
                  {pair}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>METEORA BONDING CURVE PRESET</Text>
          <View style={styles.presetCol}>
            {[
              {
                id: "ANCHORED",
                title: "Reference-Anchored",
                desc: "Narrow curve with decaying dynamic anti-snipe fee. Tracks stock price.",
              },
              {
                id: "OPEN",
                title: "Open Discovery",
                desc: "Wide bonding curve for early stage agent market liquidity discovery.",
              },
              {
                id: "TREASURY",
                title: "Agent Treasury (10% Lock)",
                desc: "Locks 10% supply into agent treasury vesting over 180 days post-graduation.",
              },
            ].map((p) => {
              const active = curvePreset === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.presetCard, active && styles.presetCardActive]}
                  onPress={() => setCurvePreset(p.id as any)}
                >
                  <Text style={[styles.presetTitle, active && { color: THEME.colors.bronze }]}>
                    {p.title}
                  </Text>
                  <Text style={styles.presetText}>{p.desc}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.fieldLabel}>CREATOR INITIAL DEPOSIT (SOL)</Text>
          <TextInput
            style={styles.textInput}
            value={initialSol}
            onChangeText={setInitialSol}
            keyboardType="numeric"
          />
        </View>

        {/* Simulation Feedback */}
        {txHash && (
          <View style={styles.successCard}>
            <Text style={styles.successTitle}>✓ LAUNCH SIMULATED & CONFIRMED</Text>
            <Text style={styles.successDetail}>
              Created Meteora DBC pair for {symbol}/{pairedStock}.
            </Text>
            <Text style={styles.txHashText}>Signature: {txHash}</Text>
          </View>
        )}

        {/* Launch CTA */}
        <TouchableOpacity
          style={styles.launchBtn}
          onPress={handleSimulateAndLaunch}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={THEME.colors.background} />
          ) : (
            <Text style={styles.launchBtnText}>
              SIMULATE & DEPLOY AGENT TOKEN
            </Text>
          )}
        </TouchableOpacity>
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
  banner: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderLeftWidth: 3,
    borderLeftColor: THEME.colors.bronze,
    padding: 12,
    borderRadius: 2,
  },
  bannerTitle: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 0.8,
  },
  bannerDesc: {
    fontSize: 10,
    color: THEME.colors.textMuted,
    lineHeight: 14,
    marginTop: 4,
  },
  card: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.line,
    borderRadius: 2,
    padding: 14,
    gap: 8,
  },
  fieldLabel: {
    fontSize: 8,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.textFaint,
    letterSpacing: 0.8,
    marginTop: 6,
  },
  textInput: {
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
  pairRow: {
    flexDirection: "row",
    gap: 6,
  },
  pairBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    borderRadius: 2,
    alignItems: "center",
  },
  pairBtnActive: {
    borderColor: THEME.colors.bronze,
    backgroundColor: THEME.colors.panelRaised,
  },
  pairText: {
    fontSize: 10,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textMuted,
    fontWeight: "700",
  },
  pairTextActive: {
    color: THEME.colors.bronze,
  },
  presetCol: {
    gap: 6,
  },
  presetCard: {
    backgroundColor: THEME.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    borderRadius: 2,
    padding: 8,
  },
  presetCardActive: {
    borderColor: THEME.colors.bronze,
    backgroundColor: THEME.colors.panelRaised,
  },
  presetTitle: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  presetText: {
    fontSize: 9,
    color: THEME.colors.textFaint,
    marginTop: 2,
  },
  successCard: {
    backgroundColor: "rgba(79, 209, 139, 0.15)",
    borderWidth: 1,
    borderColor: THEME.colors.up,
    borderRadius: 2,
    padding: 12,
  },
  successTitle: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.up,
  },
  successDetail: {
    fontSize: 10,
    color: THEME.colors.text,
    marginTop: 2,
  },
  txHashText: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.up,
    marginTop: 4,
  },
  launchBtn: {
    backgroundColor: THEME.colors.bronze,
    paddingVertical: 14,
    borderRadius: 2,
    alignItems: "center",
  },
  launchBtnText: {
    fontSize: 12,
    fontFamily: THEME.fonts.mono,
    fontWeight: "900",
    color: THEME.colors.background,
    letterSpacing: 1.2,
  },
});
