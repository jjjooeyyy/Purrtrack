import Entypo from "@expo/vector-icons/Entypo";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import {
  deleteField,
  doc,
  getDoc,
  runTransaction,
  Timestamp,
} from "firebase/firestore";
import { deleteObject, ref as storageRef } from "firebase/storage";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";
import EditTimePickerModal from "../components/EditTimePickerModal";
import {
  CARE_ACTION_ICONS,
  CARE_ACTION_LABELS,
  LITTER_CONDITION_LABELS,
  LITTER_KIND_LABELS,
  LITTER_SIZE_LABELS,
  LITTER_TYPE_LABELS,
  MEAL_CATEGORY_ICONS,
  MEAL_CATEGORY_LABELS,
  MOOD_ICONS,
  MOOD_LABELS,
} from "../constants/localization";
import { SCREEN_TOP_CONTENT_PADDING } from "../constants/theme";
import { db, storage } from "../firebase";
import { usePetSession } from "../hooks/usePetSession";
import {
  buildMealLegacyFoodType,
  createFoodCatalogId,
  createSupplementCatalogId,
  findMatchingFood,
  findMatchingSupplement,
  getLegacyMealFoodName,
  getMealCategory,
  getMealDisplayLabel,
  mergeFoodCatalogs,
  mergeSupplementCatalogs,
  normalizeFoodName,
  upsertFoodCatalogItem,
  upsertSupplementCatalogItem,
} from "../lib/mealCatalog";
import { calculateMealKcalFromEntry } from "../lib/mealKcal";
import { HistoryStackParamList } from "../navigator/MainTabNavigator";
import {
  CareEntry,
  DailyLog,
  JournalEntry,
  LitterEntry,
  MealCategory,
  MealEntry,
  SavedFood,
  SavedSupplement,
  SharedPetProfile,
  WaterEntry,
  WeightEntry,
} from "../types";

type Route = RouteProp<HistoryStackParamList, "DayDetail">;

type SectionItem =
  | { kind: "meal"; data: VirtualMealEntry }
  | { kind: "water"; data: WaterEntry }
  | { kind: "weight"; data: WeightEntry }
  | {
      kind: "litter";
      data:
        | LitterEntry
        | { type: "clean" | "dirty" | "vomit"; time: Timestamp };
    }
  | { kind: "care"; data: CareEntry }
  | { kind: "journal"; data: JournalEntry };

type SectionConfig = {
  key: SectionItem["kind"];
  title: string;
  subtitle: string;
  icon: string;
  accent: string;
  tint: string;
  data: SectionItem[];
};

type EditTarget =
  | { kind: "meal"; index: number }
  | { kind: "water"; index: number }
  | { kind: "litter"; index: number }
  | { kind: "care"; index: number }
  | { kind: "journal" };

type LitterKind = LitterEntry["kind"];
type LitterSize = LitterEntry["size"];
type LitterCondition = NonNullable<LitterEntry["condition"]>;
type CareAction = CareEntry["action"];
type Mood = JournalEntry["mood"];
type VirtualMealEntry = MealEntry & {
  __virtual?: true;
  __scheduleId?: string;
  __unit?: "g" | "portion";
};
type EditTimePickerTarget = "meal" | "water" | null;

const MEAL_CATEGORIES: MealCategory[] = ["dry", "wet", "snack"];
const SECTION_META: Record<
  SectionItem["kind"],
  Omit<SectionConfig, "key" | "data">
> = {
  meal: {
    title: "餵食",
    subtitle: "今天吃了甚麼、吃了幾多",
    icon: "🍽️",
    accent: "#7FA655",
    tint: "#fff7ed",
  },
  water: {
    title: "飲水",
    subtitle: "喝水份量",
    icon: "💧",
    accent: "#0ea5e9",
    tint: "#eff6ff",
  },
  weight: {
    title: "體重",
    subtitle: "體重變化與量度備註",
    icon: "⚖️",
    accent: "#7FA655",
    tint: "#f5f3ff",
  },
  litter: {
    title: "去廁所",
    subtitle: "如廁次數、大小與狀態",
    icon: "🪣",
    accent: "#10b981",
    tint: "#ecfdf5",
  },
  care: {
    title: "護理",
    subtitle: "日常照顧與醫療安排",
    icon: "🩺",
    accent: "#14b8a6",
    tint: "#f0fdfa",
  },
  journal: {
    title: "日記",
    subtitle: "當日心情、筆記與照片",
    icon: "📔",
    accent: "#7FA655",
    tint: "#f5f3ff",
  },
};

const LITTER_SIZE_OPTIONS: LitterSize[] = ["small", "medium", "large"];
const LITTER_CONDITION_OPTIONS: LitterCondition[] = ["hard", "normal", "soft"];
const LITTER_SIZE_DESCRIPTIONS: Record<LitterSize, string> = {
  small: "約如葡萄或乒乓球",
  medium: "約如雞蛋或高爾夫球",
  large: "約如網球",
  extraLarge: "超過網球或拳頭大小 → 可能喝水太多或健康問題",
};
const CARE_ACTIONS: CareAction[] = [
  "nail_cut",
  "flea_treatment",
  "vet_visit",
  "vaccine",
  "deworming",
  "bath",
  "grooming",
  "other",
];
const MOODS: Mood[] = [
  "energetic",
  "playful",
  "normal",
  "tired",
  "anxious",
  "sick",
];

