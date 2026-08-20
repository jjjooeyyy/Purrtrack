import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { BarChart } from "react-native-gifted-charts";
import Animated, { FadeIn } from "react-native-reanimated";
import { HomeScreenSkeleton } from "../components/ui/skeleton";
import { SCREEN_TOP_CONTENT_PADDING } from "../constants/theme";
import { db } from "../firebase";
import { usePetSession } from "../hooks/usePetSession";
import { getTotalKcal } from "../lib/mealKcal";
import { LogTab, TabParamList } from "../navigator/MainTabNavigator";
import { DailyLog } from "../types";

type Nav = BottomTabNavigationProp<TabParamList>;

function formatDate(d: Date) {
  return d.toISOString().split("T")[0];
}

function getLastNDates(n: number): string[] {
  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(formatDate(d));
  }
  return dates;
}

function computeStreak(logDates: Set<string>): number {
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (logDates.has(formatDate(d))) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

type ChartTab = "feed" | "water";

const PetSwitcherItem = memo(function PetSwitcherItem({
  name,
  photoURL,
  isActive,
  disabled,
  onPress,
}: {
  name: string;
  photoURL: string | null;
  isActive: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.petChip, isActive && styles.petChipActive]}
      onPress={onPress}
      disabled={disabled}
    >
      {photoURL ? (
        <Image source={{ uri: photoURL }} style={styles.petChipAvatar} />
      ) : (
        <View style={[styles.petChipAvatar, styles.petChipAvatarPlaceholder]}>
          <Text style={styles.petChipAvatarEmoji}>🐾</Text>
        </View>
      )}
      <View style={styles.petChipTextWrap}>
        <Text
          style={[styles.petChipName, isActive && styles.petChipNameActive]}
          numberOfLines={1}
        >
          {name}
        </Text>
        <Text
          style={[styles.petChipMeta, isActive && styles.petChipMetaActive]}
        >
          {isActive ? "目前檔案" : "切換查看"}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { activePet, pets, changeActivePet } = usePetSession();
  const activePetId = activePet?.id ?? null;
  const [todayLog, setTodayLog] = useState<DailyLog | null>(null);
  const [weekFeedData, setWeekFeedData] = useState<
    { value: number; label: string }[]
  >([]);
  const [weekWaterData, setWeekWaterData] = useState<
    { value: number; label: string }[]
  >([]);
  const [chartTab, setChartTab] = useState<ChartTab>("feed");
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [switchingPetId, setSwitchingPetId] = useState<string | null>(null);
  const loadedPetIdRef = useRef<string | null>(null);

  const loadData = useCallback(async () => {
    if (!activePetId) {
      setTodayLog(null);
      setWeekFeedData([]);
      setWeekWaterData([]);
      setStreak(0);
      loadedPetIdRef.current = null;
      return;
    }

    const today = formatDate(new Date());
    const last30 = getLastNDates(30);

    const logByDate = new Map<string, DailyLog | null>(
      last30.map((date) => [date, null]),
    );

    const logsSnap = await getDocs(
      query(
        collection(db, "pets", activePetId, "logs"),
        where("date", ">=", last30[0]),
        where("date", "<=", last30[last30.length - 1]),
        orderBy("date", "asc"),
      ),
    );
    logsSnap.forEach((snap) => {
      const data = snap.data() as DailyLog;
      const date = data.date ?? snap.id;
      if (logByDate.has(date)) {
        logByDate.set(date, data);
      }
    });
    setTodayLog(logByDate.get(today) ?? null);

    const chartEntries = last30.slice(-7).map((date) => {
      const data = logByDate.get(date) ?? null;
      return {
        label: date.slice(5).replace("-", "/"),
        feed: getTotalKcal(data?.meals ?? []),
        water: data?.totalWater ?? 0,
      };
    });
    setWeekFeedData(
      chartEntries.map(({ label, feed }) => ({ label, value: feed })),
    );
    setWeekWaterData(
      chartEntries.map(({ label, water }) => ({ label, value: water })),
    );

    const logDateSet = new Set(
      [...logByDate.entries()]
        .filter(([, data]) => data !== null)
        .map(([date]) => date),
    );
    setStreak(computeStreak(logDateSet));
    loadedPetIdRef.current = activePetId;
  }, [activePetId]);

  useFocusEffect(
    useCallback(() => {
      const shouldShowFullScreenLoader = loadedPetIdRef.current !== activePetId;
      if (shouldShowFullScreenLoader) {
        setLoading(true);
      }
      loadData().finally(() => setLoading(false));
    }, [activePetId, loadData]),
  );

  // Reload immediately when active pet changes (e.g. switched from MeScreen)
  useEffect(() => {
    if (activePetId && loadedPetIdRef.current !== activePetId) {
      setLoading(true);
      loadData().finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePetId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleSelectPet = useCallback(
    async (petId: string) => {
      if (petId === activePet?.id) {
        return;
      }

      setSwitchingPetId(petId);
      try {
        await changeActivePet(petId);
      } finally {
        setSwitchingPetId(null);
      }
    },
    [activePet?.id, changeActivePet],
  );

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "早晨" : hour < 18 ? "午安" : "晚安";
  const openQuickLogTab = useCallback(
    (tab: LogTab) => {
      navigation.navigate("Log", {
        screen: "LogMain",
        params: { initialTab: tab },
      });
    },
    [navigation],
  );

  const openFoodManagement = useCallback(() => {
    navigation.navigate("Log", {
      screen: "FoodManagement",
    });
  }, [navigation]);

  if (loading) {
    return <HomeScreenSkeleton />;
  }

  return (
    <Animated.View entering={FadeIn.duration(300)} style={{ flex: 1 }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#7FA655"
          />
        }
      >
        <View style={styles.homeHero}>
          <View style={styles.heroGlowPrimary} />
          <View style={styles.heroGlowSecondary} />
          <View style={styles.homeHeroContent}>
            <View style={styles.homeHeroTopRow}>
              <View style={styles.homeHeroTextWrap}>
                <Text style={styles.homeHeroKicker}>{greeting}</Text>
                <Text style={styles.homeHeroTitle}>
                  {activePet?.name ?? "寵物"} 今日狀況一覽
                </Text>
                <Text style={styles.homeHeroSubtitle}>
                  今日摘要、快速新增同重要提醒，都整理好喺同一頁。
                </Text>
              </View>
              <View style={styles.streakBadge}>
                <Text style={styles.streakIcon}>🔥</Text>
                <Text style={styles.streakText}>已連續記錄 {streak} 日</Text>
              </View>
            </View>

            <View style={styles.cardsRow}>
              <SummaryCard
                icon="🍽️"
                label="攝取熱量"
                value={
                  todayLog ? `${getTotalKcal(todayLog.meals ?? [])} kcal` : "—"
                }
                color="rgba(255,253,246,0.14)"
                variant="hero"
              />
              <SummaryCard
                icon="💧"
                label="飲水量"
                value={todayLog ? `${todayLog.totalWater}ml` : "—"}
                color="rgba(255,253,246,0.14)"
                variant="hero"
              />
              <SummaryCard
                icon="🪣"
                label="去廁所次數"
                value={todayLog ? `${todayLog.litterVisits}次` : "—"}
                color="rgba(255,253,246,0.14)"
                variant="hero"
              />
            </View>
          </View>
        </View>

        {pets.length > 1 ? (
          <View style={styles.petSwitcherSection}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.petSwitcherList}
            >
              {pets.map((item) => (
                <PetSwitcherItem
                  key={item.id}
                  name={item.name}
                  photoURL={item.photoURL}
                  isActive={item.id === activePet?.id}
                  disabled={switchingPetId !== null}
                  onPress={() => {
                    void handleSelectPet(item.id);
                  }}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}

        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.weightHeroCard}
          onPress={() =>
            navigation.navigate("Log", { screen: "WeightTracker" })
          }
        >
          <View>
            <Text style={styles.weightHeroLabel}>目前體重</Text>
            <Text style={styles.weightHeroValue}>
              {activePet?.weight ? `${activePet.weight} kg` : "尚未記錄"}
            </Text>
            <Text style={styles.weightHeroHint}>
              記錄新體重，睇下主子肥咗定瘦咗！
            </Text>
          </View>
          <Text style={styles.weightHeroAction}>查看趨勢</Text>
        </TouchableOpacity>

        {/* Quick Add */}
        <View style={styles.quickPanel}>
          <View style={styles.quickPanelHeader}>
            <View>
              <Text style={styles.sectionTitle}>快速新增</Text>
              <Text style={styles.quickPanelHint}>
                一按就可以記錄，或直接管理常用食物。
              </Text>
            </View>
          </View>

          <View style={styles.quickGrid}>
            <QuickActionCard
              icon="🍽️"
              title="餵食"
              subtitle="快速記錄一餐"
              tone="mint"
              onPress={() => openQuickLogTab("meal")}
            />
            <QuickActionCard
              icon="💧"
              title="飲水"
              subtitle="記錄今日飲水"
              tone="sky"
              onPress={() => openQuickLogTab("water")}
            />
            <QuickActionCard
              icon="🚽"
              title="去廁所"
              subtitle="便便或尿尿紀錄"
              tone="peach"
              onPress={() => openQuickLogTab("litter")}
            />
            <QuickActionCard
              icon="⚖️"
              title="磅重"
              subtitle="更新體重與趨勢"
              tone="lavender"
              onPress={() =>
                navigation.navigate("Log", { screen: "WeightTracker" })
              }
            />
          </View>

          <QuickActionCard
            icon="🍗"
            title="食物管理"
            subtitle="集中管理常用食物、熱量與喜好"
            tone="dark"
            onPress={openFoodManagement}
            wide
          />
        </View>

        {/* Weekly Chart */}
        <Text style={styles.sectionTitle}>本週趨勢</Text>
        <View style={styles.chartTabRow}>
          <TouchableOpacity
            style={[
              styles.chartTabBtn,
              chartTab === "feed" && styles.chartTabBtnActive,
            ]}
            onPress={() => setChartTab("feed")}
          >
            <Text
              style={[
                styles.chartTabText,
                chartTab === "feed" && styles.chartTabTextActive,
              ]}
            >
              🍽️ 熱量（kcal）
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.chartTabBtn,
              chartTab === "water" && styles.chartTabBtnActive,
            ]}
            onPress={() => setChartTab("water")}
          >
            <Text
              style={[
                styles.chartTabText,
                chartTab === "water" && styles.chartTabTextActive,
              ]}
            >
              💧 飲水（ml）
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.chartContainer}>
          {chartTab === "feed" ? (
            <BarChart
              data={weekFeedData}
              barWidth={28}
              spacing={16}
              roundedTop
              hideRules
              xAxisThickness={0}
              yAxisThickness={0}
              yAxisTextStyle={{ color: "#9ca3af", fontSize: 10 }}
              xAxisLabelTextStyle={{ color: "#9ca3af", fontSize: 10 }}
              frontColor="#7FA655"
              noOfSections={4}
              maxValue={Math.max(...weekFeedData.map((d) => d.value), 100)}
            />
          ) : (
            <BarChart
              data={weekWaterData}
              barWidth={28}
              spacing={16}
              roundedTop
              hideRules
              xAxisThickness={0}
              yAxisThickness={0}
              yAxisTextStyle={{ color: "#9ca3af", fontSize: 10 }}
              xAxisLabelTextStyle={{ color: "#9ca3af", fontSize: 10 }}
              frontColor="#38bdf8"
              noOfSections={4}
              maxValue={Math.max(...weekWaterData.map((d) => d.value), 100)}
            />
          )}
        </View>
      </ScrollView>
    </Animated.View>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  color,
  variant = "paper",
}: {
  icon: string;
  label: string;
  value: string;
  color: string;
  variant?: "hero" | "paper";
}) {
  const isHero = variant === "hero";
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: color },
        isHero && styles.heroStatCard,
      ]}
    >
      <View style={[styles.cardIconWrap, isHero && styles.cardIconWrapHero]}>
        <Text style={styles.cardIcon}>{icon}</Text>
      </View>
      <Text style={[styles.cardValue, isHero && styles.cardValueHero]}>
        {value}
      </Text>
      <Text style={[styles.cardLabel, isHero && styles.cardLabelHero]}>
        {label}
      </Text>
    </View>
  );
}

