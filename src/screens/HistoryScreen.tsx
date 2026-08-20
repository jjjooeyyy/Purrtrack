import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import { collection, getDocs } from "firebase/firestore";
import React, { useCallback, useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Calendar, DateData, LocaleConfig } from "react-native-calendars";
import Animated, { FadeIn } from "react-native-reanimated";
import { HistoryScreenSkeleton } from "../components/ui/skeleton";
import { SCREEN_TOP_CONTENT_PADDING } from "../constants/theme";
import { db } from "../firebase";
import { usePetSession } from "../hooks/usePetSession";
import { ensureVirtualMealLogForDay } from "../lib/mealCatalog";
import { HistoryStackParamList } from "../navigator/MainTabNavigator";

type Nav = StackNavigationProp<HistoryStackParamList, "History">;

type DotEntry = { key: string; color: string };
type MarkedDates = {
  [date: string]: {
    dots?: DotEntry[];
    selected?: boolean;
    selectedColor?: string;
  };
};

LocaleConfig.locales["zh-hk"] = {
  monthNames: [
    "一月",
    "二月",
    "三月",
    "四月",
    "五月",
    "六月",
    "七月",
    "八月",
    "九月",
    "十月",
    "十一月",
    "十二月",
  ],
  monthNamesShort: [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ],
  dayNames: [
    "星期日",
    "星期一",
    "星期二",
    "星期三",
    "星期四",
    "星期五",
    "星期六",
  ],
  dayNamesShort: ["日", "一", "二", "三", "四", "五", "六"],
  today: "今天",
};

LocaleConfig.defaultLocale = "zh-hk";

const LOG_DOT: DotEntry = { key: "log", color: "#7FA655" };
const CARE_DOT: DotEntry = { key: "care", color: "#F59E0B" };

export default function HistoryScreen() {
  const navigation = useNavigation<Nav>();
  const { activePet } = usePetSession();
  const [markedDates, setMarkedDates] = useState<MarkedDates>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadMarkedDates = useCallback(async () => {
    if (!activePet) {
      setMarkedDates({});
      return;
    }

    try {
      // Only generate virtual logs for the last 14 days
      const today = new Date();
      const dates: string[] = [];
      for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        dates.push(`${yyyy}-${mm}-${dd}`);
      }
      if (
        activePet.feederConfig?.enabled &&
        activePet.feederConfig.schedules?.length
      ) {
        await Promise.all(
          dates.map((date) => ensureVirtualMealLogForDay(date, activePet)),
        );
      }
    } catch {
      // Ignore errors, just show what we have
    } finally {
      // Fetch logs immediately
      const logsRef = collection(db, "pets", activePet.id, "logs");
      const updateMarks = async () => {
        const snap = await getDocs(logsRef);
        const marks: MarkedDates = {};
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          const hasMeals = Array.isArray(data.meals) && data.meals.length > 0;
          const hasWater = Array.isArray(data.water) && data.water.length > 0;
          const hasLitter =
            Array.isArray(data.litter) && data.litter.length > 0;
          const hasCare = Array.isArray(data.care) && data.care.length > 0;
          const hasWeights =
            Array.isArray(data.weights) && data.weights.length > 0;
          const hasJournal = Boolean(data.journal);
          if (
            !hasMeals &&
            !hasWater &&
            !hasLitter &&
            !hasCare &&
            !hasWeights &&
            !hasJournal
          ) {
            return;
          }
          const dots: DotEntry[] = [LOG_DOT];
          if (hasCare) {
            dots.push(CARE_DOT);
          }
          marks[docSnap.id] = { dots };
        });
        // Highlight today with a green circle
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, "0");
        const dd = String(today.getDate()).padStart(2, "0");
        const todayStr = `${yyyy}-${mm}-${dd}`;
        marks[todayStr] = {
          ...(marks[todayStr] || {}),
          selected: true,
          selectedColor: "#7FA655",
        };
        setMarkedDates(marks);
      };
      await updateMarks();
      // Fetch again after 400ms to catch Firestore sync
      setTimeout(updateMarks, 400);
    }
  }, [activePet]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadMarkedDates().finally(() => setLoading(false));
    }, [loadMarkedDates]),
  );

  // Reload immediately when active pet changes from another screen
  useEffect(() => {
    if (activePet?.id) {
      setLoading(true);
      loadMarkedDates().finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePet?.id]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMarkedDates();
    setRefreshing(false);
  };

  const handleDayPress = (day: DateData) => {
    navigation.navigate("DayDetail", { date: day.dateString });
  };
  const currentMonthLabel = new Date().toLocaleDateString("zh-HK", {
    month: "long",
  });

  if (loading) {
    return <HistoryScreenSkeleton />;
  }

  if (!activePet) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>請先建立或選擇一個寵物資料</Text>
      </View>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(300)} style={{ flex: 1 }}>
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#7FA655"
            />
          }
        >
          <View style={styles.topline}>
            <View style={styles.titleWrap}>
              <Text style={styles.kicker}>歷史</Text>
              <Text style={styles.title}>歷史紀錄</Text>
            </View>
            <View style={styles.monthBadge}>
              <Text style={styles.monthBadgeText}>{currentMonthLabel}</Text>
            </View>
          </View>

          <View style={styles.calendarCard}>
            <Calendar
              onDayPress={handleDayPress}
              markedDates={markedDates}
              markingType="multi-dot"
              theme={{
                calendarBackground: "#FFFDF6",
                todayTextColor: "#2E7A70",
                selectedDayBackgroundColor: "#172421",
                selectedDayTextColor: "#FFFDF6",
                arrowColor: "#2E7A70",
                monthTextColor: "#172421",
                textDayFontWeight: "700",
                textMonthFontWeight: "700",
                dayTextColor: "#172421",
                textDisabledColor: "#A8B0AB",
                textDayHeaderFontWeight: "700",
                textDayHeaderFontSize: 10,
              }}
              style={styles.calendar}
            />
          </View>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendDot, { backgroundColor: "#7FA655" }]}
              />
              <Text style={styles.legendText}>有紀錄</Text>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[styles.legendDot, { backgroundColor: "#F59E0B" }]}
              />
              <Text style={styles.legendText}>有護理</Text>
            </View>
          </View>
          <Text style={styles.hint}>按一下日期查看當日紀錄</Text>
        </ScrollView>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EB" },
  content: {
    padding: 20,
    paddingTop: SCREEN_TOP_CONTENT_PADDING,
    paddingBottom: 120,
    gap: 16,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  topline: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 14,
  },
  titleWrap: {
    flex: 1,
  },
  kicker: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 11,
    color: "#2E7A70",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 30,
    lineHeight: 36,
    color: "#172421",
  },
  monthBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#F0EAFF",
    borderWidth: 1,
    borderColor: "rgba(23,36,33,0.08)",
  },
  monthBadgeText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 12,
    color: "#7B5AD9",
  },
  calendarCard: {
    backgroundColor: "#FFF8ED",
    borderRadius: 26,
    padding: 12,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    shadowColor: "#2c231a",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  calendar: { marginTop: 0, borderRadius: 18 },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    marginTop: 12,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6E7C74",
  },
  hint: {
    fontFamily: "ZenMaruGothic-Regular",
    textAlign: "center",
    color: "#6E7C74",
    fontSize: 13,
  },
});
