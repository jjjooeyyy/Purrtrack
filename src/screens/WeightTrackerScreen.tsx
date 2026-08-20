import { LogStackParamList } from "@/src/navigator/MainTabNavigator";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import {
  collection,
  doc,
  getDocs,
  runTransaction,
  Timestamp,
} from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { LineChart } from "react-native-gifted-charts";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WeightTrackerSkeleton } from "../components/ui/skeleton";
import { SCREEN_TOP_CONTENT_PADDING } from "../constants/theme";
import { db } from "../firebase";
import { usePetSession } from "../hooks/usePetSession";
import { DailyLog, WeightEntry } from "../types";

type Nav = StackNavigationProp<LogStackParamList, "WeightTracker">;

type WeightRecord = WeightEntry & {
  id: string;
  date: string;
};

function formatDate(date: Date) {
  return date.toISOString().split("T")[0];
}

function formatDisplayDate(dateString: string) {
  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }
  return date.toLocaleDateString("zh-HK", {
    month: "short",
    day: "numeric",
  });
}

function formatDisplayTime(timestamp: Timestamp) {
  return timestamp.toDate().toLocaleTimeString("zh-HK", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function roundWeight(value: number) {
  return Math.round(value * 10) / 10;
}

export default function WeightTrackerScreen() {
  const navigation = useNavigation<Nav>();
  const { activePet, refresh } = usePetSession();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [weightInput, setWeightInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [records, setRecords] = useState<WeightRecord[]>([]);
  const insets = useSafeAreaInsets();

  const loadRecords = useCallback(async () => {
    if (!activePet) {
      setRecords([]);
      return;
    }

    const snap = await getDocs(collection(db, "pets", activePet.id, "logs"));
    const nextRecords: WeightRecord[] = [];

    snap.forEach((entryDoc) => {
      const data = entryDoc.data() as DailyLog;
      (data.weights ?? []).forEach((weight, index) => {
        nextRecords.push({
          ...weight,
          id: `${entryDoc.id}-${weight.time.toMillis()}-${index}`,
          date: entryDoc.id,
        });
      });
    });

    nextRecords.sort(
      (left, right) => left.time.toMillis() - right.time.toMillis(),
    );
    setRecords(nextRecords);
  }, [activePet]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadRecords().finally(() => setLoading(false));
    }, [loadRecords]),
  );

  // Reload immediately when active pet changes from another screen
  useEffect(() => {
    if (activePet?.id) {
      setLoading(true);
      loadRecords().finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePet?.id]);

  const currentWeight =
    records.length > 0
      ? records[records.length - 1].kg
      : (activePet?.weight ?? 0);
  const firstWeight = records.length > 0 ? records[0].kg : currentWeight;
  const delta = roundWeight(currentWeight - firstWeight);
  const latestRecord = records.length > 0 ? records[records.length - 1] : null;
  const recentRecords = useMemo(() => [...records].reverse(), [records]);

  const chartData = useMemo(() => {
    const source = records.slice(-10);
    return source.map((record, index) => ({
      value: record.kg,
      label:
        source.length <= 6 || index % 2 === 0
          ? formatDisplayDate(record.date)
          : "",
      dataPointText: `${roundWeight(record.kg)}kg`,
    }));
  }, [records]);

  const handleSave = async () => {
    if (!activePet || saving) {
      return;
    }

    const parsedWeight = parseFloat(weightInput);
    if (Number.isNaN(parsedWeight) || parsedWeight <= 0 || parsedWeight > 30) {
      Alert.alert("資料無效", "請輸入正確的體重（公斤）。");
      return;
    }

    const today = formatDate(new Date());
    const now = Timestamp.now();
    const normalizedWeight = roundWeight(parsedWeight);
    const normalizedNote = noteInput.trim();
    const logRef = doc(db, "pets", activePet.id, "logs", today);
    const petRef = doc(db, "pets", activePet.id);

    setSaving(true);
    try {
      await runTransaction(db, async (transaction) => {
        const logSnap = await transaction.get(logRef);
        const nextEntry: WeightEntry = {
          kg: normalizedWeight,
          time: now,
          ...(normalizedNote ? { note: normalizedNote } : {}),
        };

        if (!logSnap.exists()) {
          transaction.set(logRef, {
            petId: activePet.id,
            date: today,
            meals: [],
            water: [],
            litter: [],
            care: [],
            weights: [nextEntry],
            totalMeals: 0,
            totalWater: 0,
            litterVisits: 0,
          });
        } else {
          const currentLog = logSnap.data() as DailyLog;
          transaction.update(logRef, {
            weights: [...(currentLog.weights ?? []), nextEntry],
          });
        }

        transaction.set(
          petRef,
          {
            weight: normalizedWeight,
          },
          { merge: true },
        );
      });

      setWeightInput("");
      setNoteInput("");
      await Promise.all([loadRecords(), refresh()]);
      Alert.alert("已更新", "體重紀錄已儲存，個人檔案的目前體重也同步更新。");
    } catch (error) {
      Alert.alert(
        "錯誤",
        error instanceof Error ? error.message : "儲存體重失敗。",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <WeightTrackerSkeleton />;
  }

  if (!activePet) {
    return (
      <View style={styles.centerScreen}>
        <Text style={styles.emptyTitle}>尚未選擇寵物</Text>
        <Text style={styles.emptyText}>
          先返回設定頁建立或切換寵物，之後就可以開始記錄體重。
        </Text>
      </View>
    );
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRecords();
    setRefreshing(false);
  };

  return (
    <Animated.View entering={FadeIn.duration(300)} style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          data={recentRecords}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#7FA655"
            />
          }
          ListHeaderComponent={
            <>
              <TouchableOpacity
                style={[styles.backButton, { top: insets.top - 10 }]}
                onPress={() => navigation.goBack()}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="chevron-back" size={28} color="#111827" />
              </TouchableOpacity>
              <View style={styles.headerRow}></View>
              <View style={styles.headerTextWrap}>
                <Text style={styles.eyebrow}>體重追蹤</Text>
                <Text style={styles.title}>{activePet.name} 的體重紀錄</Text>
              </View>

              <View style={styles.heroCard}>
                <View style={styles.heroTopRow}>
                  <View>
                    <Text style={styles.heroLabel}>目前體重</Text>
                    <Text style={styles.heroValue}>
                      {currentWeight
                        ? `${roundWeight(currentWeight)} kg`
                        : "尚未記錄"}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.deltaBadge,
                      delta >= 0 ? styles.deltaBadgeUp : styles.deltaBadgeDown,
                    ]}
                  >
                    <Text style={styles.deltaBadgeText}>
                      {delta >= 0 ? `+${delta}` : `${delta}`} kg
                    </Text>
                  </View>
                </View>
                <Text style={styles.heroMeta}>
                  {latestRecord
                    ? `最後更新：${formatDisplayDate(latestRecord.date)} ${formatDisplayTime(latestRecord.time)}`
                    : "建立第一筆體重後，這裡會顯示最新變化。"}
                </Text>
              </View>

              <View style={styles.formCard}>
                <Text style={styles.sectionTitle}>新增體重紀錄</Text>
                <Text style={styles.sectionHint}>
                  建議固定在相近時間、相近狀態下量度，圖表會更有參考價值。
                </Text>
                <Text style={styles.inputLabel}>體重（kg）</Text>
                <TextInput
                  style={styles.input}
                  placeholder="例如 4.3"
                  value={weightInput}
                  onChangeText={setWeightInput}
                  keyboardType="decimal-pad"
                />
                <Text style={styles.inputLabel}>備註（選填）</Text>
                <TextInput
                  style={[styles.input, styles.noteInput]}
                  placeholder="例如 晚飯前量度、剛看完醫生"
                  value={noteInput}
                  onChangeText={setNoteInput}
                  multiline
                />
                <TouchableOpacity
                  style={styles.saveButton}
                  onPress={() => void handleSave()}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveButtonText}>儲存體重</Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.chartCard}>
                <View style={styles.chartHeader}>
                  <Text style={styles.sectionTitle}>體重趨勢</Text>
                  <Text style={styles.chartCount}>{records.length} 筆</Text>
                </View>
                {chartData.length >= 2 ? (
                  <LineChart
                    data={chartData}
                    curved
                    color="#7FA655"
                    thickness={3}
                    dataPointsColor="#7FA655"
                    dataPointsRadius={2}
                    hideRules
                    yAxisThickness={0}
                    xAxisThickness={0}
                    yAxisTextStyle={{ color: "#9ca3af", fontSize: 11 }}
                    xAxisLabelTextStyle={{ color: "#9ca3af", fontSize: 10 }}
                    startFillColor="#acc98d"
                    endFillColor="#7FA655"
                    startOpacity={0.9}
                    endOpacity={0.1}
                    areaChart
                    noOfSections={4}
                    maxValue={
                      Math.max(...chartData.map((item) => item.value)) + 0.5
                    }
                  />
                ) : (
                  <View style={styles.chartEmptyState}>
                    <Text style={styles.emptyText}>
                      至少需要 2 筆體重紀錄先可以畫出趨勢線。
                    </Text>
                  </View>
                )}
              </View>

              <Text style={styles.sectionTitle}>最近紀錄</Text>
            </>
          }
          renderItem={({ item }) => (
            <View style={styles.recordCard}>
              <View style={styles.recordTopRow}>
                <View>
                  <Text style={styles.recordWeight}>
                    {roundWeight(item.kg)} kg
                  </Text>
                  <Text style={styles.recordMeta}>
                    {formatDisplayDate(item.date)} ·{" "}
                    {formatDisplayTime(item.time)}
                  </Text>
                </View>
                {latestRecord?.id === item.id ? (
                  <Text style={styles.latestBadge}>最新</Text>
                ) : null}
              </View>
              {item.note ? (
                <Text style={styles.recordNote}>{item.note}</Text>
              ) : null}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>還未有體重紀錄</Text>
              <Text style={styles.emptyText}>
                先加第一筆，之後就可以看到變化曲線和最近紀錄。
              </Text>
            </View>
          }
        />
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EB" },
  content: {
    padding: 20,
    paddingTop: SCREEN_TOP_CONTENT_PADDING,
    paddingBottom: 120,
    gap: 14,
  },
  centerScreen: {
    flex: 1,
    backgroundColor: "#F7F4EB",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    backgroundColor: "#FFF8EF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2c231a",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  headerTextWrap: { flex: 1 },
  eyebrow: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 12,
    color: "#7FA655",
    textTransform: "uppercase",
  },
  title: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 30,
    lineHeight: 36,
    color: "#172421",
    marginTop: 4,
  },
  heroCard: {
    backgroundColor: "#FFF8ED",
    borderRadius: 26,
    padding: 18,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    marginTop: 10,
    marginBottom: 10,
    shadowColor: "#2c231a",
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  heroLabel: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#0D8B98",
  },
  heroValue: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 36,
    color: "#172421",
    marginTop: 4,
  },
  heroMeta: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6E7C74",
    marginTop: 12,
    lineHeight: 18,
  },
  deltaBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  deltaBadgeUp: { backgroundColor: "#E8F5E8" },
  deltaBadgeDown: { backgroundColor: "#E4F6F7" },
  deltaBadgeText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 13,
    color: "#0D8B98",
  },
  formCard: {
    backgroundColor: "#FFF9EF",
    borderRadius: 24,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    marginBottom: 10,
  },
  sectionTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 17,
    color: "#111827",
    marginBottom: 0,
  },
  sectionHint: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6E7C74",
    lineHeight: 18,
    marginBottom: 10,
  },
  inputLabel: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#374151",
    marginTop: 6,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    backgroundColor: "#FFFDF6",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111827",
  },
  noteInput: {
    minHeight: 84,
    textAlignVertical: "top",
  },
  saveButton: {
    marginTop: 14,
    backgroundColor: "#0D8B98",
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: "center",
  },
  saveButtonText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#fff",
  },
  chartCard: {
    backgroundColor: "#FFFDF7",
    borderRadius: 24,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    marginBottom: 10,
  },
  chartHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  chartCount: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 12,
    color: "#0D8B98",
  },
  chartEmptyState: {
    paddingVertical: 28,
    alignItems: "center",
    justifyContent: "center",
  },

  recordCard: {
    backgroundColor: "#FFFDF6",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    marginBottom: 0,
  },
  recordTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 5,
  },
  recordWeight: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 20,
    color: "#111827",
  },
  recordMeta: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6E7C74",
    marginTop: 4,
  },
  recordNote: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 13,
    lineHeight: 18,
    color: "#4b5563",
    marginTop: 10,
  },
  latestBadge: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 11,
    color: "#fff",
    backgroundColor: "#0D8B98",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: "hidden",
  },
  emptyCard: {
    backgroundColor: "#FFFDF6",
    borderRadius: 18,
    padding: 20,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
  },
  emptyTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 18,
    color: "#111827",
    textAlign: "center",
    marginBottom: 8,
  },
  emptyText: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 13,
    lineHeight: 19,
    color: "#6b7280",
    textAlign: "center",
  },
});