function QuickActionCard({
  icon,
  title,
  subtitle,
  tone,
  onPress,
  wide,
}: {
  icon: string;
  title: string;
  subtitle: string;
  tone: "mint" | "sky" | "peach" | "lavender" | "dark";
  onPress: () => void;
  wide?: boolean;
}) {
  const isDark = tone === "dark";
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={[
        styles.quickActionCard,
        styles[
          `quickActionCard${tone[0].toUpperCase()}${tone.slice(1)}` as keyof typeof styles
        ],
        wide && styles.quickActionCardWide,
      ]}
      onPress={onPress}
    >
      <View style={styles.quickActionTopRow}>
        <View
          style={[
            styles.quickActionIconWrap,
            isDark && styles.quickActionIconWrapDark,
          ]}
        >
          <Text style={styles.quickActionIcon}>{icon}</Text>
        </View>
      </View>
      <Text
        style={[styles.quickActionTitle, isDark && styles.quickActionTitleDark]}
      >
        {title}
      </Text>
      <Text
        style={[
          styles.quickActionSubtitle,
          isDark && styles.quickActionSubtitleDark,
        ]}
        numberOfLines={2}
      >
        {subtitle}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EB" },
  content: {
    padding: 20,
    paddingTop: SCREEN_TOP_CONTENT_PADDING,
    paddingBottom: 120,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {},
  homeHero: {
    position: "relative",
    overflow: "hidden",
    marginBottom: 16,
    borderRadius: 30,
    padding: 20,
    backgroundColor: "#182C28",
    borderWidth: 1.5,
    borderColor: "rgba(23,36,33,0.3)",
    shadowColor: "#2c231a",
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  heroGlowPrimary: {
    position: "absolute",
    top: -18,
    right: -22,
    width: 190,
    height: 190,
    borderRadius: 999,
    backgroundColor: "rgba(127, 166, 85, 0.34)",
  },
  heroGlowSecondary: {
    position: "absolute",
    bottom: -72,
    left: -38,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(14, 165, 233, 0.22)",
  },
  homeHeroContent: {
    gap: 16,
  },
  homeHeroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  homeHeroTextWrap: {
    flex: 1,
    gap: 6,
  },
  homeHeroKicker: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: "#d8eee8",
  },
  homeHeroTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 28,
    lineHeight: 34,
    color: "#FFFDF6",
  },
  homeHeroSubtitle: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 13,
    lineHeight: 20,
    color: "rgba(255,253,246,0.82)",
  },
  greeting: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 16,
    color: "#6b7280",
  },
  catName: { fontFamily: "ZenMaruGothic-Bold", fontSize: 22, color: "#111827" },

  petSwitcherSection: { marginBottom: 18 },
  petSwitcherHeader: { marginBottom: 10 },
  petSwitcherHint: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6b7280",
  },
  petSwitcherList: { gap: 10, paddingRight: 8 },
  petChip: {
    width: 148,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "#FFFDF6",
    borderWidth: 1,
    borderColor: "#DDD2C3",
  },
  petChipActive: {
    backgroundColor: "#EAF4EF",
    borderColor: "#2E7A70",
  },
  petChipAvatar: { width: 44, height: 44, borderRadius: 22 },
  petChipAvatarPlaceholder: {
    backgroundColor: "#fde68a",
    alignItems: "center",
    justifyContent: "center",
  },
  petChipAvatarEmoji: { fontSize: 20 },
  petChipTextWrap: { flex: 1, gap: 3 },
  petChipName: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 14,
    color: "#111827",
  },
  petChipNameActive: { color: "#14532d" },
  petChipMeta: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6b7280",
  },
  petChipMetaActive: { color: "#4D7C0F" },

  streakBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,253,246,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,253,246,0.18)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: "center",
  },
  streakIcon: { fontSize: 16 },
  streakText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 14,
    color: "#FFFDF6",
  },

  sectionTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 16,
    color: "#111827",
    marginBottom: 12,
    marginTop: 8,
  },

  cardsRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  card: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(23,36,33,0.06)",
  },
  heroStatCard: {
    borderColor: "rgba(255,253,246,0.18)",
    backgroundColor: "rgba(255,253,246,0.14)",
  },
  cardIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.65)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardIconWrapHero: {
    backgroundColor: "rgba(255,253,246,0.18)",
  },
  cardIcon: { fontSize: 18 },
  cardValue: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 18,
    color: "#111827",
    marginTop: 10,
  },
  cardValueHero: {
    color: "#FFFDF6",
  },
  cardLabel: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  cardLabelHero: {
    color: "rgba(255,253,246,0.76)",
  },

  weightHeroCard: {
    marginBottom: 20,
    backgroundColor: "#FFF8ED",
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    shadowColor: "#2c231a",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  weightHeroLabel: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#111827",
  },
  weightHeroValue: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 24,
    color: "#111827",
    marginTop: 4,
  },
  weightHeroHint: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
  },
  weightHeroAction: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 13,
    color: "#2E7A70",
  },
  quickPanel: {
    marginBottom: 24,
    padding: 16,
    borderRadius: 24,
    backgroundColor: "#FFF9EF",
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    gap: 12,
    shadowColor: "#2c231a",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  quickPanelHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  quickPanelHint: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickActionCard: {
    width: "48%",
    borderRadius: 24,
    padding: 14,
    minHeight: 126,
    justifyContent: "space-between",
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    shadowColor: "#2c231a",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  quickActionCardMint: { backgroundColor: "#E8F5E8", borderColor: "#DDD2C3" },
  quickActionCardSky: { backgroundColor: "#E8F1FF", borderColor: "#DDD2C3" },
  quickActionCardPeach: { backgroundColor: "#FFF1D6", borderColor: "#DDD2C3" },
  quickActionCardLavender: {
    backgroundColor: "#F0EAFF",
    borderColor: "#DDD2C3",
  },
  quickActionCardDark: {
    backgroundColor: "#f3f6f3",
    borderColor: "#DDD2C3",
  },
  quickActionCardWide: { width: "100%", marginTop: 2 },
  quickActionTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  quickActionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.65)",
  },
  quickActionIconWrapDark: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  quickActionIcon: { fontSize: 18 },
  quickActionTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#111827",
    marginTop: 10,
  },
  quickActionTitleDark: { color: "#333" },
  quickActionSubtitle: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    lineHeight: 18,
    color: "#64748B",
    marginTop: 4,
  },
  quickActionSubtitleDark: { color: "#64748B" },

  chartTabRow: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },
  chartTabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 10,
  },
  chartTabBtnActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  chartTabText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#6b7280",
  },
  chartTabTextActive: { fontFamily: "ZenMaruGothic-Bold", color: "#111827" },

  chartContainer: {
    borderRadius: 14,
    backgroundColor: "#fafafa",
    padding: 16,
    marginBottom: 20,
  },
});