function formatTime(ts: Timestamp): string {
  const d = ts.toDate();
  return d.toLocaleTimeString("zh-HK", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeInput(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

function buildTimestampForDate(date: string, timeValue: Date): Timestamp {
  const [year, month, day] = date.split("-").map(Number);
  return Timestamp.fromDate(
    new Date(
      year,
      month - 1,
      day,
      timeValue.getHours(),
      timeValue.getMinutes(),
      0,
      0,
    ),
  );
}

function formatDisplayDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString("zh-HK", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function getSectionCountLabel(
  kind: SectionItem["kind"],
  count: number,
): string {
  return kind === "journal"
    ? "1 日"
    : kind === "weight"
      ? `${count} 筆`
      : `${count} 項`;
}

function getWaterSourceLabel(source: WaterEntry["source"]): string {
  switch (source) {
    case "drag":
      return "拖曳估算";
    case "manual":
      return "手動輸入";
    default:
      return "快速預設";
  }
}

function computeMealTotal(meals: MealEntry[]): number {
  return meals.reduce((sum, item) => sum + item.grams, 0);
}

function computeWaterTotal(water: WaterEntry[]): number {
  return water.reduce((sum, item) => sum + item.ml, 0);
}

function isSameMealWindow(meal: MealEntry, scheduledAt: Date): boolean {
  const diff = Math.abs(meal.time.toDate().getTime() - scheduledAt.getTime());
  return diff <= 30 * 60 * 1000;
}

function buildVirtualMealEntry(
  date: string,
  dispatchTime: string,
  portion: number,
  scheduleId: string,
  unit: "g" | "portion",
  foodName?: string,
  kcalAmount?: number,
  kcalUnit?: MealEntry["kcalUnit"],
): VirtualMealEntry {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = dispatchTime.split(":").map(Number);

  return {
    grams: portion,
    time: Timestamp.fromDate(
      new Date(year, month - 1, day, hour, minute, 0, 0),
    ),
    ...(foodName ? { foodName } : {}),
    ...(typeof kcalAmount === "number" ? { kcalAmount } : {}),
    ...(kcalUnit ? { kcalUnit } : {}),
    __virtual: true,
    __scheduleId: scheduleId,
    __unit: unit,
  };
}

function sanitizeMealEntry(entry: VirtualMealEntry): VirtualMealEntry {
  return {
    grams: entry.grams,
    time: entry.time,
    ...(entry.category ? { category: entry.category } : {}),
    ...(entry.foodName ? { foodName: entry.foodName } : {}),
    ...(entry.supplement ? { supplement: entry.supplement } : {}),
    ...(entry.foodType ? { foodType: entry.foodType } : {}),
    ...(typeof entry.kcalAmount === "number"
      ? { kcalAmount: entry.kcalAmount }
      : {}),
    ...(entry.kcalUnit ? { kcalUnit: entry.kcalUnit } : {}),
    ...(entry.__virtual ? { __virtual: true } : {}),
    ...(entry.__scheduleId ? { __scheduleId: entry.__scheduleId } : {}),
    ...(entry.__unit ? { __unit: entry.__unit } : {}),
  };
}

function serializeMealEntry(entry: VirtualMealEntry): string {
  return JSON.stringify({
    grams: entry.grams,
    time: entry.time.toMillis(),
    category: entry.category ?? null,
    foodName: entry.foodName ?? null,
    supplement: entry.supplement ?? null,
    foodType: entry.foodType ?? null,
    kcalAmount: entry.kcalAmount ?? null,
    kcalUnit: entry.kcalUnit ?? null,
    __virtual: entry.__virtual ?? false,
    __scheduleId: entry.__scheduleId ?? null,
    __unit: entry.__unit ?? null,
  });
}

function areMealListsEqual(
  left: VirtualMealEntry[],
  right: VirtualMealEntry[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (entry, index) =>
      serializeMealEntry(entry) === serializeMealEntry(right[index]),
  );
}

function isLogEmpty(
  log: Pick<
    DailyLog,
    "meals" | "water" | "litter" | "care" | "weights" | "journal"
  >,
) {
  return (
    log.meals.length === 0 &&
    log.water.length === 0 &&
    log.litter.length === 0 &&
    (log.care?.length ?? 0) === 0 &&
    (log.weights?.length ?? 0) === 0 &&
    !log.journal
  );
}

function shouldDeleteLog(
  log: Pick<
    DailyLog,
    | "meals"
    | "water"
    | "litter"
    | "care"
    | "weights"
    | "journal"
    | "suppressedMealScheduleIds"
  >,
) {
  return isLogEmpty(log) && (log.suppressedMealScheduleIds?.length ?? 0) === 0;
}

export default function DayDetailScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation();
  const { date } = route.params;
  const { user, pets, activePet, profile, refresh, updateSharedCatalogs } =
    usePetSession();

  const [log, setLog] = useState<DailyLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [photoModalUri, setPhotoModalUri] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editTargetTime, setEditTargetTime] = useState<number | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editEntryTime, setEditEntryTime] = useState(new Date());
  const [editTimePickerTarget, setEditTimePickerTarget] =
    useState<EditTimePickerTarget>(null);

  const [editMealGrams, setEditMealGrams] = useState("");
  const [editMealCategory, setEditMealCategory] = useState<MealCategory>("wet");
  const [editMealCategoryTouched, setEditMealCategoryTouched] = useState(false);
  const [editFoodName, setEditFoodName] = useState("");
  const [editMealSupplement, setEditMealSupplement] = useState("");
  const [editSelectedFoodId, setEditSelectedFoodId] = useState<string | null>(
    null,
  );
  const [editSelectedSupplementId, setEditSelectedSupplementId] = useState<
    string | null
  >(null);
  const [foodCatalog, setFoodCatalog] = useState<SavedFood[]>([]);
  const [supplementCatalog, setSupplementCatalog] = useState<SavedSupplement[]>(
    [],
  );
  const [editWaterMl, setEditWaterMl] = useState("");
  const [editLitterKind, setEditLitterKind] = useState<LitterKind>("wee");
  const [editLitterCount, setEditLitterCount] = useState("1");
  const [editLitterSize, setEditLitterSize] = useState<LitterSize>("medium");
  const [editLitterCondition, setEditLitterCondition] =
    useState<LitterCondition>("normal");
  const [editCareAction, setEditCareAction] = useState<CareAction>("nail_cut");
  const [editCareNote, setEditCareNote] = useState("");
  const [editJournalMood, setEditJournalMood] = useState<Mood>("normal");
  const [editJournalNote, setEditJournalNote] = useState("");

  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});

  const loadLog = useCallback(async () => {
    if (!activePet) {
      setLog(null);
      return;
    }

    try {
      const logRef = doc(db, "pets", activePet.id, "logs", date);
      const snap = await getDoc(logRef);
      let loadedLog: DailyLog | null = snap.exists()
        ? (snap.data() as DailyLog)
        : null;

      if (
        activePet.feederConfig?.enabled &&
        activePet.feederConfig.schedules?.length
      ) {
        const persistedMeals = (loadedLog?.meals ?? []) as VirtualMealEntry[];
        const suppressedMealScheduleIds =
          loadedLog?.suppressedMealScheduleIds ?? [];
        const manualMeals = persistedMeals.filter((meal) => !meal.__virtual);
        const generatedMeals = activePet.feederConfig.schedules
          .filter((schedule) => {
            if (suppressedMealScheduleIds.includes(schedule.id)) {
              return false;
            }
            const scheduledMeal = buildVirtualMealEntry(
              date,
              schedule.dispatchTime,
              schedule.portion,
              schedule.id,
              schedule.unit,
              schedule.foodName,
              schedule.kcalAmount,
              schedule.kcalUnit,
            );

            return !manualMeals.some((meal) =>
              isSameMealWindow(meal, scheduledMeal.time.toDate()),
            );
          })
          .map((schedule) =>
            buildVirtualMealEntry(
              date,
              schedule.dispatchTime,
              schedule.portion,
              schedule.id,
              schedule.unit,
              schedule.foodName,
              schedule.kcalAmount,
              schedule.kcalUnit,
            ),
          );

        const nextMeals = [...manualMeals, ...generatedMeals]
          .map(sanitizeMealEntry)
          .sort((left, right) => left.time.toMillis() - right.time.toMillis());

        if (!areMealListsEqual(persistedMeals, nextMeals)) {
          const updatedLog: DailyLog = {
            date,
            petId: activePet.id,
            meals: nextMeals,
            water: loadedLog?.water ?? [],
            litter: loadedLog?.litter ?? [],
            care: loadedLog?.care ?? [],
            ...(suppressedMealScheduleIds.length > 0
              ? { suppressedMealScheduleIds }
              : {}),
            ...(loadedLog?.weights ? { weights: loadedLog.weights } : {}),
            ...(loadedLog?.journal ? { journal: loadedLog.journal } : {}),
            totalMeals: computeMealTotal(nextMeals),
            totalWater:
              loadedLog?.totalWater ??
              computeWaterTotal(loadedLog?.water ?? []),
            litterVisits:
              loadedLog?.litterVisits ?? loadedLog?.litter?.length ?? 0,
          };

          await runTransaction(db, async (transaction) => {
            transaction.set(logRef, updatedLog, { merge: true });
          });

          loadedLog = updatedLog;
        }
      }

      setLog(loadedLog);
    } catch (error) {
      Alert.alert(
        "錯誤",
        error instanceof Error ? error.message : "讀取當日紀錄失敗。",
      );
      setLog(null);
    }
  }, [activePet, date]);

  useEffect(() => {
    navigation.setOptions({ title: date });

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLog(null);

      if (!activePet) {
        setLoading(false);
        return;
      }

      try {
        await loadLog();
      } finally {
        setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [activePet, date, navigation, loadLog]);

  useEffect(() => {
    const allPetFoodCatalog = pets.flatMap((pet) =>
      (pet.foodCatalog ?? []).map(({ id, name, category }) => ({
        id,
        name,
        category,
      })),
    );
    const allPetSupplementCatalog = pets.flatMap(
      (pet) => pet.supplementCatalog ?? [],
    );

    setFoodCatalog(
      mergeFoodCatalogs(
        mergeFoodCatalogs(profile?.sharedFoodCatalog ?? [], allPetFoodCatalog),
        activePet?.foodCatalog ?? [],
      ),
    );
    setSupplementCatalog(
      mergeSupplementCatalogs(
        mergeSupplementCatalogs(
          profile?.sharedSupplementCatalog ?? [],
          allPetSupplementCatalog,
        ),
        [],
      ),
    );
  }, [
    activePet,
    pets,
    profile?.sharedFoodCatalog,
    profile?.sharedSupplementCatalog,
  ]);

  const formattedDate = useMemo(() => formatDisplayDate(date), [date]);
  const careEntries = log?.care ?? [];
  const weightEntries = log?.weights ?? [];

  if (loading) {
    return (
      <View style={styles.stateScreen}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Entypo name="chevron-left" size={24} color="#111827" />
        </TouchableOpacity>
        <View style={styles.stateCard}>
          <ActivityIndicator size="large" color="#7FA655" />
          <Text style={styles.stateTitle}>正在整理今日紀錄</Text>
          <Text style={styles.stateText}>
            等一等，幫你把飲食同日記排得好睇啲。
          </Text>
        </View>
      </View>
    );
  }

  if (!log) {
    return (
      <View style={styles.stateScreen}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Entypo name="chevron-left" size={24} color="#111827" />
        </TouchableOpacity>
        <View style={styles.stateCard}>
          <Text style={styles.stateEmoji}>📋</Text>
          <Text style={styles.stateTitle}>這天暫時沒有資料</Text>
          <Text style={styles.stateText}>
            {date} 還未記錄任何飲食、護理或日記內容。
          </Text>
        </View>
      </View>
    );
  }
  const mealEntries = [...((log.meals ?? []) as VirtualMealEntry[])].sort(
    (left, right) => left.time.toMillis() - right.time.toMillis(),
  );

  const sections: SectionConfig[] = [
    {
      key: "meal" as const,
      ...SECTION_META.meal,
      data: mealEntries.map((item) => ({ kind: "meal" as const, data: item })),
    },
    {
      key: "water" as const,
      ...SECTION_META.water,
      data: log.water.map((item) => ({ kind: "water" as const, data: item })),
    },
    {
      key: "weight" as const,
      ...SECTION_META.weight,
      data: weightEntries.map((item) => ({
        kind: "weight" as const,
        data: item,
      })),
    },
    {
      key: "litter" as const,
      ...SECTION_META.litter,
      data: log.litter.map((item) => ({ kind: "litter" as const, data: item })),
    },
    {
      key: "care" as const,
      ...SECTION_META.care,
      data: careEntries.map((item) => ({ kind: "care" as const, data: item })),
    },
    ...(log.journal
      ? [
          {
            key: "journal" as const,
            ...SECTION_META.journal,
            data: [{ kind: "journal" as const, data: log.journal }],
          },
        ]
      : []),
  ].filter((section) => section.data.length > 0);

  const litterWeeCount = log.litter.reduce(
    (sum, entry) => sum + (entry.kind === "wee" ? entry.count : 0),
    0,
  );
  const litterPooCount = log.litter.reduce(
    (sum, entry) => sum + (entry.kind === "poo" ? entry.count : 0),
    0,
  );

  const summaryCards = [
    {
      key: "meal",
      icon: "🍽️",
      label: "餵食",
      value: `${log.meals.length > 0 ? log.totalMeals : mealEntries.reduce((sum, m) => sum + m.grams, 0)}g`,
      tint: "#fff7ed",
      accent: "#7FA655",
    },
    {
      key: "water",
      icon: "💧",
      label: "飲水",
      value: `${log.totalWater}ml`,
      tint: "#eff6ff",
      accent: "#0ea5e9",
    },
    {
      key: "wee",
      icon: "💦",
      label: "小便",
      value: `${litterWeeCount} 嚿`,
      tint: "#ecfdf5",
      accent: "#10b981",
    },
    {
      key: "poo",
      icon: "💩",
      label: "大便",
      value: `${litterPooCount} 嚿`,
      tint: "#fff7ed",
      accent: "#f59e0b",
    },
    ...(weightEntries.length > 0
      ? [
          {
            key: "weight",
            icon: "⚖️",
            label: "體重",
            value: `${weightEntries[weightEntries.length - 1]?.kg ?? 0}kg`,
            tint: "#f5f3ff",
            accent: "#7FA655",
          },
        ]
      : []),
    ...(careEntries.length > 0
      ? [
          {
            key: "care",
            icon: "🩺",
            label: "護理",
            value: `${careEntries.length}項`,
            tint: "#f0fdfa",
            accent: "#14b8a6",
          },
        ]
      : []),
    ...(log.journal
      ? [
          {
            key: "journal",
            icon: MOOD_ICONS[log.journal.mood],
            label: "狀態",
            value: MOOD_LABELS[log.journal.mood],
            tint: "#f5f3ff",
            accent: "#8b5cf6",
          },
        ]
      : []),
  ];

  const filteredSavedFoods = foodCatalog.filter(
    (item) => item.category === editMealCategory,
  );
  const savedSupplements = supplementCatalog;

  const closeEditSheet = () => {
    setEditTarget(null);
    setEditTargetTime(null);
    setEditSaving(false);
  };

  const openEditTimePicker = (target: Exclude<EditTimePickerTarget, null>) => {
    setEditTimePickerTarget(target);
  };

  const closeEditTimePicker = () => {
    setEditTimePickerTarget(null);
  };

  const openMealEditor = (item: VirtualMealEntry, index: number) => {
    setEditMealGrams(String(item.grams));
    setEditMealCategoryTouched(false);
    const category = getMealCategory(item);
    const legacyFoodName = getLegacyMealFoodName(item.foodType);
    const currentFoodName = normalizeFoodName(item.foodName ?? legacyFoodName);
    const matchedFood = currentFoodName
      ? foodCatalog.find(
          (catalogItem) =>
            catalogItem.category === category &&
            normalizeFoodName(catalogItem.name).toLowerCase() ===
              currentFoodName.toLowerCase(),
        )
      : undefined;
    const currentSupplementName = normalizeFoodName(item.supplement ?? "");
    const matchedSupplement = currentSupplementName
      ? supplementCatalog.find(
          (catalogItem) =>
            normalizeFoodName(catalogItem.name).toLowerCase() ===
            currentSupplementName.toLowerCase(),
        )
      : undefined;
    setEditMealCategory(category);
    setEditFoodName(currentFoodName);
    setEditMealSupplement(item.supplement ?? "");
    setEditSelectedFoodId(matchedFood?.id ?? null);
    setEditSelectedSupplementId(matchedSupplement?.id ?? null);
    setEditEntryTime(item.time.toDate());
    setEditTargetTime(item.time.toMillis());
    setEditTarget({ kind: "meal", index });
  };

  const openWaterEditor = (item: WaterEntry, index: number) => {
    setEditWaterMl(String(item.ml));
    setEditEntryTime(item.time.toDate());
    setEditTargetTime(item.time.toMillis());
    setEditTarget({ kind: "water", index });
  };

  const openLitterEditor = (item: LitterEntry, index: number) => {
    setEditLitterKind(item.kind);
    setEditLitterCount(String(item.count));
    setEditLitterSize(item.size);
    setEditLitterCondition(item.condition ?? "normal");
    setEditTargetTime(item.time.toMillis());
    setEditTarget({ kind: "litter", index });
  };

  const openCareEditor = (item: CareEntry, index: number) => {
    setEditCareAction(item.action);
    setEditCareNote(item.note ?? "");
    setEditTargetTime(item.time.toMillis());
    setEditTarget({ kind: "care", index });
  };

  const openJournalEditor = (item: JournalEntry) => {
    setEditJournalMood(item.mood);
    setEditJournalNote(item.note ?? "");
    setEditTargetTime(null);
    setEditTarget({ kind: "journal" });
  };

  const handleSaveEdit = async () => {
    if (!user || !activePet || !editTarget || !log) {
      return;
    }

    const logRef = doc(db, "pets", activePet.id, "logs", date);
    setEditSaving(true);

    try {
      if (editTarget.kind === "meal") {
        const grams = parseFloat(editMealGrams);
        if (Number.isNaN(grams) || grams <= 0) {
          Alert.alert("資料無效", "請輸入正確的克數。");
          setEditSaving(false);
          return;
        }
        if (editTargetTime === null) {
          throw new Error("找不到要編輯的餵食紀錄。");
        }

        let nextLog: DailyLog | null = null;
        let nextCatalog: SavedFood[] | null = null;
        let nextSupplementCatalog: SavedSupplement[] | null = null;
        let nextSelectedFoodId = editSelectedFoodId;
        let nextSelectedSupplementId = editSelectedSupplementId;
        const nextMealTime = buildTimestampForDate(date, editEntryTime);
        const normalizedFoodName = normalizeFoodName(editFoodName);
        const normalizedSupplement = normalizeFoodName(editMealSupplement);
        const userRef = doc(db, "users", user.uid);
        const petRef = doc(db, "pets", activePet.id);
        await runTransaction(db, async (transaction) => {
          const [userSnap, petSnap, snap] = await Promise.all([
            transaction.get(userRef),
            transaction.get(petRef),
            transaction.get(logRef),
          ]);
          if (!snap.exists()) {
            throw new Error("找不到當日紀錄。");
          }

          const currentUserProfile = userSnap.exists() ? userSnap.data() : {};
          const currentPet = petSnap.exists()
            ? ({ id: petSnap.id, ...petSnap.data() } as SharedPetProfile)
            : null;
          const currentSharedCatalog = Array.isArray(
            currentUserProfile.sharedFoodCatalog,
          )
            ? (currentUserProfile.sharedFoodCatalog as SavedFood[])
            : [];
          const currentSharedSupplementCatalog = Array.isArray(
            currentUserProfile.sharedSupplementCatalog,
          )
            ? (currentUserProfile.sharedSupplementCatalog as SavedSupplement[])
            : [];
          const currentCatalog = mergeFoodCatalogs(
            mergeFoodCatalogs(
              currentSharedCatalog,
              pets.flatMap((pet) =>
                (pet.foodCatalog ?? []).map(({ id, name, category }) => ({
                  id,
                  name,
                  category,
                })),
              ),
            ),
            currentPet?.foodCatalog ?? [],
          );
          const currentSupplementCatalog = mergeSupplementCatalogs(
            mergeSupplementCatalogs(
              currentSharedSupplementCatalog,
              pets.flatMap((pet) => pet.supplementCatalog ?? []),
            ),
            [],
          );
          const currentLog = snap.data() as DailyLog;
          const meals = [...currentLog.meals];
          const suppressedMealScheduleIds = [
            ...(currentLog.suppressedMealScheduleIds ?? []),
          ];
          const entryIndex = meals.findIndex(
            (entry) => entry.time.toMillis() === editTargetTime,
          );
          if (entryIndex === -1) {
            throw new Error("這筆餵食紀錄已變更，請重新打開再試。");
          }
          const currentMeal = meals[entryIndex];
          const originalLegacyFoodName = getLegacyMealFoodName(
            currentMeal.foodType,
          );
          const preserveLegacyMeal =
            !currentMeal.category &&
            !currentMeal.foodName &&
            !!currentMeal.foodType &&
            !!originalLegacyFoodName &&
            !editMealCategoryTouched &&
            normalizedFoodName.toLowerCase() ===
              normalizeFoodName(originalLegacyFoodName).toLowerCase();

          if (normalizedFoodName && !preserveLegacyMeal) {
            const matchedFood = nextSelectedFoodId
              ? currentCatalog.find((item) => item.id === nextSelectedFoodId)
              : findMatchingFood(
                  currentCatalog,
                  editMealCategory,
                  normalizedFoodName,
                );

            if (matchedFood) {
              nextSelectedFoodId = matchedFood.id;
              nextCatalog = currentSharedCatalog.some(
                (item) => item.id === matchedFood.id,
              )
                ? currentSharedCatalog
                : upsertFoodCatalogItem(currentSharedCatalog, {
                    id: matchedFood.id,
                    name: normalizedFoodName,
                    category: editMealCategory,
                  });
              if (nextCatalog !== currentSharedCatalog) {
                transaction.set(
                  userRef,
                  { sharedFoodCatalog: nextCatalog },
                  { merge: true },
                );
              }
            } else {
              nextCatalog = upsertFoodCatalogItem(currentSharedCatalog, {
                id: createFoodCatalogId(),
                name: normalizedFoodName,
                category: editMealCategory,
              });
              transaction.set(
                userRef,
                { sharedFoodCatalog: nextCatalog },
                { merge: true },
              );
            }
          }

          if (normalizedSupplement) {
            const matchedSupplement = nextSelectedSupplementId
              ? currentSupplementCatalog.find(
                  (item) => item.id === nextSelectedSupplementId,
                )
              : findMatchingSupplement(
                  currentSupplementCatalog,
                  normalizedSupplement,
                );

            if (matchedSupplement) {
              nextSelectedSupplementId = matchedSupplement.id;
              nextSupplementCatalog = currentSharedSupplementCatalog.some(
                (item) => item.id === matchedSupplement.id,
              )
                ? currentSharedSupplementCatalog
                : upsertSupplementCatalogItem(currentSharedSupplementCatalog, {
                    id: matchedSupplement.id,
                    name: normalizedSupplement,
                  });
              if (nextSupplementCatalog !== currentSharedSupplementCatalog) {
                transaction.set(
                  userRef,
                  { sharedSupplementCatalog: nextSupplementCatalog },
                  { merge: true },
                );
              }
            } else {
              nextSelectedSupplementId = createSupplementCatalogId();
              nextSupplementCatalog = upsertSupplementCatalogItem(
                currentSharedSupplementCatalog,
                {
                  id: nextSelectedSupplementId,
                  name: normalizedSupplement,
                },
              );
              transaction.set(
                userRef,
                { sharedSupplementCatalog: nextSupplementCatalog },
                { merge: true },
              );
            }
          }

          const currentVirtualMeal = currentMeal as VirtualMealEntry;
          if (
            currentVirtualMeal.__virtual &&
            currentVirtualMeal.__scheduleId &&
            !suppressedMealScheduleIds.includes(currentVirtualMeal.__scheduleId)
          ) {
            suppressedMealScheduleIds.push(currentVirtualMeal.__scheduleId);
          }
          const { __virtual, __scheduleId, __unit, ...manualMealBase } =
            currentVirtualMeal;

          if (preserveLegacyMeal) {
            meals[entryIndex] = {
              ...manualMealBase,
              grams,
              time: nextMealTime,
              ...(normalizedSupplement
                ? { supplement: normalizedSupplement }
                : {}),
              foodType: currentMeal.foodType,
            };
          } else {
            meals[entryIndex] = {
              ...manualMealBase,
              grams,
              time: nextMealTime,
              category: editMealCategory,
              ...(normalizedFoodName ? { foodName: normalizedFoodName } : {}),
              ...(normalizedSupplement
                ? { supplement: normalizedSupplement }
                : {}),
              foodType: buildMealLegacyFoodType(
                editMealCategory,
                normalizedFoodName,
              ),
            };
            if (!normalizedFoodName) {
              delete meals[entryIndex].foodName;
            }
          }
          if (!normalizedSupplement) {
            delete meals[entryIndex].supplement;
          }
          const totalMeals = computeMealTotal(meals);
          transaction.update(logRef, {
            meals,
            totalMeals,
            suppressedMealScheduleIds:
              suppressedMealScheduleIds.length > 0
                ? suppressedMealScheduleIds
                : deleteField(),
          });
          nextLog = {
            ...currentLog,
            meals,
            totalMeals,
            ...(suppressedMealScheduleIds.length > 0
              ? { suppressedMealScheduleIds }
              : {}),
          };
        });
        if (nextLog) {
          setLog(nextLog);
        }
        if (nextCatalog) {
          setFoodCatalog(
            mergeFoodCatalogs(nextCatalog, activePet?.foodCatalog ?? []),
          );
          updateSharedCatalogs({ foodCatalog: nextCatalog });
        }
        if (nextSupplementCatalog) {
          setSupplementCatalog(nextSupplementCatalog);
          updateSharedCatalogs({ supplementCatalog: nextSupplementCatalog });
        }
        setEditSelectedFoodId(nextSelectedFoodId);
        setEditSelectedSupplementId(nextSelectedSupplementId);
        if (nextCatalog || nextSupplementCatalog) {
          await refresh();
        }
      } else if (editTarget.kind === "water") {
        const ml = parseInt(editWaterMl, 10);
        if (Number.isNaN(ml) || ml < 0) {
          Alert.alert("資料無效", "請輸入正確的飲水毫升數。");
          setEditSaving(false);
          return;
        }
        if (editTargetTime === null) {
          throw new Error("找不到要編輯的飲水紀錄。");
        }

        let nextLog: DailyLog | null = null;
        const nextWaterTime = buildTimestampForDate(date, editEntryTime);
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(logRef);
          if (!snap.exists()) {
            throw new Error("找不到當日紀錄。");
          }
          const currentLog = snap.data() as DailyLog;
          const water = [...currentLog.water];
          const entryIndex = water.findIndex(
            (entry) => entry.time.toMillis() === editTargetTime,
          );
          if (entryIndex === -1) {
            throw new Error("這筆飲水紀錄已變更，請重新打開再試。");
          }

          water[entryIndex] = { ...water[entryIndex], ml, time: nextWaterTime };
          const totalWater = computeWaterTotal(water);
          transaction.update(logRef, { water, totalWater });
          nextLog = { ...currentLog, water, totalWater };
        });
        if (nextLog) {
          setLog(nextLog);
        }
      } else if (editTarget.kind === "litter") {
        const count = parseInt(editLitterCount, 10);
        if (Number.isNaN(count) || count <= 0) {
          Alert.alert("資料無效", "請輸入正確的次數。");
          setEditSaving(false);
          return;
        }
        if (editTargetTime === null) {
          throw new Error("找不到要編輯的去廁所紀錄。");
        }

        let nextLog: DailyLog | null = null;
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(logRef);
          if (!snap.exists()) {
            throw new Error("找不到當日紀錄。");
          }
          const currentLog = snap.data() as DailyLog;
          const litter = [...currentLog.litter];
          const entryIndex = litter.findIndex(
            (entry) =>
              "kind" in entry && entry.time.toMillis() === editTargetTime,
          );
          if (entryIndex === -1) {
            throw new Error("依次去廁所紀錄已變更，請重新打開再試。");
          }
          const currentEntry = litter[entryIndex];
          if (!("kind" in currentEntry)) {
            throw new Error("依次去廁所紀錄暫時不能編輯。");
          }

          litter[entryIndex] = {
            ...currentEntry,
            kind: editLitterKind,
            count,
            size: editLitterSize,
            condition: editLitterKind === "poo" ? editLitterCondition : null,
          };
          const litterVisits = litter.length;
          transaction.update(logRef, { litter, litterVisits });
          nextLog = { ...currentLog, litter, litterVisits };
        });
        if (nextLog) {
          setLog(nextLog);
        }
      } else if (editTarget.kind === "care") {
        if (editTargetTime === null) {
          throw new Error("找不到要編輯的護理紀錄。");
        }

        let nextLog: DailyLog | null = null;
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(logRef);
          if (!snap.exists()) {
            throw new Error("找不到當日紀錄。");
          }
          const currentLog = snap.data() as DailyLog;
          const care = [...(currentLog.care ?? [])];
          const entryIndex = care.findIndex(
            (entry) => entry.time.toMillis() === editTargetTime,
          );
          if (entryIndex === -1) {
            throw new Error("這筆護理紀錄已變更，請重新打開再試。");
          }

          care[entryIndex] = {
            ...care[entryIndex],
            action: editCareAction,
            ...(editCareNote.trim() ? { note: editCareNote.trim() } : {}),
          };
          if (!editCareNote.trim()) {
            delete care[entryIndex].note;
          }

          transaction.update(logRef, { care });
          nextLog = { ...currentLog, care };
        });
        if (nextLog) {
          setLog(nextLog);
        }
      } else {
        const now = Timestamp.now();
        let nextLog: DailyLog | null = null;
        await runTransaction(db, async (transaction) => {
          const snap = await transaction.get(logRef);
          if (!snap.exists()) {
            throw new Error("找不到當日紀錄。");
          }
          const currentLog = snap.data() as DailyLog;
          if (!currentLog.journal) {
            throw new Error("找不到要編輯的日記紀錄。");
          }

          const nextJournal: JournalEntry = {
            ...currentLog.journal,
            mood: editJournalMood,
            updatedAt: now,
            ...(editJournalNote.trim() ? { note: editJournalNote.trim() } : {}),
          };
          if (!editJournalNote.trim()) {
            delete nextJournal.note;
          }

          transaction.update(logRef, { journal: nextJournal });
          nextLog = { ...currentLog, journal: nextJournal };
        });
        if (nextLog) {
          setLog(nextLog);
        }
      }

      closeEditSheet();
      Alert.alert("已更新 ✅", "這筆紀錄已更新。");
    } catch (error) {
      Alert.alert(
        "錯誤",
        error instanceof Error ? error.message : "更新失敗。",
      );
      setEditSaving(false);
    }
  };

  const handleDeleteItem = async (item: SectionItem, targetIndex?: number) => {
    if (!activePet || !log) {
      return;
    }

    const logRef = doc(db, "pets", activePet.id, "logs", date);

    try {
      let nextLog: DailyLog | null = null;
      let removedWholeDay = false;
      let journalPhotoToDelete: string | null = null;

      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(logRef);
        if (!snap.exists()) {
          throw new Error("找不到當日紀錄。");
        }

        const currentLog = snap.data() as DailyLog;

        if (item.kind === "meal") {
          const meals = [...currentLog.meals];
          if (targetIndex === undefined) {
            throw new Error("找不到要刪除的餵食紀錄。");
          }
          const entry = meals[targetIndex];
          if (!entry || entry.time.toMillis() !== item.data.time.toMillis()) {
            throw new Error("這筆餵食紀錄已變更，請重新打開再試。");
          }
          meals.splice(targetIndex, 1);
          const updatedLog: DailyLog = {
            ...currentLog,
            meals,
            totalMeals: computeMealTotal(meals),
            ...(item.data.__virtual && item.data.__scheduleId
              ? {
                  suppressedMealScheduleIds: Array.from(
                    new Set([
                      ...(currentLog.suppressedMealScheduleIds ?? []),
                      item.data.__scheduleId,
                    ]),
                  ),
                }
              : {}),
          };
          if (shouldDeleteLog(updatedLog)) {
            transaction.delete(logRef);
            removedWholeDay = true;
          } else {
            transaction.update(logRef, {
              meals,
              totalMeals: updatedLog.totalMeals,
              suppressedMealScheduleIds: updatedLog.suppressedMealScheduleIds
                ?.length
                ? updatedLog.suppressedMealScheduleIds
                : deleteField(),
            });
            nextLog = updatedLog;
          }
          return;
        }

        if (item.kind === "water") {
          const water = [...currentLog.water];
          if (targetIndex === undefined) {
            throw new Error("找不到要刪除的飲水紀錄。");
          }
          const entry = water[targetIndex];
          if (!entry || entry.time.toMillis() !== item.data.time.toMillis()) {
            throw new Error("這筆飲水紀錄已變更，請重新打開再試。");
          }
          water.splice(targetIndex, 1);
          const updatedLog: DailyLog = {
            ...currentLog,
            water,
            totalWater: computeWaterTotal(water),
          };
          if (shouldDeleteLog(updatedLog)) {
            transaction.delete(logRef);
            removedWholeDay = true;
          } else {
            transaction.update(logRef, {
              water,
              totalWater: updatedLog.totalWater,
            });
            nextLog = updatedLog;
          }
          return;
        }

        if (item.kind === "weight") {
          const weights = [...(currentLog.weights ?? [])];
          if (targetIndex === undefined) {
            throw new Error("找不到要刪除的體重紀錄。");
          }
          const entry = weights[targetIndex];
          if (!entry || entry.time.toMillis() !== item.data.time.toMillis()) {
            throw new Error("這筆體重紀錄已變更，請重新打開再試。");
          }
          weights.splice(targetIndex, 1);
          const updatedLog: DailyLog = {
            ...currentLog,
            weights,
          };
          const latestWeight =
            weights.length > 0 ? weights[weights.length - 1].kg : 0;
          if (shouldDeleteLog(updatedLog)) {
            transaction.delete(logRef);
            removedWholeDay = true;
          } else {
            transaction.update(logRef, {
              weights: weights.length > 0 ? weights : deleteField(),
            });
            transaction.set(
              doc(db, "pets", activePet.id),
              { weight: latestWeight },
              { merge: true },
            );
            nextLog = updatedLog;
          }
          return;
        }

        if (item.kind === "litter") {
          const litter = [...currentLog.litter];
          if (targetIndex === undefined) {
            throw new Error("找不到要刪除的去廁所紀錄。");
          }
          const entry = litter[targetIndex];
          if (!entry || entry.time.toMillis() !== item.data.time.toMillis()) {
            throw new Error("依次去廁所紀錄已變更，請重新打開再試。");
          }
          litter.splice(targetIndex, 1);
          const updatedLog: DailyLog = {
            ...currentLog,
            litter,
            litterVisits: litter.length,
          };
          if (shouldDeleteLog(updatedLog)) {
            transaction.delete(logRef);
            removedWholeDay = true;
          } else {
            transaction.update(logRef, {
              litter,
              litterVisits: updatedLog.litterVisits,
            });
            nextLog = updatedLog;
          }
          return;
        }

        if (item.kind === "care") {
          const care = [...(currentLog.care ?? [])];
          if (targetIndex === undefined) {
            throw new Error("找不到要刪除的護理紀錄。");
          }
          const entry = care[targetIndex];
          if (!entry || entry.time.toMillis() !== item.data.time.toMillis()) {
            throw new Error("這筆護理紀錄已變更，請重新打開再試。");
          }
          care.splice(targetIndex, 1);
          const updatedLog: DailyLog = {
            ...currentLog,
            care,
          };
          if (shouldDeleteLog(updatedLog)) {
            transaction.delete(logRef);
            removedWholeDay = true;
          } else {
            transaction.update(logRef, { care });
            nextLog = updatedLog;
          }
          return;
        }

        if (!currentLog.journal) {
          throw new Error("找不到要刪除的日記紀錄。");
        }
        journalPhotoToDelete = currentLog.journal.photoURL ?? null;

        const updatedLog: DailyLog = {
          ...currentLog,
        };
        delete updatedLog.journal;

        if (shouldDeleteLog(updatedLog)) {
          transaction.delete(logRef);
          removedWholeDay = true;
        } else {
          transaction.update(logRef, { journal: deleteField() });
          nextLog = updatedLog;
        }
      });

      let partialDeleteMessage: string | null = null;
      if (journalPhotoToDelete) {
        try {
          await deleteObject(storageRef(storage, journalPhotoToDelete));
        } catch (error) {
          partialDeleteMessage =
            error instanceof Error
              ? `紀錄已刪除，但相片移除失敗：${error.message}`
              : "紀錄已刪除，但相片移除失敗。";
        }
      }

      if (removedWholeDay) {
        Alert.alert(
          partialDeleteMessage ? "部分刪除成功" : "已刪除 ✅",
          partialDeleteMessage ?? "這天最後一筆紀錄已刪除，已返回日曆。",
        );
        setLog(null);
        navigation.goBack();
        return;
      }

      if (nextLog) {
        setLog(nextLog);
      }
      Alert.alert(
        partialDeleteMessage ? "部分刪除成功" : "已刪除 ✅",
        partialDeleteMessage ?? "這筆紀錄已刪除。",
      );
    } catch (error) {
      Alert.alert(
        "錯誤",
        error instanceof Error ? error.message : "刪除失敗。",
      );
    }
  };

  const confirmDeleteItem = (item: SectionItem, targetIndex?: number) => {
    const label =
      item.kind === "meal"
        ? "依次餵食紀錄"
        : item.kind === "water"
          ? "依次飲水紀錄"
          : item.kind === "weight"
            ? "依次體重紀錄"
            : item.kind === "litter"
              ? "依次去廁所紀錄"
              : item.kind === "care"
                ? "依次護理紀錄"
                : "依篇日記";

    Alert.alert("確認刪除", `確定要刪除${label}嗎？此操作無法復原。`, [
      { text: "取消", style: "cancel" },
      {
        text: "刪除",
        style: "destructive",
        onPress: () => {
          void handleDeleteItem(item, targetIndex);
        },
      },
    ]);
  };

  const renderRightActions = (
    accent: string,
    options: { onEdit?: () => void; onDelete?: () => void },
  ) => (
    <View style={styles.swipeActionsWrap}>
      {options.onEdit ? (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={options.onEdit}
          style={[styles.swipeAction, { backgroundColor: accent }]}
        >
          <Entypo name="edit" size={16} color="#fff" />
          <Text style={styles.swipeActionText}>編輯</Text>
        </TouchableOpacity>
      ) : null}
      {options.onDelete ? (
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={options.onDelete}
          style={[styles.swipeAction, styles.swipeDeleteAction]}
        >
          <Entypo name="trash" size={16} color="#fff" />
          <Text style={styles.swipeActionText}>刪除</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const renderSwipeableItem = (
    rowKey: string,
    accent: string,
    options: { onEdit?: () => void; onDelete?: () => void },
    child: React.ReactNode,
  ) => (
    <Swipeable
      key={rowKey}
      ref={(ref) => {
        swipeableRefs.current[rowKey] = ref;
      }}
      overshootRight={false}
      friction={2}
      rightThreshold={40}
      renderRightActions={() =>
        renderRightActions(accent, {
          onEdit: options.onEdit
            ? () => {
                swipeableRefs.current[rowKey]?.close();
                options.onEdit?.();
              }
            : undefined,
          onDelete: options.onDelete
            ? () => {
                swipeableRefs.current[rowKey]?.close();
                options.onDelete?.();
              }
            : undefined,
        })
      }
    >
      {child}
    </Swipeable>
  );

  const renderTimelineItem = (
    item: SectionItem,
    section: SectionConfig,
    index: number,
    isLast: boolean,
  ) => {
    const rowKey = `${section.key}-${index}`;
    const time =
      item.kind === "journal"
        ? formatTime(item.data.updatedAt)
        : formatTime(item.data.time);

    if (item.kind === "meal") {
      const isVirtual = !!item.data.__virtual;
      return renderSwipeableItem(
        rowKey,
        section.accent,
        {
          onEdit: () => openMealEditor(item.data, index),
          onDelete: () => confirmDeleteItem(item, index),
        },
        isVirtual ? (
          (() => {
            const isFromWeeklySchedule =
              item.data.__scheduleId?.startsWith("schedule-");
            if (isFromWeeklySchedule) {
              // Rich display for weekly meal schedule entries
              const foodLabel = [item.data.foodName, item.data.foodType]
                .filter(Boolean)
                .join(" · ");
              const portionKcal = calculateMealKcalFromEntry({
                grams: item.data.grams,
                kcalAmount: item.data.kcalAmount,
                kcalUnit: item.data.kcalUnit,
                kcalPerKg: item.data.kcalPerKg,
              });
              const kcalLabel = portionKcal > 0 ? ` · ${portionKcal} kcal` : "";
              return (
                <View
                  key={rowKey}
                  style={[
                    styles.timelineItem,
                    !isLast && styles.timelineItemSpacing,
                  ]}
                >
                  <View
                    style={[
                      styles.timelineIconWrap,
                      { backgroundColor: section.tint },
                    ]}
                  >
                    <Text style={styles.timelineIcon}>🍽️</Text>
                  </View>
                  <View style={styles.timelineBody}>
                    <View style={styles.timelineRowTop}>
                      <View style={{ flex: 1 }}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                            flexWrap: "wrap",
                          }}
                        >
                          <Text style={styles.timelineTitle}>
                            {item.data.grams}g{kcalLabel}
                          </Text>
                          <View style={styles.scheduleFromBadge}>
                            <Text style={styles.scheduleFromBadgeText}>
                              來自排程
                            </Text>
                          </View>
                        </View>
                        {foodLabel ? (
                          <Text style={[styles.timelineMeta, { marginTop: 2 }]}>
                            {foodLabel}
                          </Text>
                        ) : null}
                      </View>
                      <View style={styles.timePill}>
                        <Text style={styles.timePillText}>{time}</Text>
                      </View>
                    </View>
                    <Text
                      style={[
                        styles.timelineMeta,
                        { color: "#7FA655", marginTop: 4 },
                      ]}
                    >
                      已根據每週排程自動記錄，左滑可編輯或移除。
                    </Text>
                  </View>
                </View>
              );
            }
            return (
              <View
                key={rowKey}
                style={[
                  styles.timelineItem,
                  !isLast && styles.timelineItemSpacing,
                ]}
              >
                <View
                  style={[
                    styles.timelineIconWrap,
                    { backgroundColor: section.tint },
                  ]}
                >
                  <Text style={styles.timelineIcon}>🍽️</Text>
                </View>
                <View style={styles.timelineBody}>
                  <View style={styles.timelineRowTop}>
                    {(() => {
                      const mealKcal = calculateMealKcalFromEntry(item.data);
                      return (
                        <Text style={styles.timelineTitle}>
                          {item.data.grams}g
                          {item.data.__unit ? ` ${item.data.__unit}` : ""} ·
                          預設排程
                          {mealKcal > 0 ? ` · ${mealKcal} kcal` : ""}
                        </Text>
                      );
                    })()}
                    <View style={styles.timePill}>
                      <Text style={styles.timePillText}>{time}</Text>
                    </View>
                  </View>
                  <Text style={[styles.timelineMeta, { color: "#7FA655" }]}>
                    自動餵食機排程，左滑可改做實際紀錄或移除。
                  </Text>
                </View>
              </View>
            );
          })()
        ) : (
          <View
            style={[styles.timelineItem, !isLast && styles.timelineItemSpacing]}
          >
            <View
              style={[
                styles.timelineIconWrap,
                { backgroundColor: section.tint },
              ]}
            >
              <Text style={styles.timelineIcon}>🍽️</Text>
            </View>
            <View style={styles.timelineBody}>
              <View style={styles.timelineRowTop}>
                {(() => {
                  const mealKcal = calculateMealKcalFromEntry(item.data);
                  return (
                    <Text style={styles.timelineTitle}>
                      {item.data.grams}g · {getMealDisplayLabel(item.data)}
                      {mealKcal > 0 ? ` · ${mealKcal} kcal` : ""}
                    </Text>
                  );
                })()}
                <View style={styles.timePill}>
                  <Text style={styles.timePillText}>{time}</Text>
                </View>
              </View>
              <Text style={styles.timelineMeta}>
                左滑即可編輯或刪除這餐紀錄
              </Text>
              {item.data.supplement ? (
                <Text style={styles.timelineMeta}>
                  補充品：{item.data.supplement}
                </Text>
              ) : null}
            </View>
          </View>
        ),
      );
    }

    if (item.kind === "water") {
      return renderSwipeableItem(
        rowKey,
        section.accent,
        {
          onEdit: () => openWaterEditor(item.data, index),
          onDelete: () => confirmDeleteItem(item, index),
        },
        <View
          style={[styles.timelineItem, !isLast && styles.timelineItemSpacing]}
        >
          <View
            style={[styles.timelineIconWrap, { backgroundColor: section.tint }]}
          >
            <Text style={styles.timelineIcon}>💧</Text>
          </View>
          <View style={styles.timelineBody}>
            <View style={styles.timelineRowTop}>
              <Text style={styles.timelineTitle}>{item.data.ml} ml</Text>
              <View style={styles.timePill}>
                <Text style={styles.timePillText}>{time}</Text>
              </View>
            </View>
            <Text style={styles.timelineMeta}>
              {getWaterSourceLabel(item.data.source)}
              {item.data.estimated ? " · 估算值" : " · 實際輸入"}
            </Text>
          </View>
        </View>,
      );
    }

    if (item.kind === "weight") {
      return renderSwipeableItem(
        rowKey,
        section.accent,
        {
          onDelete: () => confirmDeleteItem(item, index),
        },
        <View
          style={[styles.timelineItem, !isLast && styles.timelineItemSpacing]}
        >
          <View
            style={[styles.timelineIconWrap, { backgroundColor: section.tint }]}
          >
            <Text style={styles.timelineIcon}>⚖️</Text>
          </View>
          <View style={styles.timelineBody}>
            <View style={styles.timelineRowTop}>
              <Text style={styles.timelineTitle}>{item.data.kg} kg</Text>
              <View style={styles.timePill}>
                <Text style={styles.timePillText}>{time}</Text>
              </View>
            </View>
            <Text style={styles.timelineMeta}>
              {item.data.note?.trim() || "左滑即可刪除這筆體重紀錄"}
            </Text>
          </View>
        </View>,
      );
    }

    if (item.kind === "care") {
      return renderSwipeableItem(
        rowKey,
        section.accent,
        {
          onEdit: () => openCareEditor(item.data, index),
          onDelete: () => confirmDeleteItem(item, index),
        },
        <View
          style={[styles.timelineItem, !isLast && styles.timelineItemSpacing]}
        >
          <View
            style={[styles.timelineIconWrap, { backgroundColor: section.tint }]}
          >
            <Text style={styles.timelineIcon}>
              {CARE_ACTION_ICONS[item.data.action]}
            </Text>
          </View>
          <View style={styles.timelineBody}>
            <View style={styles.timelineRowTop}>
              <Text style={styles.timelineTitle}>
                {CARE_ACTION_LABELS[item.data.action]}
              </Text>
              <View style={styles.timePill}>
                <Text style={styles.timePillText}>{time}</Text>
              </View>
            </View>
            <Text style={styles.timelineMeta}>
              {item.data.note?.trim() || "左滑即可編輯護理項目與備註"}
            </Text>
          </View>
        </View>,
      );
    }

    if (item.kind === "journal") {
      return (
        <View key={rowKey} style={styles.journalCard}>
          <View style={styles.journalTopRow}>
            <View style={styles.journalMoodWrap}>
              <View
                style={[
                  styles.timelineIconWrap,
                  { backgroundColor: section.tint },
                ]}
              >
                <Text style={styles.timelineIcon}>
                  {MOOD_ICONS[item.data.mood]}
                </Text>
              </View>
              <View style={styles.journalMetaBlock}>
                <Text style={styles.timelineTitle}>
                  {MOOD_LABELS[item.data.mood]}
                </Text>
                {item.data.note && (
                  <Text style={styles.timelineMeta}>
                    今天{activePet?.name ?? "主子"} 的狀態備忘
                  </Text>
                )}
                {item.data.note ? (
                  <View style={styles.journalNoteCard}>
                    <Text style={styles.journalNoteText}>{item.data.note}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.journalActions}>
              <View style={styles.timePill}>
                <Text style={styles.timePillText}>{time}</Text>
              </View>
              <TouchableOpacity
                style={styles.inlineEditBtn}
                onPress={() => openJournalEditor(item.data)}
              >
                <Entypo name="edit" size={14} color="#8b5cf6" />
                <Text style={styles.inlineEditBtnText}>編輯</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.inlineDeleteBtn}
                onPress={() => confirmDeleteItem(item)}
              >
                <Entypo name="trash" size={14} color="#dc2626" />
                <Text style={styles.inlineDeleteBtnText}>刪除</Text>
              </TouchableOpacity>
            </View>
          </View>
          {item.data.photoURL ? (
            <TouchableOpacity
              activeOpacity={0.92}
              onPress={() => setPhotoModalUri(item.data.photoURL ?? null)}
              style={styles.journalPhotoWrap}
            >
              <Image
                source={{ uri: item.data.photoURL }}
                style={styles.journalThumb}
                resizeMode="cover"
              />
              <View style={styles.photoHint}>
                <Text style={styles.photoHintText}>點按放大相片</Text>
              </View>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    }

    const litterTitle =
      "kind" in item.data
        ? `${item.data.count} 舊 · ${LITTER_KIND_LABELS[item.data.kind]}`
        : LITTER_TYPE_LABELS[item.data.type];
    const litterMeta =
      "kind" in item.data
        ? `${LITTER_SIZE_LABELS[item.data.size]}${
            item.data.kind === "poo" && item.data.condition
              ? ` · ${LITTER_CONDITION_LABELS[item.data.condition]}`
              : ""
          }`
        : "舊紀錄格式";

    const litterRow = (
      <View
        style={[styles.timelineItem, !isLast && styles.timelineItemSpacing]}
      >
        <View
          style={[styles.timelineIconWrap, { backgroundColor: section.tint }]}
        >
          <Text style={styles.timelineIcon}>🪣</Text>
        </View>
        <View style={styles.timelineBody}>
          <View style={styles.timelineRowTop}>
            <Text style={styles.timelineTitle}>{litterTitle}</Text>
            <View style={styles.timePill}>
              <Text style={styles.timePillText}>{time}</Text>
            </View>
          </View>
          <Text style={styles.timelineMeta}>{litterMeta}</Text>
        </View>
      </View>
    );

    const litterEntry = item.data;

    if ("kind" in litterEntry) {
      return renderSwipeableItem(
        rowKey,
        section.accent,
        {
          onEdit: () => openLitterEditor(litterEntry, index),
          onDelete: () => confirmDeleteItem(item, index),
        },
        litterRow,
      );
    }

    return renderSwipeableItem(
      rowKey,
      section.accent,
      {
        onDelete: () => confirmDeleteItem(item, index),
      },
      litterRow,
    );
  };

  const renderEditBody = () => {
    if (!editTarget) {
      return null;
    }

    // Pass the kind through to the picker
    const showPicker = (target: "meal" | "water") => {
      // Small delay to ensure the keyboard is dismissed
      setTimeout(() => {
        openEditTimePicker(target);
      }, 100);
    };

    if (editTarget.kind === "meal") {
      return (
        <>
          <Text style={styles.editorLabel}>紀錄時間</Text>
          <TouchableOpacity
            style={styles.editorTimeTrigger}
            onPress={() => showPicker("meal")}
          >
            <View>
              <Text style={styles.editorTimeTriggerLabel}>選擇餵食時間</Text>
              <Text style={styles.editorTimeTriggerValue}>
                {formatTimeInput(editEntryTime)}
              </Text>
            </View>
            <Entypo name="clock" size={18} color="#7FA655" />
          </TouchableOpacity>

          <Text style={styles.editorLabel}>克數</Text>
          <TextInput
            style={styles.editorInput}
            value={editMealGrams}
            onChangeText={setEditMealGrams}
            keyboardType="decimal-pad"
            placeholder="例如 80"
          />

          <Text style={styles.editorLabel}>食物類別</Text>
          <View style={styles.segmentRow}>
            {MEAL_CATEGORIES.map((category) => (
              <TouchableOpacity
                key={category}
                style={[
                  styles.segmentBtn,
                  editMealCategory === category && styles.segmentBtnActive,
                ]}
                onPress={() => {
                  setEditMealCategory(category);
                  setEditMealCategoryTouched(true);
                  setEditSelectedFoodId(null);
                  setEditFoodName("");
                }}
              >
                <Text style={styles.choiceChipIcon}>
                  {MEAL_CATEGORY_ICONS[category]}
                </Text>
                <Text
                  style={[
                    styles.segmentBtnText,
                    editMealCategory === category &&
                      styles.segmentBtnTextActive,
                  ]}
                >
                  {MEAL_CATEGORY_LABELS[category]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.editorLabel}>先選常用食物名稱</Text>
          {filteredSavedFoods.length > 0 ? (
            <View style={styles.editorFoodChipWrap}>
              {filteredSavedFoods.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.editorFoodChip,
                    editSelectedFoodId === item.id &&
                      styles.editorFoodChipActive,
                  ]}
                  onPress={() => {
                    setEditSelectedFoodId(item.id);
                    setEditFoodName(item.name);
                  }}
                >
                  <Text
                    style={[
                      styles.editorFoodChipText,
                      editSelectedFoodId === item.id &&
                        styles.editorFoodChipTextActive,
                    ]}
                  >
                    {item.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={styles.editorHelper}>
              這個類別暫時未有常用名稱，第一次輸入後之後就可以直接選。
            </Text>
          )}

          <TextInput
            style={styles.editorInput}
            value={editFoodName}
            onChangeText={(text) => {
              setEditFoodName(text);
              setEditSelectedFoodId(null);
            }}
            placeholder="沒有合適選項才輸入新食物名稱"
          />
          <Text style={styles.editorHelper}>
            先從上面的清單選；輸入新名稱後也會自動加入主子的常用清單。
          </Text>

          <Text style={styles.editorLabel}>先選常用補充品</Text>
          {savedSupplements.length > 0 ? (
            <View style={styles.editorFoodChipWrap}>
              {savedSupplements.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.editorFoodChip,
                    editSelectedSupplementId === item.id &&
                      styles.editorFoodChipActive,
                  ]}
                  onPress={() => {
                    setEditSelectedSupplementId(item.id);
                    setEditMealSupplement(item.name);
                  }}
                >
                  <Text
                    style={[
                      styles.editorFoodChipText,
                      editSelectedSupplementId === item.id &&
                        styles.editorFoodChipTextActive,
                    ]}
                  >
                    {item.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={styles.editorHelper}>
              還未有常用補充品，第一次輸入後之後就可以直接選。
            </Text>
          )}

          <TextInput
            style={styles.editorInput}
            value={editMealSupplement}
            onChangeText={(text) => {
              setEditMealSupplement(text);
              setEditSelectedSupplementId(null);
            }}
            placeholder="沒有合適選項才輸入新補充品"
          />
          <Text style={styles.editorHelper}>
            第一次輸入後會自動加入主子的常用補充品清單。
          </Text>
        </>
      );
    }

    if (editTarget.kind === "water") {
      return (
        <>
          <Text style={styles.editorLabel}>紀錄時間</Text>
          <TouchableOpacity
            style={styles.editorTimeTrigger}
            onPress={() => showPicker("water")}
          >
            <View>
              <Text style={styles.editorTimeTriggerLabel}>選擇飲水時間</Text>
              <Text style={styles.editorTimeTriggerValue}>
                {formatTimeInput(editEntryTime)}
              </Text>
            </View>
            <Entypo name="clock" size={18} color="#0ea5e9" />
          </TouchableOpacity>

          <Text style={styles.editorLabel}>已喝水量（ml）</Text>
          <TextInput
            style={styles.editorInput}
            value={editWaterMl}
            onChangeText={setEditWaterMl}
            keyboardType="number-pad"
            placeholder="例如 120"
          />
          <Text style={styles.editorHelper}>
            這裡修改的是{activePet?.name ?? "主子"} 已喝的毫升數。
          </Text>
        </>
      );
    }

    if (editTarget.kind === "litter") {
      return (
        <>
          <Text style={styles.editorLabel}>種類</Text>
          <View style={styles.segmentRow}>
            {(["wee", "poo"] as LitterKind[]).map((kind) => (
              <TouchableOpacity
                key={kind}
                style={[
                  styles.segmentBtn,
                  editLitterKind === kind && styles.segmentBtnActive,
                ]}
                onPress={() => setEditLitterKind(kind)}
              >
                <Text
                  style={[
                    styles.segmentBtnText,
                    editLitterKind === kind && styles.segmentBtnTextActive,
                  ]}
                >
                  {LITTER_KIND_LABELS[kind]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.editorLabel}>數量</Text>
          <View style={styles.counterRow}>
            <TouchableOpacity
              style={styles.counterBtn}
              onPress={() =>
                setEditLitterCount(
                  String(Math.max(1, parseInt(editLitterCount || "1", 10) - 1)),
                )
              }
            >
              <Text style={styles.counterBtnText}>－</Text>
            </TouchableOpacity>
            <Text style={styles.counterValue}>{editLitterCount}</Text>
            <TouchableOpacity
              style={styles.counterBtn}
              onPress={() =>
                setEditLitterCount(
                  String(Math.min(9, parseInt(editLitterCount || "1", 10) + 1)),
                )
              }
            >
              <Text style={styles.counterBtnText}>＋</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.editorLabel}>大小</Text>
          <View style={styles.segmentRow}>
            {LITTER_SIZE_OPTIONS.map((size) => (
              <TouchableOpacity
                key={size}
                style={[
                  styles.segmentBtn,
                  editLitterSize === size && styles.segmentBtnActive,
                ]}
                onPress={() => setEditLitterSize(size)}
              >
                <Text
                  style={[
                    styles.segmentBtnText,
                    editLitterSize === size && styles.segmentBtnTextActive,
                  ]}
                >
                  {LITTER_SIZE_LABELS[size]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {editLitterKind === "poo" ? (
            <>
              <Text style={styles.editorLabel}>狀態</Text>
              <View style={styles.segmentRow}>
                {LITTER_CONDITION_OPTIONS.map((condition) => (
                  <TouchableOpacity
                    key={condition}
                    style={[
                      styles.segmentBtn,
                      editLitterCondition === condition &&
                        styles.segmentBtnActive,
                    ]}
                    onPress={() => setEditLitterCondition(condition)}
                  >
                    <Text
                      style={[
                        styles.segmentBtnText,
                        editLitterCondition === condition &&
                          styles.segmentBtnTextActive,
                      ]}
                    >
                      {LITTER_CONDITION_LABELS[condition]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : null}
        </>
      );
    }

    if (editTarget.kind === "care") {
      return (
        <>
          <Text style={styles.editorLabel}>護理類型</Text>
          <View style={styles.choiceGrid}>
            {CARE_ACTIONS.map((action) => (
              <TouchableOpacity
                key={action}
                style={[
                  styles.choiceChip,
                  editCareAction === action && styles.choiceChipActive,
                ]}
                onPress={() => setEditCareAction(action)}
              >
                <Text style={styles.choiceChipIcon}>
                  {CARE_ACTION_ICONS[action]}
                </Text>
                <Text
                  style={[
                    styles.choiceChipText,
                    editCareAction === action && styles.choiceChipTextActive,
                  ]}
                >
                  {CARE_ACTION_LABELS[action]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.editorLabel}>備註</Text>
          <TextInput
            style={[styles.editorInput, styles.editorTextarea]}
            value={editCareNote}
            onChangeText={setEditCareNote}
            placeholder="例如：已滴頸除蚤、下次覆診日期..."
            multiline
          />
        </>
      );
    }

    return (
      <>
        <Text style={styles.editorLabel}>今日狀態</Text>
        <View style={styles.choiceGrid}>
          {MOODS.map((mood) => (
            <TouchableOpacity
              key={mood}
              style={[
                styles.choiceChip,
                editJournalMood === mood && styles.choiceChipActive,
              ]}
              onPress={() => setEditJournalMood(mood)}
            >
              <Text style={styles.choiceChipIcon}>{MOOD_ICONS[mood]}</Text>
              <Text
                style={[
                  styles.choiceChipText,
                  editJournalMood === mood && styles.choiceChipTextActive,
                ]}
              >
                {MOOD_LABELS[mood]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.editorLabel}>日記內容</Text>
        <TextInput
          style={[styles.editorInput, styles.editorTextarea]}
          value={editJournalNote}
          onChangeText={setEditJournalNote}
          placeholder="更新今天的觀察..."
          multiline
        />
        <Text style={styles.editorHelper}>
          照片會保留；這裡只編輯心情與文字。
        </Text>
      </>
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadLog();
    setRefreshing(false);
  };

  return (
    <View style={styles.screen}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
      >
        <Entypo name="chevron-left" size={24} color="#111827" />
      </TouchableOpacity>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#7FA655"
          />
        }
      >
        <View style={styles.heroCard}>
          <View style={styles.heroGlowPrimary} />
          <View style={styles.heroGlowSecondary} />
          <View style={styles.heroContent}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroTitleWrap}>
                <Text style={styles.heroTitle}>{formattedDate}</Text>
                <Text style={styles.heroSubtitle}>
                  {activePet?.name ?? "主子"} 的飲食、護理與日記都整理在這裡。
                </Text>
              </View>
            </View>

            <View style={styles.summaryGrid}>
              {summaryCards.map((card) => (
                <View key={card.key} style={styles.summaryCard}>
                  <View style={styles.summaryCardTopRow}>
                    <View style={styles.summaryIconWrap}>
                      <Text style={styles.summaryIcon}>{card.icon}</Text>
                    </View>
                    <View
                      style={[
                        styles.summaryAccentDot,
                        { backgroundColor: card.accent },
                      ]}
                    />
                  </View>
                  <Text style={[styles.summaryValue, { color: card.accent }]}>
                    {card.value}
                  </Text>
                  <Text style={styles.summaryLabel}>{card.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {sections.map((section) => {
          // Add kcal calculation and display for the 餵食 section
          let totalKcal = null;
          if (section.key === "meal") {
            totalKcal = section.data.reduce(
              (sum, item) =>
                sum +
                (item.kind === "meal"
                  ? calculateMealKcalFromEntry(item.data)
                  : 0),
              0,
            );
          }
          return (
            <View key={section.key} style={styles.sectionCard}>
              <View style={styles.sectionTopRow}>
                <View style={styles.sectionTitleRow}>
                  <View
                    style={[
                      styles.sectionIconWrap,
                      {
                        backgroundColor: section.tint,
                        borderColor: section.tint,
                      },
                    ]}
                  >
                    <Text style={styles.sectionIcon}>{section.icon}</Text>
                  </View>
                  <View style={styles.sectionTextWrap}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                    <Text style={styles.sectionSubtitle}>
                      {section.key === "journal"
                        ? "日記可直接編輯或刪除；其餘卡片可左滑操作"
                        : `${section.subtitle} · 左滑可操作`}
                    </Text>
                    <View
                      style={[
                        styles.sectionAccentLine,
                        { backgroundColor: section.accent },
                      ]}
                    />
                  </View>
                </View>
                <View
                  style={[
                    styles.sectionCountPill,
                    { backgroundColor: section.tint },
                  ]}
                >
                  <Text
                    style={[styles.sectionCountText, { color: section.accent }]}
                  >
                    {getSectionCountLabel(section.key, section.data.length)}
                  </Text>
                </View>
              </View>

              {/* Show kcal summary for meal section */}
              {section.key === "meal" && (
                <View style={styles.kcalSummaryCard}>
                  <Text style={styles.kcalSummaryEyebrow}>今日總熱量</Text>
                  <Text style={styles.kcalSummaryValue}>{totalKcal} kcal</Text>
                  <Text style={styles.kcalSummaryHint}>
                    依照今天已記錄的餐點自動加總。
                  </Text>
                </View>
              )}

              <View style={styles.sectionBody}>
                {section.data.map((item, index) =>
                  renderTimelineItem(
                    item,
                    section,
                    index,
                    index === section.data.length - 1,
                  ),
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <Modal
        visible={photoModalUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoModalUri(null)}
        statusBarTranslucent
      >
        <SafeAreaView style={styles.photoModal}>
          <StatusBar barStyle="light-content" backgroundColor="#000" />
          {photoModalUri && (
            <Image
              source={{ uri: photoModalUri }}
              style={styles.photoModalImage}
              resizeMode="contain"
            />
          )}
          <TouchableOpacity
            style={styles.photoModalClose}
            onPress={() => setPhotoModalUri(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.photoModalCloseText}>✕</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={editTarget !== null}
        transparent
        animationType="slide"
        onRequestClose={closeEditSheet}
      >
        <View style={styles.editorOverlay}>
          <KeyboardAvoidingView
            style={styles.editorKeyboardWrap}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <SafeAreaView style={styles.editorSheet}>
              {/* Custom Time Picker inside the main edit modal to ensure visibility */}
              <EditTimePickerModal
                visible={editTimePickerTarget !== null}
                initialValue={editEntryTime}
                onCancel={closeEditTimePicker}
                onConfirm={(nextValue) => {
                  setEditEntryTime(nextValue);
                  closeEditTimePicker();
                }}
                title={
                  editTimePickerTarget === "meal"
                    ? "選擇餵食時間"
                    : "選擇飲水時間"
                }
              />

              <View style={styles.editorContentWrap}>
                <View style={styles.editorHeader}>
                  <View>
                    <Text style={styles.editorTitle}>編輯紀錄</Text>
                  </View>
                  <TouchableOpacity
                    onPress={closeEditSheet}
                    style={styles.editorCloseBtn}
                  >
                    <Entypo name="cross" size={20} color="#6b7280" />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  style={styles.editorBody}
                  contentContainerStyle={styles.editorBodyContent}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {renderEditBody()}
                </ScrollView>
              </View>
              <View style={styles.editorFooter}>
                <TouchableOpacity
                  style={styles.editorSecondaryBtn}
                  onPress={closeEditSheet}
                  disabled={editSaving}
                >
                  <Text style={styles.editorSecondaryBtnText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.editorPrimaryBtn}
                  onPress={handleSaveEdit}
                  disabled={editSaving}
                >
                  <Text style={styles.editorPrimaryBtnText}>
                    {editSaving ? "儲存中..." : "儲存修改"}
                  </Text>
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F7F4EB",
  },
  container: {
    flex: 1,
    backgroundColor: "#F7F4EB",
  },
  content: {
    padding: 20,
    paddingTop: SCREEN_TOP_CONTENT_PADDING,
    paddingBottom: 120,
    gap: 18,
  },
  stateScreen: {
    flex: 1,
    backgroundColor: "#F7F4EB",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  backButton: {
    position: "absolute",
    top: 52,
    left: 16,
    zIndex: 10,
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
  stateCard: {
    width: "100%",
    borderRadius: 24,
    backgroundColor: "#fff",
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 10,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  stateEmoji: {
    fontSize: 36,
  },
  stateTitle: {
    fontSize: 20,
    color: "#111827",
    fontFamily: "ZenMaruGothic-Bold",
  },
  stateText: {
    fontSize: 14,
    lineHeight: 22,
    color: "#6b7280",
    textAlign: "center",
    fontFamily: "ZenMaruGothic-Regular",
  },
  heroCard: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 28,
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
    top: -28,
    right: -10,
    width: 150,
    height: 150,
    borderRadius: 999,
    backgroundColor: "rgba(127, 166, 85, 0.22)",
  },
  heroGlowSecondary: {
    position: "absolute",
    bottom: -58,
    left: -32,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(14, 165, 233, 0.16)",
  },
  heroContent: {
    gap: 18,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  heroTitleWrap: {
    flex: 1,
    gap: 6,
  },
  heroEyebrow: {
    fontSize: 12,
    color: "#d8eee8",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    fontFamily: "ZenMaruGothic-Medium",
  },
  heroTitle: {
    fontSize: 26,
    lineHeight: 34,
    color: "#fff",
    fontFamily: "ZenMaruGothic-Bold",
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    color: "rgba(255,253,246,0.82)",
    fontFamily: "ZenMaruGothic-Regular",
  },
  heroBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "rgba(255,253,246,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,253,246,0.18)",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  heroBadgeText: {
    fontSize: 12,
    color: "#fff",
    fontFamily: "ZenMaruGothic-Medium",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  summaryCard: {
    width: "47%",
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,253,246,0.18)",
    backgroundColor: "rgba(255,253,246,0.14)",
  },
  summaryCardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: "rgba(255,253,246,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  summaryIcon: {
    fontSize: 18,
  },
  summaryAccentDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  summaryValue: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: "ZenMaruGothic-Bold",
  },
  summaryLabel: {
    fontSize: 12,
    color: "rgba(255,253,246,0.76)",
    fontFamily: "ZenMaruGothic-Medium",
  },
  sectionCard: {
    borderRadius: 24,
    backgroundColor: "#FFF9EF",
    padding: 18,
    gap: 16,
    borderWidth: 1,
    borderColor: "#DDD2C3",
    shadowColor: "#2c231a",
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  sectionTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  sectionTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sectionIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  sectionIcon: {
    fontSize: 22,
  },
  sectionTextWrap: {
    flex: 1,
    gap: 5,
  },
  sectionTitle: {
    fontSize: 18,
    color: "#111827",
    fontFamily: "ZenMaruGothic-Bold",
  },
  sectionSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: "#6b7280",
    fontFamily: "ZenMaruGothic-Regular",
  },
  sectionAccentLine: {
    width: 28,
    height: 3,
    borderRadius: 999,
  },
  sectionCountPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(23,36,33,0.06)",
  },
  sectionCountText: {
    fontSize: 12,
    fontFamily: "ZenMaruGothic-Medium",
  },
  kcalSummaryCard: {
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#FFFDF7",
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    gap: 4,
  },
  kcalSummaryEyebrow: {
    fontSize: 11,
    color: "#2E7A70",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    fontFamily: "ZenMaruGothic-Medium",
  },
  kcalSummaryValue: {
    fontSize: 22,
    color: "#172421",
    fontFamily: "ZenMaruGothic-Bold",
  },
  kcalSummaryHint: {
    fontSize: 12,
    lineHeight: 18,
    color: "#6E7C74",
    fontFamily: "ZenMaruGothic-Regular",
  },
  sectionBody: {
    gap: 10,
  },
  timelineItem: {
    flexDirection: "row",
    gap: 14,
    alignItems: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#EEE7DB",
  },
  timelineItemSpacing: {
    paddingBottom: 0,
  },
  timelineIconWrap: {
    width: 39,
    height: 39,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineIcon: {
    fontSize: 20,
  },
  timelineBody: {
    flex: 1,
    gap: 6,
  },
  timelineRowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  timelineTitle: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    color: "#172421",
    fontFamily: "ZenMaruGothic-Bold",
  },
  timelineMeta: {
    fontSize: 12,
    lineHeight: 19,
    color: "#6E7C74",
    fontFamily: "ZenMaruGothic-Regular",
  },
  timePill: {
    minWidth: 54,
    alignItems: "flex-end",
    paddingTop: 2,
  },
  timePillText: {
    fontSize: 13,
    color: "#2E7A70",
    fontFamily: "ZenMaruGothic-Bold",
  },
  scheduleFromBadge: {
    backgroundColor: "#E8F5E8",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(37,139,92,0.16)",
  },
  scheduleFromBadgeText: {
    fontSize: 11,
    color: "#258B5C",
    fontFamily: "ZenMaruGothic-Medium",
  },
  swipeAction: {
    width: 88,
    height: "100%",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginLeft: 10,
    paddingHorizontal: 8,
  },
  swipeActionsWrap: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  swipeDeleteAction: {
    backgroundColor: "#dc2626",
  },
  swipeActionText: {
    fontSize: 12,
    color: "#fff",
    fontFamily: "ZenMaruGothic-Bold",
  },
  journalCard: {
    gap: 14,
  },
  journalTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
  },
  journalMoodWrap: {
    flex: 1,
    flexDirection: "row",
    gap: 12,
  },
  journalMetaBlock: {
    flex: 1,
    gap: 2,
  },
  journalActions: {
    alignItems: "flex-end",
    gap: 8,
  },
  inlineEditBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#f5f3ff",
  },
  inlineEditBtnText: {
    fontSize: 12,
    color: "#8b5cf6",
    fontFamily: "ZenMaruGothic-Bold",
  },
  inlineDeleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "#fef2f2",
  },
  inlineDeleteBtnText: {
    fontSize: 12,
    color: "#dc2626",
    fontFamily: "ZenMaruGothic-Bold",
  },
  journalNoteCard: {
    borderRadius: 18,
    backgroundColor: "#f8fafc",
    padding: 14,
    marginLeft: -50,
    marginTop: 5,
  },
  journalNoteText: {
    fontSize: 14,
    lineHeight: 22,
    color: "#374151",
    fontFamily: "ZenMaruGothic-Regular",
  },
  journalPhotoWrap: {
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#e5e7eb",
  },
  journalThumb: {
    width: "100%",
    height: 220,
  },
  photoHint: {
    position: "absolute",
    left: 12,
    bottom: 12,
    borderRadius: 999,
    backgroundColor: "rgba(17,24,39,0.72)",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  photoHintText: {
    fontSize: 12,
    color: "#fff",
    fontFamily: "ZenMaruGothic-Medium",
  },
  photoModal: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  photoModalImage: {
    width: "100%",
    height: "80%",
  },
  photoModalClose: {
    position: "absolute",
    top: 52,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  photoModalCloseText: {
    fontSize: 18,
    color: "#fff",
    fontFamily: "ZenMaruGothic-Bold",
  },
  editorOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.34)",
    justifyContent: "flex-end",
  },
  pickerOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  pickerSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  pickerTitle: {
    fontSize: 18,
    color: "#111827",
    fontFamily: "ZenMaruGothic-Bold",
  },
  pickerCloseText: {
    fontSize: 14,
    color: "#6b7280",
    fontFamily: "ZenMaruGothic-Regular",
  },
  pickerActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  pickerActionBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  pickerClearBtn: {
    backgroundColor: "#f3f4f6",
  },
  pickerConfirmBtn: {
    backgroundColor: "#7FA655",
  },
  pickerClearText: {
    color: "#4b5563",
    fontSize: 15,
    fontFamily: "ZenMaruGothic-Regular",
  },
  pickerConfirmText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "ZenMaruGothic-Bold",
  },
  editorKeyboardWrap: {
    flex: 1,
    justifyContent: "flex-end",
  },
  editorSheet: {
    maxHeight: "86%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 14,
  },
  editorContentWrap: {
    paddingHorizontal: 25,
    paddingTop: 20,
    flexShrink: 1,
  },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  editorTitle: {
    fontSize: 20,
    color: "#111827",
    fontFamily: "ZenMaruGothic-Bold",
  },
  editorSubtitle: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: 2,
    fontFamily: "ZenMaruGothic-Regular",
  },
  editorCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
  },
  editorBody: {
    flexGrow: 0,
    flexShrink: 1,
  },
  editorBodyContent: {
    gap: 12,
    paddingBottom: 12,
  },
  editorLabel: {
    fontSize: 14,
    color: "#374151",
    fontFamily: "ZenMaruGothic-Bold",
  },
  editorInput: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#fff",
    fontFamily: "ZenMaruGothic-Regular",
  },
  editorTimeTrigger: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
  },
  editorTimeTriggerLabel: {
    fontSize: 12,
    color: "#6b7280",
    fontFamily: "ZenMaruGothic-Regular",
  },
  editorTimeTriggerValue: {
    marginTop: 2,
    fontSize: 15,
    color: "#111827",
    fontFamily: "ZenMaruGothic-Bold",
  },
  editorTextarea: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  editorHelper: {
    fontSize: 12,
    lineHeight: 18,
    color: "#6b7280",
    fontFamily: "ZenMaruGothic-Regular",
  },
  segmentRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  segmentBtn: {
    flex: 1,
    minWidth: 88,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  segmentBtnActive: {
    borderColor: "#7FA655",
    backgroundColor: "#7FA655",
  },
  segmentBtnText: {
    fontSize: 13,
    color: "#6b7280",
    fontFamily: "ZenMaruGothic-Bold",
  },
  segmentBtnTextActive: {
    color: "#fff",
  },
  editorFoodChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  editorFoodChip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  editorFoodChipActive: {
    backgroundColor: "#7FA655",
    borderColor: "#7FA655",
  },
  editorFoodChipText: {
    fontSize: 13,
    color: "#4b5563",
    fontFamily: "ZenMaruGothic-Bold",
  },
  editorFoodChipTextActive: {
    color: "#fff",
  },
  counterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  counterBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#7FA655",
    alignItems: "center",
    justifyContent: "center",
  },
  counterBtnText: {
    fontSize: 24,
    color: "#fff",
    fontFamily: "ZenMaruGothic-Bold",
  },
  counterValue: {
    fontSize: 18,
    minWidth: 36,
    textAlign: "center",
    color: "#111827",
    fontFamily: "ZenMaruGothic-Bold",
  },
  choiceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  choiceChip: {
    width: "31%",
    minWidth: 92,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff",
  },
  choiceChipActive: {
    borderColor: "#111827",
    backgroundColor: "#f8fafc",
  },
  choiceChipIcon: {
    fontSize: 22,
  },
  choiceChipText: {
    fontSize: 12,
    textAlign: "center",
    color: "#6b7280",
    fontFamily: "ZenMaruGothic-Bold",
  },
  choiceChipTextActive: {
    color: "#111827",
  },
  editorFooter: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 25,
    paddingBottom: 20,
    paddingTop: 4,
  },
  editorSecondaryBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#f3f4f6",
  },
  editorSecondaryBtnText: {
    fontSize: 15,
    color: "#374151",
    fontFamily: "ZenMaruGothic-Bold",
  },
  editorPrimaryBtn: {
    flex: 1.3,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#111827",
  },
  editorPrimaryBtnText: {
    fontSize: 15,
    color: "#fff",
    fontFamily: "ZenMaruGothic-Bold",
  },
});
