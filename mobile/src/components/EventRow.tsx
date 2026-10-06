import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { THEME } from "../constants/theme";
import type { MarketEvent } from "../types";

interface EventRowProps {
  event: MarketEvent;
}

export const EventRow: React.FC<EventRowProps> = ({ event }) => {
  const isBull = event.sentiment === "BULLISH";
  const isBear = event.sentiment === "BEARISH";
  const sentimentColor = isBull
    ? THEME.colors.up
    : isBear
    ? THEME.colors.down
    : THEME.colors.textMuted;

  const isRegulatory = event.tier === "REGULATORY";
  const tierColor = isRegulatory ? THEME.colors.bronze : THEME.colors.verdigris;

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.tierGroup}>
          <View style={[styles.tierBadge, { borderColor: tierColor }]}>
            <Text style={[styles.tierText, { color: tierColor }]}>
              {event.tier}
            </Text>
          </View>
          {event.symbol && (
            <Text style={styles.symbolText}>{event.symbol}</Text>
          )}
        </View>

        <View style={styles.timeGroup}>
          <Text style={[styles.sentimentText, { color: sentimentColor }]}>
            {event.sentiment}
          </Text>
          <Text style={styles.timestamp}>{event.timestamp}</Text>
        </View>
      </View>

      <Text style={styles.headline}>{event.headline}</Text>
      <Text style={styles.summary} numberOfLines={3}>
        {event.summary}
      </Text>

      {event.corroboratedByCount != null && (
        <View style={styles.footerRow}>
          <Text style={styles.corroborationText}>
            ✓ {event.corroboratedByCount} INDEPENDENT SOURCES CONFIRMED
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
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
    alignItems: "center",
    marginBottom: 6,
  },
  tierGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tierBadge: {
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: THEME.colors.surfaceRaised,
  },
  tierText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  symbolText: {
    fontSize: 11,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.text,
  },
  timeGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sentimentText: {
    fontSize: 9,
    fontWeight: "800",
    fontFamily: THEME.fonts.mono,
  },
  timestamp: {
    fontSize: 10,
    color: THEME.colors.textFaint,
    fontFamily: THEME.fonts.mono,
  },
  headline: {
    fontSize: 13,
    fontWeight: "700",
    color: THEME.colors.text,
    lineHeight: 18,
    marginBottom: 4,
  },
  summary: {
    fontSize: 11,
    color: THEME.colors.textMuted,
    lineHeight: 16,
  },
  footerRow: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.lineSubtle,
  },
  corroborationText: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    fontWeight: "700",
    color: THEME.colors.verdigris,
    letterSpacing: 0.5,
  },
});
