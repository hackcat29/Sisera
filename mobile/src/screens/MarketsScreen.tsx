import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { MarketCard } from "../components/MarketCard";
import { TerminalHeader } from "../components/TerminalHeader";
import { TradeModal } from "../components/TradeModal";
import { THEME } from "../constants/theme";
import { apiService } from "../services/api";
import type { Asset, AssetKind } from "../types";

export const MarketsScreen: React.FC = () => {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filterKind, setFilterKind] = useState<"ALL" | AssetKind>("ALL");
  const [sortBy, setSortBy] = useState<"DIVERGENCE" | "VOLUME" | "CHANGE">("DIVERGENCE");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAssetForTrade, setSelectedAssetForTrade] = useState<Asset | null>(null);

  useEffect(() => {
    loadAssets();
  }, []);

  const loadAssets = async () => {
    try {
      const list = await apiService.getAssets();
      setAssets(list);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadAssets();
  };

  const filteredAssets = assets
    .filter((a) => {
      if (filterKind !== "ALL" && a.kind !== filterKind) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
        );
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "DIVERGENCE") {
        const divA = Math.abs(a.premiumDiscountPct ?? 0);
        const divB = Math.abs(b.premiumDiscountPct ?? 0);
        return divB - divA;
      }
      if (sortBy === "VOLUME") {
        return b.volume24hUsd - a.volume24hUsd;
      }
      if (sortBy === "CHANGE") {
        return Math.abs(b.change24hPct) - Math.abs(a.change24hPct);
      }
      return 0;
    });

  return (
    <View style={styles.container}>
      <TerminalHeader
        title="SISERA MARKETS"
        subtitle="TOKENIZED STOCKS • PRE-IPO PRESTOCKS • PYTH CORE"
        onRefresh={loadAssets}
      />

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        {(["ALL", "public_equity", "pre_ipo"] as const).map((kind) => {
          const label =
            kind === "ALL"
              ? "ALL MARKETS"
              : kind === "public_equity"
              ? "xSTOCKS"
              : "PRESTOCKS";
          const isActive = filterKind === kind;
          return (
            <TouchableOpacity
              key={kind}
              style={[styles.kindTab, isActive && styles.kindTabActive]}
              onPress={() => setFilterKind(kind)}
            >
              <Text style={[styles.kindTabText, isActive && styles.kindTabTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Search and Sort Bar */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Filter ticker (e.g. NVDA, OPENAI, TSLA)..."
          placeholderTextColor={THEME.colors.textFaint}
          value={search}
          onChangeText={setSearch}
        />
        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>SORT:</Text>
          {(["DIVERGENCE", "VOLUME", "CHANGE"] as const).map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => setSortBy(s)}
              style={[styles.sortBtn, sortBy === s && styles.sortBtnActive]}
            >
              <Text style={[styles.sortBtnText, sortBy === s && styles.sortBtnTextActive]}>
                {s === "DIVERGENCE" ? "GAP" : s === "VOLUME" ? "VOL" : "Δ 24H"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Markets List */}
      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={THEME.colors.bronze} />
          <Text style={styles.loadingText}>Fetching live telemetry from Sisera...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredAssets}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>NO ASSETS FOUND</Text>
              <Text style={styles.emptySubtitle}>
                No live markets matching the filter criteria were found.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <MarketCard
              asset={item}
              onTrade={(a) => setSelectedAssetForTrade(a)}
              onSelect={(a) => setSelectedAssetForTrade(a)}
            />
          )}
        />
      )}

      {/* Order Ticket Modal */}
      <TradeModal
        asset={selectedAssetForTrade}
        visible={!!selectedAssetForTrade}
        onClose={() => setSelectedAssetForTrade(null)}
        onSuccess={loadAssets}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  filterRow: {
    flexDirection: "row",
    backgroundColor: THEME.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.line,
  },
  kindTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  kindTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: THEME.colors.bronze,
  },
  kindTabText: {
    fontSize: 10,
    fontWeight: "700",
    color: THEME.colors.textFaint,
    letterSpacing: 0.8,
  },
  kindTabTextActive: {
    color: THEME.colors.bronze,
  },
  searchBar: {
    backgroundColor: THEME.colors.surfaceRaised,
    paddingHorizontal: THEME.spacing.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.lineSubtle,
    gap: 6,
  },
  searchInput: {
    backgroundColor: THEME.colors.panel,
    borderWidth: 1,
    borderColor: THEME.colors.lineStrong,
    borderRadius: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: THEME.colors.text,
    fontSize: 12,
  },
  sortRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sortLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: THEME.colors.textFaint,
    letterSpacing: 0.5,
  },
  sortBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: THEME.colors.lineSubtle,
    backgroundColor: THEME.colors.panel,
  },
  sortBtnActive: {
    borderColor: THEME.colors.bronze,
    backgroundColor: THEME.colors.panelRaised,
  },
  sortBtnText: {
    fontSize: 9,
    fontFamily: THEME.fonts.mono,
    color: THEME.colors.textMuted,
    fontWeight: "700",
  },
  sortBtnTextActive: {
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
  emptyContainer: {
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 13,
    fontFamily: THEME.fonts.mono,
    fontWeight: "800",
    color: THEME.colors.bronze,
    letterSpacing: 1,
  },
  emptySubtitle: {
    fontSize: 11,
    color: THEME.colors.textFaint,
    marginTop: 4,
    textAlign: "center",
  },
});
