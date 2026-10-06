import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { THEME } from "../constants/theme";

interface TerminalHeaderProps {
  title?: string;
  subtitle?: string;
  onRefresh?: () => void;
}

export const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  title = "SISERA AI",
  subtitle = "SOLANA MAINNET • PYTH HERMES",
  onRefresh,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { paddingTop: Math.max(insets.top, 16) + THEME.spacing.xs },
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.brandRow}>
          <View style={styles.terminalDot} />
          <Text style={styles.brandTitle}>{title}</Text>
          <View style={styles.badgeLive}>
            <Text style={styles.badgeLiveText}>ONLINE</Text>
          </View>
        </View>

        {onRefresh && (
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={onRefresh}
            activeOpacity={0.7}
          >
            <Text style={styles.refreshText}>SYNC</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <Text style={styles.utcTime}>
          {new Date().toISOString().slice(11, 19)} UTC
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: THEME.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.line,
    paddingHorizontal: THEME.spacing.lg,
    paddingTop: THEME.spacing.sm,
    paddingBottom: THEME.spacing.md,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  terminalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: THEME.colors.bronze,
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: THEME.colors.text,
  },
  badgeLive: {
    backgroundColor: "rgba(79, 209, 139, 0.15)",
    borderColor: THEME.colors.up,
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeLiveText: {
    fontSize: 9,
    fontWeight: "800",
    color: THEME.colors.up,
    letterSpacing: 0.8,
  },
  refreshButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
    backgroundColor: THEME.colors.panel,
    borderRadius: 2,
  },
  refreshText: {
    fontSize: 10,
    fontWeight: "700",
    color: THEME.colors.bronze,
    letterSpacing: 1,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
  },
  subtitle: {
    fontSize: 11,
    color: THEME.colors.textFaint,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  utcTime: {
    fontSize: 11,
    color: THEME.colors.textMuted,
    fontFamily: THEME.fonts.mono,
  },
});
