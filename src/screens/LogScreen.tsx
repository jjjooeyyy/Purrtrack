import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { StackNavigationProp } from "@react-navigation/stack";
import * as ImagePicker from "expo-image-picker";
import {
  arrayUnion,
  deleteField,
  doc,
  getDoc,
  increment,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import {
  CARE_ACTION_ICONS,
  CARE_ACTION_LABELS,
  LITTER_CONDITION_LABELS,
  LITTER_KIND_LABELS,
  LITTER_SIZE_DESCRIPTIONS,
  LITTER_SIZE_LABELS,
  MEAL_CATEGORY_ICONS,
  MEAL_CATEGORY_LABELS,
  MOOD_ICONS,
  MOOD_LABELS,
  WATER_PRESET_LABELS,
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
  mergeFoodCatalogs,
  mergeSupplementCatalogs,
  normalizeFoodName,
  removeFoodCatalogItem,
  upsertFoodCatalogItem,
  upsertSupplementCatalogItem,
} from "../lib/mealCatalog";
import {
  calculateMealKcal,
  calculateMealKcalFromEntry,
  DEFAULT_KCAL_UNIT,
  formatKcalUnit,
  getKcalInputLabel,
  getKcalPlaceholder,
  KCAL_UNITS,
} from "../lib/mealKcal";
import { LogStackParamList, LogTab } from "../navigator/MainTabNavigator";
import {
  DailyLog,
  FoodPreference,
  KcalUnit,
  MealCategory,
  MealEntry,
  SavedFood,
  SavedSupplement,
  SharedPetProfile,
} from "../types";

type Tab = LogTab;
const LOG_TAB_META: Record<
  Tab,
  { title: string; icon: string; description: string }
> = {
  meal: {
    title: "餵食",
    icon: "🍽️",
    description: "記錄主子今天實際吃了什麼、吃了幾多。",
  },
  water: {
    title: "飲水",
    icon: "💧",
    description: "記錄今天的喝水量和補水狀態。",
  },
  litter: {
    title: "去廁所",
    icon: "🚽",
    description: "記錄如廁次數、大小和狀態變化。",
  },
  care: {
    title: "護理",
    icon: "🩺",
    description: "記錄今天做過的護理和醫療安排。",
  },
  journal: {
    title: "日記",
    icon: "📔",
    description: "補上主子的心情、觀察和照片筆記。",
  },
};
const LOG_TAB_THEME: Record<Tab, { accent: string; background: string }> = {
  meal: { accent: "#258B5C", background: "#E8F5E8" },
  water: { accent: "#3279D8", background: "#E8F1FF" },
  litter: { accent: "#B97818", background: "#FFF1D6" },
  care: { accent: "#7B5AD9", background: "#F0EAFF" },
  journal: { accent: "#D8516D", background: "#FFE9EE" },
};
type WaterSource = "preset" | "drag" | "manual";
type MealCategoryState = MealCategory | null;
type SavedPickerTarget = "food" | "supplement" | null;
type LitterKind = "wee" | "poo";
type LitterSize = "small" | "medium" | "large" | "extraLarge";
type LitterCondition = "hard" | "normal" | "soft";
type CareAction =
  | "nail_cut"
  | "flea_treatment"
  | "vet_visit"
  | "vaccine"
  | "brushTeeth"
  | "bath"
  | "grooming"
  | "other";
type Mood = "energetic" | "playful" | "normal" | "tired" | "anxious" | "sick";
type Navigation = StackNavigationProp<LogStackParamList, "LogMain">;
type LogScreenRoute = RouteProp<LogStackParamList, "LogMain">;

type TimePickerField = "meal" | "water" | "litter" | "care" | "journal";
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => index);
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => index);
const TIME_PICKER_BASE_YEAR = 2001;
const TIME_PICKER_BASE_MONTH = 0;
const TIME_PICKER_BASE_DAY = 1;

const CARE_ACTIONS: CareAction[] = [
  "nail_cut",
  "flea_treatment",
  "vet_visit",
  "vaccine",
  "brushTeeth",
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
const MEAL_CATEGORIES: MealCategory[] = ["dry", "wet", "snack"];

const WATER_MIN = 0;
const WATER_MAX = 1000;
const WATER_STEP = 15;
const WATER_BOWL_WIDTH = 80;
const WATER_BOWL_HEIGHT = 120;
const WATER_HANDLE_SIZE = 30;
const WATER_LINE_HEIGHT = 2;
const WATER_SURFACE_TRAVEL = WATER_BOWL_HEIGHT - WATER_LINE_HEIGHT;
const WATER_PRESETS = [50, 100, 150, 200, 350] as const;

const LITTER_COUNT_MIN = 1;
const LITTER_COUNT_MAX = 10;
const LITTER_SIZE_OPTIONS = [
  "small",
  "medium",
  "large",
  "extraLarge",
] as const satisfies readonly LitterSize[];
const LITTER_CONDITION_OPTIONS = [
  "hard",
  "normal",
  "soft",
] as const satisfies readonly LitterCondition[];
const FOOD_PREFERENCE_OPTIONS = [
  "like",
  "neutral",
  "dislike",
] as const satisfies readonly FoodPreference[];
const FOOD_PREFERENCE_LABELS: Record<FoodPreference, string> = {
  like: "鍾意",
  neutral: "一般",
  dislike: "唔鍾意",
};
const FOOD_PREFERENCE_ICONS: Record<FoodPreference, string> = {
  like: "😋",
  neutral: "😐",
  dislike: "🤢",
};

function formatDate(d: Date) {
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundToStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

function createDefaultTime() {
  const date = new Date();
  return normalizeTimeValue(date);
}

function formatTimeInput(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

function buildTimeValue(hours: number, minutes: number) {
  return new Date(
    TIME_PICKER_BASE_YEAR,
    TIME_PICKER_BASE_MONTH,
    TIME_PICKER_BASE_DAY,
    hours,
    minutes,
    0,
    0,
  );
}

function normalizeTimeValue(date: Date) {
  return buildTimeValue(date.getHours(), date.getMinutes());
}

function buildTimestampForDate(date: string, timeValue: Date) {
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

function isSameMealWindow(
  meal: { time: Timestamp },
  scheduledAt: Date,
): boolean {
  const diff = Math.abs(meal.time.toDate().getTime() - scheduledAt.getTime());
  return diff <= 30 * 60 * 1000;
}

function truncateChipText(name: string, max = 12) {
  return name.length > max ? name.slice(0, max) + "…" : name;
}

function getFoodPreferenceBadgeStyle(preference: FoodPreference) {
  if (preference === "like") {
    return {
      container: styles.foodPreferenceBadgeLike,
      text: styles.foodPreferenceBadgeTextLike,
    };
  }
  if (preference === "dislike") {
    return {
      container: styles.foodPreferenceBadgeDislike,
      text: styles.foodPreferenceBadgeTextDislike,
    };
  }
  return {
    container: styles.foodPreferenceBadgeNeutral,
    text: styles.foodPreferenceBadgeTextNeutral,
  };
}

function getTimeForTarget(
  target: TimePickerField,
  times: Record<TimePickerField, Date>,
) {
  return times[target];
}

export default function LogScreen() {
  type TimePickerTarget = TimePickerField | null;
  const navigation = useNavigation<Navigation>();
  const route = useRoute<LogScreenRoute>();
  const { user, profile, pets, activePet, refresh, updateSharedCatalogs } =
    usePetSession();
  const [activeTab, setActiveTab] = useState<Tab>("meal");
  const [saving, setSaving] = useState(false);
  const [tabDates, setTabDates] = useState<Record<Tab, Date>>(() => ({
    meal: new Date(),
    water: new Date(),
    litter: new Date(),
    care: new Date(),
    journal: new Date(),
  }));

  // --- Midnight auto-update: ensure tabDates always reflect the current day ---
  useEffect(() => {
    // Helper to get start of today (local time)
    function getToday() {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    // Calculate ms until next midnight
    function msUntilNextMidnight() {
      const now = new Date();
      const next = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      return next.getTime() - now.getTime();
    }
    // Set timer to update all tabDates to today at next midnight
    const timer = setTimeout(() => {
      setTabDates((prev) => {
        const today = getToday();
        // Only update if any tab is not today
        const needsUpdate = Object.values(prev).some(
          (d) =>
            d.getFullYear() !== today.getFullYear() ||
            d.getMonth() !== today.getMonth() ||
            d.getDate() !== today.getDate(),
        );
        if (!needsUpdate) return prev;
        // Set all tabs to today
        return {
          meal: today,
          water: today,
          litter: today,
          care: today,
          journal: today,
        };
      });
    }, msUntilNextMidnight() + 1000); // +1s buffer
    return () => clearTimeout(timer);
  }, [tabDates]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [todayLog, setTodayLog] = useState<DailyLog | null>(null);
  const [loadingTodayLog, setLoadingTodayLog] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const activeLogDate = tabDates[activeTab];

  useEffect(() => {
    const requestedTab = route.params?.initialTab;
    if (requestedTab) {
      setActiveTab(requestedTab);
    }
  }, [route.params?.initialTab]);

  useEffect(() => {
    const requestedTab = route.params?.initialTab;
    if (!requestedTab) {
      return;
    }

    setActiveTab(requestedTab);
    navigation.setParams({ initialTab: undefined });
  }, [navigation, route.params?.initialTab]);

  useEffect(() => {
    if (!route.params?.openFoodCatalogManager) {
      return;
    }

    setActiveTab("meal");
    setFoodCatalogVisible(true);
    navigation.setParams({ openFoodCatalogManager: undefined });
  }, [navigation, route.params?.openFoodCatalogManager]);

  // Meal fields
  const [mealGrams, setMealGrams] = useState("");
  const [mealCategory, setMealCategory] = useState<MealCategoryState>(null);
  const [foodName, setFoodName] = useState("");
  const [mealSupplement, setMealSupplement] = useState("");
  const [mealFoodPreference, setMealFoodPreference] =
    useState<FoodPreference | null>(null);
  const [mealKcalAmount, setMealKcalAmount] = useState("");
  const [mealKcalUnit, setMealKcalUnit] = useState<KcalUnit>(DEFAULT_KCAL_UNIT);

  // ...existing useState and variable declarations...

  // Selectors for food and supplement items (must be after all state declarations)

  // ...existing useState and variable declarations...

  // If a saved food is selected and has kcal info, use it
  const [selectedFoodId, setSelectedFoodId] = useState<string | null>(null);
  const [selectedSupplementId, setSelectedSupplementId] = useState<
    string | null
  >(null);
  const [foodCatalog, setFoodCatalog] = useState<SavedFood[]>([]);
  const [supplementCatalog, setSupplementCatalog] = useState<SavedSupplement[]>(
    [],
  );
  const [foodCatalogVisible, setFoodCatalogVisible] = useState(false);
  const [savedPickerTarget, setSavedPickerTarget] =
    useState<SavedPickerTarget>(null);
  const [timePickerTarget, setTimePickerTarget] =
    useState<TimePickerTarget>(null);
  const [pickerValue, setPickerValue] = useState(createDefaultTime);
  const [catalogCategory, setCatalogCategory] = useState<MealCategory>("wet");
  const [catalogName, setCatalogName] = useState("");
  const [catalogPreference, setCatalogPreference] =
    useState<FoodPreference | null>(null);
  const [catalogEditingId, setCatalogEditingId] = useState<string | null>(null);
  // Kcal fields for manage food modal
  const [catalogKcalAmount, setCatalogKcalAmount] = useState<
    number | undefined
  >(undefined);
  const [catalogKcalUnit, setCatalogKcalUnit] =
    useState<KcalUnit>(DEFAULT_KCAL_UNIT);

  // Water fields
  const [waterMl, setWaterMl] = useState<number | null>(null);
  const [waterText, setWaterText] = useState("");
  const [waterSource, setWaterSource] = useState<WaterSource>("preset");
  const [waterDragActive, setWaterDragActive] = useState(false);
  const [mealTime, setMealTime] = useState(createDefaultTime);
  const [waterTime, setWaterTime] = useState(createDefaultTime);
  const [litterTime, setLitterTime] = useState(createDefaultTime);
  const [careTime, setCareTime] = useState(createDefaultTime);
  const [journalTime, setJournalTime] = useState(createDefaultTime);
  const waterMlRef = useRef(waterMl);
  const dragStartWaterRef = useRef(waterMl);

  // Litter fields
  const [litterKind, setLitterKind] = useState<LitterKind>("wee");
  const [litterCount, setLitterCount] = useState(1);
  const [litterSize, setLitterSize] = useState<LitterSize>("medium");
  const [litterCondition, setLitterCondition] =
    useState<LitterCondition>("normal");

  // Care fields
  const [careAction, setCareAction] = useState<CareAction>("nail_cut");
  const [careNote, setCareNote] = useState("");

  // Journal fields
  const [journalMood, setJournalMood] = useState<Mood>("normal");
  const [journalNote, setJournalNote] = useState("");
  const [journalPhotoUri, setJournalPhotoUri] = useState<string | null>(null);

  // Selectors for food and supplement items (must be after all state declarations)
  const filteredSavedFoods =
    mealCategory === null
      ? []
      : foodCatalog.filter((item) => item.category === mealCategory);
  const savedSupplements = supplementCatalog;
  const selectedFoodItem =
    selectedFoodId === null
      ? null
      : (filteredSavedFoods.find((item) => item.id === selectedFoodId) ?? null);
  const selectedSupplementItem =
    selectedSupplementId === null
      ? null
      : (savedSupplements.find((item) => item.id === selectedSupplementId) ??
        null);

  // If a saved food is selected and has kcal info, use it
  const selectedFoodKcalAmount =
    selectedFoodItem && typeof selectedFoodItem.kcalAmount === "number"
      ? selectedFoodItem.kcalAmount
      : undefined;
  const selectedFoodKcalUnit =
    selectedFoodItem && selectedFoodItem.kcalUnit
      ? selectedFoodItem.kcalUnit
      : undefined;
  // Only hide kcal input if the selected food has a positive kcal value
  const shouldShowKcalInput = !(
    selectedFoodItem &&
    typeof selectedFoodItem.kcalAmount === "number" &&
    selectedFoodItem.kcalAmount > 0
  );

  useEffect(() => {
    const allPetFoodCatalog = pets.flatMap((pet) =>
      (pet.foodCatalog ?? []).map(
        ({ id, name, category, brandName, kcalAmount, kcalUnit }) => ({
          id,
          name,
          category,
          ...(brandName ? { brandName } : {}),
          ...(typeof kcalAmount === "number" ? { kcalAmount } : {}),
          ...(kcalUnit ? { kcalUnit } : {}),
        }),
      ),
    );
    const allPetSupplementCatalog = pets.flatMap(
      (pet) => pet.supplementCatalog ?? [],
    );

    const merged = mergeFoodCatalogs(
      mergeFoodCatalogs(profile?.sharedFoodCatalog ?? [], allPetFoodCatalog),
      activePet?.foodCatalog ?? [],
    );
    setFoodCatalog((prev) =>
      JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged,
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

  // Fetch log for selected date
  useEffect(() => {
    if (!user || !activePet) {
      setTodayLog(null);
      return;
    }

    const fetchLog = async () => {
      try {
        setLoadingTodayLog(true);
        const dateStr = formatDate(tabDates.meal);
        const logRef = doc(db, "pets", activePet.id, "logs", dateStr);
        const logSnap = await getDoc(logRef);
        if (logSnap.exists()) {
          setTodayLog(logSnap.data() as DailyLog);
        } else {
          setTodayLog(null);
        }
      } catch (error) {
        console.error("Failed to fetch log:", error);
        setTodayLog(null);
      } finally {
        setLoadingTodayLog(false);
      }
    };

    fetchLog();
  }, [activePet, user, tabDates.meal]);

  waterMlRef.current = waterMl;

  const waterConsumedRatio =
    waterMl !== null ? (waterMl - WATER_MIN) / (WATER_MAX - WATER_MIN || 1) : 0;
  const waterSurfaceOffset = waterConsumedRatio * WATER_SURFACE_TRAVEL;
  const waterHandleTouchTop = clamp(
    waterSurfaceOffset - (WATER_HANDLE_SIZE - WATER_LINE_HEIGHT) / 2,
    0,
    WATER_BOWL_HEIGHT - WATER_HANDLE_SIZE,
  );

  const waterPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          setWaterDragActive(true);
          dragStartWaterRef.current = waterMlRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const travel = WATER_SURFACE_TRAVEL;
          const delta = (gestureState.dy * (WATER_MAX - WATER_MIN)) / travel;
          const base = dragStartWaterRef.current ?? WATER_MIN;
          const next = clamp(
            roundToStep(base + delta, WATER_STEP),
            WATER_MIN,
            WATER_MAX,
          );
          setWaterMl(next);
          setWaterText(String(next));
          setWaterSource("drag");
        },
        onPanResponderRelease: () => {
          setWaterDragActive(false);
        },
        onPanResponderTerminate: () => {
          setWaterDragActive(false);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [],
  );

  // ...existing code...
  const likedFoods = useMemo(
    () => foodCatalog.filter((item) => item.preference === "like"),
    [foodCatalog],
  );
  const dislikedFoods = useMemo(
    () => foodCatalog.filter((item) => item.preference === "dislike"),
    [foodCatalog],
  );
  const shouldShowFoodPreference = normalizeFoodName(foodName).length > 0;

  const currentMealKcal = useMemo(() => {
    const grams = parseFloat(mealGrams);
    let kcalAmount: number | undefined;
    let kcalUnit: KcalUnit = mealKcalUnit;
    if (selectedFoodKcalAmount) {
      kcalAmount = selectedFoodKcalAmount;
      kcalUnit = selectedFoodKcalUnit || DEFAULT_KCAL_UNIT;
    } else {
      kcalAmount = parseFloat(mealKcalAmount);
      kcalUnit = mealKcalUnit;
    }
    if (
      !isNaN(grams) &&
      grams > 0 &&
      typeof kcalAmount === "number" &&
      kcalAmount > 0
    ) {
      return calculateMealKcal(grams, kcalAmount, kcalUnit);
    }
    return 0;
  }, [
    mealGrams,
    mealKcalAmount,
    mealKcalUnit,
    selectedFoodKcalAmount,
    selectedFoodKcalUnit,
  ]);

  const todayTotalKcal = useMemo(() => {
    if (!todayLog || !todayLog.meals) return 0;
    return todayLog.meals.reduce((sum, meal: MealEntry) => {
      return sum + calculateMealKcalFromEntry(meal);
    }, 0);
  }, [todayLog]);

  const resetMealForm = () => {
    setMealGrams("");
    setMealCategory(null);
    setFoodName("");
    setMealSupplement("");
    setMealFoodPreference(null);
    setMealKcalAmount("");
    setMealKcalUnit(DEFAULT_KCAL_UNIT);
    setSelectedFoodId(null);
    setSelectedSupplementId(null);
    setMealTime(createDefaultTime());
  };

  const resetWaterForm = () => {
    setWaterMl(null);
    setWaterText("");
    setWaterSource("preset");
    setWaterTime(createDefaultTime());
  };

  const resetCatalogEditor = () => {
    setCatalogCategory(mealCategory ?? "wet");
    setCatalogName("");
    setCatalogPreference(null);
    setCatalogEditingId(null);
  };

  const openFoodCatalogManager = () => {
    navigation.navigate("FoodManagement");
  };

  const closeTimePicker = () => {
    setTimePickerTarget(null);
  };

  const setDateForTab = (tab: Tab, date: Date) => {
    setTabDates((current) => ({
      ...current,
      [tab]: date,
    }));
  };

  const openTimePicker = (target: Exclude<TimePickerTarget, null>) => {
    const baseTime = getTimeForTarget(target, {
      meal: mealTime,
      water: waterTime,
      litter: litterTime,
      care: careTime,
      journal: journalTime,
    });
    setPickerValue(normalizeTimeValue(baseTime));
    setTimePickerTarget(target);
  };

  const applyTimePickerValue = () => {
    const nextTime = normalizeTimeValue(pickerValue);

    if (timePickerTarget === "meal") {
      setMealTime(nextTime);
    } else if (timePickerTarget === "water") {
      setWaterTime(nextTime);
    } else if (timePickerTarget === "litter") {
      setLitterTime(nextTime);
    } else if (timePickerTarget === "care") {
      setCareTime(nextTime);
    } else if (timePickerTarget === "journal") {
      setJournalTime(nextTime);
    }
    closeTimePicker();
  };

  const closeSavedPicker = () => {
    setSavedPickerTarget(null);
  };

  const openSavedPicker = (target: Exclude<SavedPickerTarget, null>) => {
    if (target === "food" && mealCategory === null) {
      Alert.alert(
        "先選食物類別",
        "選定乾糧、濕糧或零食後，才可挑選常用食物名稱。",
      );
      return;
    }

    setSavedPickerTarget(target);
  };

  const clearSelectedFood = () => {
    setSelectedFoodId(null);
    setFoodName("");
    setMealFoodPreference(null);
  };

  const clearSelectedSupplement = () => {
    setSelectedSupplementId(null);
    setMealSupplement("");
  };

  const closeFoodCatalogManager = () => {
    setFoodCatalogVisible(false);
    resetCatalogEditor();
  };

  const syncFoodCatalog = async (
    nextSharedCatalog: SavedFood[],
    nextPetCatalog: SavedFood[] = activePet?.foodCatalog ?? [],
  ) => {
    // 1. Update context state and localStorage cache immediately
    updateSharedCatalogs(
      { foodCatalog: nextSharedCatalog },
      { updateCache: true },
    );

    // 2. Local state should update via useEffect, but let's be explicit
    setFoodCatalog(mergeFoodCatalogs(nextSharedCatalog, nextPetCatalog));
  };

  const handleSelectSavedFood = (item: SavedFood) => {
    setMealCategory(item.category);
    setFoodName(item.name);
    setSelectedFoodId(item.id);
    setMealFoodPreference(item.preference ?? null);
  };

  const handleSelectSavedSupplement = (item: SavedSupplement) => {
    setMealSupplement(item.name);
    setSelectedSupplementId(item.id);
  };

  const handleSaveFoodCatalogItem = async () => {
    if (!user || !activePet) {
      Alert.alert("尚未選擇寵物", "請先建立或選擇一個寵物資料。");
      return;
    }

    const normalizedName = normalizeFoodName(catalogName);
    if (!normalizedName) {
      Alert.alert("資料無效", "請輸入食物名稱。");
      return;
    }

    try {
      const userRef = doc(db, "users", user.uid);
      const petRef = doc(db, "pets", activePet.id);
      let nextSharedCatalog: SavedFood[] = [];
      let nextPetCatalog: SavedFood[] = [];

      await runTransaction(db, async (transaction) => {
        const [userSnap, petSnap] = await Promise.all([
          transaction.get(userRef),
          transaction.get(petRef),
        ]);
        const currentUserProfile = userSnap.exists() ? userSnap.data() : {};
        const currentPet = petSnap.exists()
          ? ({ id: petSnap.id, ...petSnap.data() } as SharedPetProfile)
          : null;
        const currentSharedCatalog = Array.isArray(
          currentUserProfile.sharedFoodCatalog,
        )
          ? (currentUserProfile.sharedFoodCatalog as SavedFood[])
          : [];
        const currentPetCatalog = currentPet?.foodCatalog ?? [];
        const currentCatalog = mergeFoodCatalogs(
          mergeFoodCatalogs(
            currentSharedCatalog,
            pets.flatMap((pet) =>
              (pet.foodCatalog ?? []).map(
                ({ id, name, category, brandName }) => ({
                  id,
                  name,
                  category,
                  ...(brandName ? { brandName } : {}),
                }),
              ),
            ),
          ),
          currentPetCatalog,
        );

        const duplicate = currentCatalog.find(
          (item) =>
            item.id !== catalogEditingId &&
            item.category === catalogCategory &&
            normalizeFoodName(item.name).toLowerCase() ===
              normalizedName.toLowerCase(),
        );
        if (duplicate) {
          throw new Error("這個分類已經有相同的食物名稱。");
        }

        const nextId = catalogEditingId ?? createFoodCatalogId();
        const sharedItem: SavedFood = {
          id: nextId,
          name: normalizedName,
          category: catalogCategory,
          ...(typeof catalogKcalAmount === "number"
            ? { kcalAmount: catalogKcalAmount }
            : {}),
          ...(catalogKcalAmount !== undefined
            ? { kcalUnit: catalogKcalUnit }
            : {}),
        };

        nextSharedCatalog = upsertFoodCatalogItem(
          currentSharedCatalog,
          sharedItem,
        );
        nextPetCatalog = catalogPreference
          ? upsertFoodCatalogItem(currentPetCatalog, {
              ...sharedItem,
              preference: catalogPreference,
            })
          : removeFoodCatalogItem(currentPetCatalog, nextId);

        transaction.set(
          userRef,
          { sharedFoodCatalog: nextSharedCatalog },
          { merge: true },
        );
        transaction.set(
          petRef,
          { foodCatalog: nextPetCatalog },
          { merge: true },
        );
      });

      await syncFoodCatalog(nextSharedCatalog, nextPetCatalog);
      if (selectedFoodId === catalogEditingId && catalogEditingId) {
        setMealCategory(catalogCategory);
        setFoodName(normalizedName);
        setMealFoodPreference(catalogPreference);
      }
      closeFoodCatalogManager();
    } catch (error) {
      Alert.alert(
        "錯誤",
        error instanceof Error ? error.message : "儲存食物名稱失敗。",
      );
    }
  };

  const handleEditCatalogItem = (item: SavedFood) => {
    setCatalogCategory(item.category);
    setCatalogName(item.name);
    setCatalogPreference(item.preference ?? null);
    setCatalogKcalAmount(item.kcalAmount);
    setCatalogKcalUnit(item.kcalUnit ?? DEFAULT_KCAL_UNIT);
    setCatalogEditingId(item.id);
    setFoodCatalogVisible(true);
  };

  const handleRemoveCatalogItem = async (item: SavedFood) => {
    if (!user || !activePet) {
      return;
    }

    Alert.alert(
      "確認刪除",
      `確定要刪除「${item.name}」這個食物嗎？此操作無法還原。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "刪除",
          style: "destructive",
          onPress: async () => {
            try {
              const userRef = doc(db, "users", user.uid);
              const petRef = doc(db, "pets", activePet.id);
              let nextSharedCatalog: SavedFood[] = [];
              let nextPetCatalog: SavedFood[] = [];

              await runTransaction(db, async (transaction) => {
                const [userSnap, petSnap] = await Promise.all([
                  transaction.get(userRef),
                  transaction.get(petRef),
                ]);
                const currentUserProfile = userSnap.exists()
                  ? userSnap.data()
                  : {};
                const currentPet = petSnap.exists()
                  ? ({ id: petSnap.id, ...petSnap.data() } as SharedPetProfile)
                  : null;
                const currentSharedCatalog = Array.isArray(
                  currentUserProfile.sharedFoodCatalog,
                )
                  ? (currentUserProfile.sharedFoodCatalog as SavedFood[])
                  : [];
                const currentPetCatalog = currentPet?.foodCatalog ?? [];
                nextSharedCatalog = removeFoodCatalogItem(
                  currentSharedCatalog,
                  item.id,
                );
                nextPetCatalog = removeFoodCatalogItem(
                  currentPetCatalog,
                  item.id,
                );
                transaction.set(
                  userRef,
                  { sharedFoodCatalog: nextSharedCatalog },
                  { merge: true },
                );
                transaction.set(
                  petRef,
                  { foodCatalog: nextPetCatalog },
                  { merge: true },
                );
              });

              if (selectedFoodId === item.id) {
                setSelectedFoodId(null);
                setFoodName("");
                setMealFoodPreference(null);
              }
              await syncFoodCatalog(nextSharedCatalog, nextPetCatalog);
              // reset refresh to background only or omitted if syncFoodCatalog handles it
              // await refresh();

              // Reset and close modal if editing this item
              if (catalogEditingId === item.id) {
                resetCatalogEditor();
                setFoodCatalogVisible(false);
              }
            } catch (error) {
              Alert.alert(
                "錯誤",
                error instanceof Error ? error.message : "刪除食物名稱失敗。",
              );
            }
          },
        },
      ],
    );
  };

  const handlePickJournalPhoto = async () => {
    Alert.alert("新增相片", "選擇相片來源", [
      {
        text: "相機",
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("需要權限", "請允許使用相機。");
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.7,
          });
          if (!result.canceled && result.assets[0]) {
            setJournalPhotoUri(result.assets[0].uri);
          }
        },
      },
      {
        text: "相片庫",
        onPress: async () => {
          const { status } =
            await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("需要權限", "請允許存取相片庫。");
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.7,
          });
          if (!result.canceled && result.assets[0]) {
            setJournalPhotoUri(result.assets[0].uri);
          }
        },
      },
      { text: "取消", style: "cancel" },
    ]);
  };

  const uploadJournalPhoto = async (
    uri: string,
    petId: string,
    date: string,
  ): Promise<string> => {
    const response = await fetch(uri);
    const blob = await response.blob();
    const storageRef = ref(storage, `pets/${petId}/journal/${date}.jpg`);
    await uploadBytes(storageRef, blob);
    return getDownloadURL(storageRef);
  };

  const handleSave = async () => {
    if (!user || !activePet) {
      Alert.alert("尚未選擇寵物", "請先建立或選擇一個寵物資料。");
      return;
    }

    const dateStr = formatDate(activeLogDate);
    const logRef = doc(db, "pets", activePet.id, "logs", dateStr);
    const mealTimestamp = buildTimestampForDate(dateStr, mealTime);
    const waterTimestamp = buildTimestampForDate(dateStr, waterTime);
    const litterTimestamp = buildTimestampForDate(dateStr, litterTime);
    const careTimestamp = buildTimestampForDate(dateStr, careTime);
    const journalTimestamp = buildTimestampForDate(dateStr, journalTime);
    let entry: Record<string, unknown> | null = null;

    if (activeTab === "meal") {
      const grams = parseFloat(mealGrams);
      if (!mealGrams || isNaN(grams) || grams <= 0) {
        Alert.alert("資料無效", "請輸入正確的克數。");
        return;
      }
      if (mealCategory === null) {
        Alert.alert("資料未填寫", "請先選擇食物類別。");
        return;
      }
      const kcalAmount = mealKcalAmount
        ? parseFloat(mealKcalAmount)
        : undefined;
      if (
        mealKcalAmount &&
        (!kcalAmount || isNaN(kcalAmount) || kcalAmount <= 0)
      ) {
        Alert.alert(
          "資料無效",
          `請輸入正確的 ${formatKcalUnit(mealKcalUnit)} 值。`,
        );
        return;
      }
      // Always try to get kcal from selected food if not entered
      let kcalToSave: number | undefined = undefined;
      let kcalUnitToSave: KcalUnit = mealKcalUnit;
      if (kcalAmount && !isNaN(kcalAmount) && kcalAmount > 0) {
        kcalToSave = kcalAmount;
        kcalUnitToSave = mealKcalUnit;
      } else if (
        selectedFoodItem &&
        typeof selectedFoodItem.kcalAmount === "number" &&
        selectedFoodItem.kcalAmount > 0
      ) {
        kcalToSave = selectedFoodItem.kcalAmount;
        kcalUnitToSave = selectedFoodItem.kcalUnit || mealKcalUnit;
      }
      entry = {
        grams,
        category: mealCategory,
        ...(kcalToSave
          ? { kcalAmount: kcalToSave, kcalUnit: kcalUnitToSave }
          : {}),
      };
    } else if (activeTab === "water") {
      entry = {
        water: arrayUnion({
          ml: waterMl ?? 0,
          estimated: waterSource !== "manual",
          source: waterSource,
          time: waterTimestamp,
        }),
        totalWater: increment(waterMl ?? 0),
      };
    } else if (activeTab === "care") {
      entry = {
        care: arrayUnion({
          action: careAction,
          ...(careNote.trim() ? { note: careNote.trim() } : {}),
          time: careTimestamp,
        }),
      };
    } else if (activeTab === "journal") {
      // Journal is one-per-day: use dotted field paths so every subfield is
      // explicitly overwritten — this avoids stale `note` persisting when the
      // user clears the note field and saves again (merge: true would skip it).
      entry = null; // handled separately below
    } else {
      entry = {
        litter: arrayUnion({
          kind: litterKind,
          count: litterCount,
          size: litterSize,
          condition: litterKind === "poo" ? litterCondition : null,
          time: litterTimestamp,
        }),
        litterVisits: increment(1),
      };
    }

    setSaving(true);
    try {
      if (activeTab === "meal") {
        const mealEntry = entry as { grams: number; category: MealCategory };
        const normalizedFoodName = normalizeFoodName(foodName);
        const normalizedSupplement = normalizeFoodName(mealSupplement);
        const userRef = doc(db, "users", user.uid);
        const petRef = doc(db, "pets", activePet.id);
        const crossPetCatalog = pets.flatMap((pet) =>
          (pet.foodCatalog ?? []).map(({ id, name, category, brandName }) => ({
            id,
            name,
            category,
            ...(brandName ? { brandName } : {}),
          })),
        );

        let nextCatalog: SavedFood[] = [];
        let nextPetCatalog: SavedFood[] = [];
        let nextSelectedFoodId: string | null = selectedFoodId;
        let nextSupplementCatalog: SavedSupplement[] = [];
        let nextPetSupplementCatalog: SavedSupplement[] = [];
        let nextSelectedSupplementId: string | null = selectedSupplementId;
        let foodCatalogChanged = false;
        let supplementCatalogChanged = false;
        await runTransaction(db, async (transaction) => {
          const [userSnap, petSnap, logSnap] = await Promise.all([
            transaction.get(userRef),
            transaction.get(petRef),
            transaction.get(logRef),
          ]);

          const currentUserProfile = userSnap.exists() ? userSnap.data() : {};
          const currentPet = petSnap.exists()
            ? ({ id: petSnap.id, ...petSnap.data() } as SharedPetProfile)
            : null;
          const currentSharedCatalog = Array.isArray(
            currentUserProfile.sharedFoodCatalog,
          )
            ? (currentUserProfile.sharedFoodCatalog as SavedFood[])
            : [];
          const currentPetCatalog = currentPet?.foodCatalog ?? [];
          const mergedCatalog = mergeFoodCatalogs(
            mergeFoodCatalogs(currentSharedCatalog, crossPetCatalog),
            currentPetCatalog,
          );
          const currentSharedSupplementCatalog = Array.isArray(
            currentUserProfile.sharedSupplementCatalog,
          )
            ? (currentUserProfile.sharedSupplementCatalog as SavedSupplement[])
            : [];
          const currentSupplementCatalog = mergeSupplementCatalogs(
            mergeSupplementCatalogs(
              currentSharedSupplementCatalog,
              pets.flatMap((pet) => pet.supplementCatalog ?? []),
            ),
            [],
          );

          const parsedMealKcalAmount = mealKcalAmount ? Number(mealKcalAmount) : undefined;
          const hasValidKcalInput = typeof parsedMealKcalAmount === "number" && !isNaN(parsedMealKcalAmount) && parsedMealKcalAmount > 0;

          let matched: SavedFood | undefined = undefined;
          if (normalizedFoodName) {
            matched = nextSelectedFoodId
              ? mergedCatalog.find((item) => item.id === nextSelectedFoodId)
              : findMatchingFood(
                  mergedCatalog,
                  mealEntry.category,
                  normalizedFoodName,
                );

            if (matched) {
              const matchedFood = matched;
              nextSelectedFoodId = matchedFood.id;
              const matchedKcal = hasValidKcalInput
                ? { kcalAmount: parsedMealKcalAmount, kcalUnit: mealKcalUnit }
                : {
                    ...(typeof matchedFood.kcalAmount === "number"
                      ? { kcalAmount: matchedFood.kcalAmount }
                      : {}),
                    ...(matchedFood.kcalUnit
                      ? { kcalUnit: matchedFood.kcalUnit }
                      : {}),
                  };
              nextCatalog = currentSharedCatalog.some(
                (item) => item.id === matchedFood.id,
              )
                ? currentSharedCatalog
                : upsertFoodCatalogItem(currentSharedCatalog, {
                    id: matchedFood.id,
                    name: normalizedFoodName,
                    category: mealEntry.category,
                    ...matchedKcal,
                  });
              nextPetCatalog = mealFoodPreference
                ? upsertFoodCatalogItem(currentPetCatalog, {
                    id: matchedFood.id,
                    name: normalizedFoodName,
                    category: mealEntry.category,
                    preference: mealFoodPreference,
                    ...matchedKcal,
                  })
                : removeFoodCatalogItem(currentPetCatalog, matchedFood.id);
              if (
                JSON.stringify(nextCatalog) !==
                JSON.stringify(currentSharedCatalog)
              ) {
                transaction.set(
                  userRef,
                  { sharedFoodCatalog: nextCatalog },
                  { merge: true },
                );
                foodCatalogChanged = true;
              }
              if (
                JSON.stringify(nextPetCatalog) !==
                JSON.stringify(currentPetCatalog)
              ) {
                transaction.set(
                  petRef,
                  { foodCatalog: nextPetCatalog },
                  { merge: true },
                );
                foodCatalogChanged = true;
              }
            } else {
              nextSelectedFoodId = createFoodCatalogId();
              const newFoodKcal = hasValidKcalInput
                ? { kcalAmount: parsedMealKcalAmount, kcalUnit: mealKcalUnit }
                : {};
              nextCatalog = upsertFoodCatalogItem(currentSharedCatalog, {
                id: nextSelectedFoodId,
                name: normalizedFoodName,
                category: mealEntry.category,
                ...newFoodKcal,
              });
              nextPetCatalog = mealFoodPreference
                ? upsertFoodCatalogItem(currentPetCatalog, {
                    id: nextSelectedFoodId,
                    name: normalizedFoodName,
                    category: mealEntry.category,
                    preference: mealFoodPreference,
                    ...newFoodKcal,
                  })
                : currentPetCatalog;
              transaction.set(
                userRef,
                { sharedFoodCatalog: nextCatalog },
                { merge: true },
              );
              if (mealFoodPreference) {
                transaction.set(
                  petRef,
                  { foodCatalog: nextPetCatalog },
                  { merge: true },
                );
              }
              foodCatalogChanged = true;
            }
          } else {
            nextCatalog = currentSharedCatalog;
            nextPetCatalog = currentPetCatalog;
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

            const currentPetSupplementCatalog =
              currentPet?.supplementCatalog ?? [];

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
              if (
                JSON.stringify(nextSupplementCatalog) !==
                JSON.stringify(currentSharedSupplementCatalog)
              ) {
                transaction.set(
                  userRef,
                  { sharedSupplementCatalog: nextSupplementCatalog },
                  { merge: true },
                );
                supplementCatalogChanged = true;
              }
              nextPetSupplementCatalog = currentPetSupplementCatalog.some(
                (item) => item.id === matchedSupplement.id,
              )
                ? currentPetSupplementCatalog
                : upsertSupplementCatalogItem(currentPetSupplementCatalog, {
                    id: matchedSupplement.id,
                    name: normalizedSupplement,
                  });
              if (
                JSON.stringify(nextPetSupplementCatalog) !==
                JSON.stringify(currentPetSupplementCatalog) &&
                currentPet
              ) {
                transaction.set(
                  petRef,
                  { supplementCatalog: nextPetSupplementCatalog },
                  { merge: true },
                );
                supplementCatalogChanged = true;
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
              nextPetSupplementCatalog = upsertSupplementCatalogItem(
                currentPetSupplementCatalog,
                {
                  id: nextSelectedSupplementId,
                  name: normalizedSupplement,
                },
              );
              if (
                JSON.stringify(nextPetSupplementCatalog) !==
                JSON.stringify(currentPetSupplementCatalog) &&
                currentPet
              ) {
                transaction.set(
                  petRef,
                  { supplementCatalog: nextPetSupplementCatalog },
                  { merge: true },
                );
              }
              supplementCatalogChanged = true;
            }
          } else {
            nextSupplementCatalog = currentSharedSupplementCatalog;
          }

          const mealPayload = {
            grams: mealEntry.grams,
            category: mealEntry.category,
            ...(normalizedFoodName ? { foodName: normalizedFoodName } : {}),
            ...(mealFoodPreference
              ? { foodPreference: mealFoodPreference }
              : {}),
            ...(normalizedSupplement
              ? { supplement: normalizedSupplement }
              : {}),
            ...(mealKcalAmount &&
            !isNaN(Number(mealKcalAmount)) &&
            Number(mealKcalAmount) > 0
              ? { kcalAmount: Number(mealKcalAmount), kcalUnit: mealKcalUnit }
              : matched &&
                  typeof matched.kcalAmount === "number" &&
                  matched.kcalAmount > 0
                ? {
                    kcalAmount: matched.kcalAmount,
                    kcalUnit: matched.kcalUnit ?? "100g",
                  }
                : {}),
            foodType: buildMealLegacyFoodType(
              mealEntry.category,
              normalizedFoodName,
            ),
            time: mealTimestamp,
          };

          if (!logSnap.exists()) {
            transaction.set(logRef, {
              petId: activePet.id,
              date: dateStr,
              meals: [mealPayload],
              water: [],
              litter: [],
              care: [],
              totalMeals: mealEntry.grams,
              totalWater: 0,
              litterVisits: 0,
            });
          } else {
            const currentLog = logSnap.data() as {
              meals?: Array<
                {
                  grams: number;
                  time: Timestamp;
                  __virtual?: true;
                  __scheduleId?: string;
                  __unit?: "g" | "portion";
                } & Record<string, unknown>
              >;
              totalMeals?: number;
            };
            const currentMeals = Array.isArray(currentLog.meals)
              ? currentLog.meals
              : [];
            const nextMeals = [...currentMeals]
              .filter(
                (existingMeal) =>
                  !(
                    existingMeal.__virtual &&
                    isSameMealWindow(existingMeal, mealTimestamp.toDate())
                  ),
              )
              .concat(mealPayload)
              .sort(
                (left, right) => left.time.toMillis() - right.time.toMillis(),
              );
            const totalMeals = nextMeals.reduce(
              (sum, currentMeal) => sum + currentMeal.grams,
              0,
            );
            transaction.update(logRef, {
              meals: nextMeals,
              totalMeals,
            });
          }
        });

        setSelectedFoodId(nextSelectedFoodId);
        setSelectedSupplementId(nextSelectedSupplementId);
        if (foodCatalogChanged) {
          setFoodCatalog(mergeFoodCatalogs(nextCatalog, nextPetCatalog));
          updateSharedCatalogs(
            { foodCatalog: nextCatalog },
            { updateCache: true },
          );
        }
        if (supplementCatalogChanged) {
          setSupplementCatalog(
            mergeSupplementCatalogs(nextSupplementCatalog, nextPetSupplementCatalog),
          );
          updateSharedCatalogs(
            { supplementCatalog: nextSupplementCatalog },
            { updateCache: true },
          );
        }
      } else {
        const existing = await getDoc(logRef);
        if (!existing.exists()) {
          await setDoc(logRef, {
            petId: activePet.id,
            date: dateStr,
            meals: [],
            water: [],
            litter: [],
            care: [],
            totalMeals: 0,
            totalWater: 0,
            litterVisits: 0,
          });
        }

        if (entry !== null) {
          await setDoc(logRef, entry, { merge: true });
        }

        // Journal: write individual dotted paths so blank note explicitly
        // removes any previously saved note (deleteField clears it in Firestore).
        // Also uploads photo to Storage if a new local URI was chosen.
        if (activeTab === "journal") {
          let uploadedPhotoURL: string | null = null;
          if (journalPhotoUri) {
            uploadedPhotoURL = await uploadJournalPhoto(
              journalPhotoUri,
              activePet.id,
              dateStr,
            );
          }
          const journalUpdate: Record<string, unknown> = {
            "journal.mood": journalMood,
            "journal.note": journalNote.trim()
              ? journalNote.trim()
              : deleteField(),
            "journal.updatedAt": journalTimestamp,
          };
          if (uploadedPhotoURL !== null) {
            journalUpdate["journal.photoURL"] = uploadedPhotoURL;
          } else if (!journalPhotoUri) {
            // Photo was explicitly removed
            journalUpdate["journal.photoURL"] = deleteField();
          }
          await updateDoc(logRef, journalUpdate);
        }
      }

      if (activeTab === "meal") {
        resetMealForm();
      } else if (activeTab === "water") {
        resetWaterForm();
      } else if (activeTab === "care") {
        setCareNote("");
      } else if (activeTab === "journal") {
        setJournalNote("");
        setJournalPhotoUri(null);
      } else {
        setLitterKind("wee");
        setLitterCount(1);
        setLitterSize("medium");
        setLitterCondition("normal");
      }

      const tabLabels: Record<Tab, string> = {
        meal: "餵食",
        water: "飲水",
        litter: "去廁所",
        care: "護理",
        journal: "日記",
      };
      Alert.alert("已儲存 ✅", `${tabLabels[activeTab]}紀錄已儲存。`);

      // Refresh log for selected date to show updated kcal
      if (activeTab === "meal" && user && activePet) {
        void (async () => {
          const dateStr = formatDate(tabDates.meal);
          const logRef = doc(db, "pets", activePet.id, "logs", dateStr);
          const logSnap = await getDoc(logRef);
          if (logSnap.exists()) {
            setTodayLog(logSnap.data() as DailyLog);
          }
        })().catch((error) => {
          console.error("Failed to refresh log:", error);
        });
      }
    } catch (e) {
      Alert.alert("錯誤", e instanceof Error ? e.message : "儲存紀錄失敗。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={activeTab !== "water" || !waterDragActive}
        onScrollBeginDrag={Keyboard.dismiss}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              if (!user || !activePet) return;
              setRefreshing(true);
              try {
                const dateStr = formatDate(activeLogDate);
                const logRef = doc(db, "pets", activePet.id, "logs", dateStr);
                const logSnap = await getDoc(logRef);
                setTodayLog(
                  logSnap.exists() ? (logSnap.data() as DailyLog) : null,
                );
              } catch {}
              setRefreshing(false);
            }}
            tintColor="#7FA655"
          />
        }
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={{ flex: 1 }}>
            <View style={styles.logTopline}>
              <View style={styles.logTitleWrap}>
                <Text style={styles.logKicker}>日常記錄</Text>
                <Text style={styles.title}>
                  {activePet?.name ?? "主子"} 今日有咩想記低？
                </Text>
              </View>
              <View
                style={[
                  styles.logHeaderBadge,
                  {
                    backgroundColor: LOG_TAB_THEME[activeTab].background,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.logHeaderBadgeText,
                    { color: LOG_TAB_THEME[activeTab].accent },
                  ]}
                >
                  {LOG_TAB_META[activeTab].icon} {LOG_TAB_META[activeTab].title}
                </Text>
              </View>
            </View>

            {/* Date Picker for log date - moved into each form above time picker */}
            {/* Date Picker Modal (remains global) */}
            {showDatePicker && (
              <Modal
                visible={showDatePicker}
                transparent
                animationType="fade"
                onRequestClose={() => setShowDatePicker(false)}
              >
                <View
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    alignItems: "center",
                    backgroundColor: "rgba(0,0,0,0.2)",
                  }}
                >
                  <View
                    style={{
                      backgroundColor: "#fff",
                      borderRadius: 16,
                      padding: 20,
                      width: 320,
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 18,
                        fontWeight: "bold",
                        marginBottom: 12,
                      }}
                    >
                      選擇日期
                    </Text>
                    <DateTimePicker
                      value={activeLogDate}
                      mode="date"
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={(_, nextValue) => {
                        if (nextValue) setDateForTab(activeTab, nextValue);
                      }}
                      maximumDate={new Date()}
                      {...(Platform.OS === "ios" ? { textColor: "#000" } : {})}
                    />
                    <TouchableOpacity
                      style={{
                        marginTop: 16,
                        backgroundColor: "#7FA655",
                        borderRadius: 8,
                        paddingVertical: 8,
                        paddingHorizontal: 24,
                      }}
                      onPress={() => setShowDatePicker(false)}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontWeight: "bold",
                          fontSize: 16,
                        }}
                      >
                        完成
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Modal>
            )}

            <TouchableOpacity
              style={styles.weightShortcut}
              activeOpacity={0.85}
              onPress={() => navigation.navigate("WeightTracker")}
            >
              <View style={styles.weightShortcutContent}>
                <Text style={styles.weightShortcutLabel}>體重追蹤</Text>
                <Text style={styles.weightShortcutText}>
                  主子今日肥咗定瘦咗？快啲記低，畫條肥瘦曲線睇下啦！
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#7FA655" />
            </TouchableOpacity>

            {/* Segmented Tabs */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.tabScrollView}
              contentContainerStyle={styles.tabRow}
            >
              {(["meal", "water", "litter", "care", "journal"] as Tab[]).map(
                (tab) => (
                  <TouchableOpacity
                    key={tab}
                    style={[
                      styles.tab,
                      activeTab === tab && {
                        backgroundColor: LOG_TAB_THEME[tab].background,
                        borderColor: LOG_TAB_THEME[tab].accent,
                      },
                    ]}
                    onPress={() => setActiveTab(tab)}
                  >
                    <Text
                      style={[
                        styles.tabText,
                        activeTab === tab && {
                          color: LOG_TAB_THEME[tab].accent,
                          fontFamily: "ZenMaruGothic-Bold",
                        },
                      ]}
                    >
                      {tab === "meal"
                        ? "🍽️ 餵食"
                        : tab === "water"
                          ? "💧 飲水"
                          : tab === "litter"
                            ? "🚽 去廁所"
                            : tab === "care"
                              ? "🩺 護理"
                              : "📔 日記"}
                    </Text>
                  </TouchableOpacity>
                ),
              )}
            </ScrollView>

            {/* Meal Form */}
            {activeTab === "meal" && (
              <View style={styles.form}>
                {/* Date Picker above time picker */}
                <TouchableOpacity
                  style={[styles.timeTrigger, { marginBottom: 12 }]}
                  onPress={() => setShowDatePicker(true)}
                  activeOpacity={0.85}
                >
                  <View>
                    <Text style={styles.timeTriggerLabel}>選擇日期</Text>
                    <Text style={styles.timeTriggerValue}>
                      {formatDate(activeLogDate)}
                    </Text>
                  </View>
                  <Ionicons name="calendar-outline" size={20} color="#7FA655" />
                </TouchableOpacity>

                <Text style={styles.label}>紀錄時間*</Text>
                <TouchableOpacity
                  style={styles.timeTrigger}
                  onPress={() => openTimePicker("meal")}
                  activeOpacity={0.85}
                >
                  <View>
                    <Text style={styles.timeTriggerLabel}>選擇餵食時間</Text>
                    <Text style={styles.timeTriggerValue}>
                      {formatTimeInput(mealTime)}
                    </Text>
                  </View>
                  <Ionicons name="time-outline" size={20} color="#7FA655" />
                </TouchableOpacity>

                <Text style={styles.label}>份量（克）*</Text>
                <TextInput
                  style={styles.input}
                  placeholder="例如：80"
                  value={mealGrams}
                  onChangeText={setMealGrams}
                  keyboardType="decimal-pad"
                />

                <Text style={styles.label}>食物類別*</Text>
                <View style={styles.mealCategoryRow}>
                  {MEAL_CATEGORIES.map((category) => (
                    <TouchableOpacity
                      key={category}
                      style={[
                        styles.mealCategoryBtn,
                        mealCategory === category &&
                          styles.mealCategoryBtnActive,
                      ]}
                      onPress={() => {
                        if (mealCategory === category) {
                          setMealCategory(null);
                          setSelectedFoodId(null);
                          setFoodName("");
                          setMealFoodPreference(null);
                        } else {
                          setMealCategory(category);
                          setSelectedFoodId(null);
                          setFoodName("");
                          setMealFoodPreference(null);
                        }
                      }}
                    >
                      <Text style={styles.mealCategoryIcon}>
                        {MEAL_CATEGORY_ICONS[category]}
                      </Text>
                      <Text
                        style={[
                          styles.mealCategoryText,
                          mealCategory === category &&
                            styles.mealCategoryTextActive,
                        ]}
                      >
                        {MEAL_CATEGORY_LABELS[category]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Only show food name/chip section if mealCategory is selected */}
                {mealCategory !== null && (
                  <View style={styles.compactSelectorCard}>
                    <View style={styles.mealSectionHeader}>
                      <Text style={styles.label}>
                        {MEAL_CATEGORY_LABELS[mealCategory ?? "wet"] ??
                          mealCategory ??
                          "wet"}
                        （選填）
                      </Text>
                      <TouchableOpacity onPress={openFoodCatalogManager}>
                        <Text style={styles.manageFoodText}>管理名單</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Chip selector for saved foods */}
                    {filteredSavedFoods.length > 0 ? (
                      <ScrollView
                        nestedScrollEnabled
                        showsVerticalScrollIndicator={false}
                        style={styles.savedFoodList}
                        contentContainerStyle={styles.savedFoodGrid}
                      >
                        {filteredSavedFoods.map((item) => (
                          <TouchableOpacity
                            key={item.id}
                            style={[
                              styles.savedFoodCard,
                              selectedFoodId === item.id &&
                                styles.savedFoodCardActive,
                            ]}
                            onPress={() => {
                              if (selectedFoodId === item.id) {
                                clearSelectedFood();
                              } else {
                                handleSelectSavedFood(item);
                              }
                            }}
                          >
                            <View style={styles.savedFoodCardContent}>
                              {item.brandName ? (
                                <Text
                                  style={[
                                    styles.savedFoodCardBrand,
                                    selectedFoodId === item.id &&
                                      styles.savedFoodCardBrandActive,
                                  ]}
                                  numberOfLines={1}
                                >
                                  {item.brandName}
                                </Text>
                              ) : null}
                              <Text
                                style={[
                                  styles.savedFoodCardText,
                                  selectedFoodId === item.id &&
                                    styles.savedFoodCardTextActive,
                                ]}
                                numberOfLines={2}
                              >
                                {item.name}
                              </Text>
                              {item.preference ? (
                                <Text
                                  style={styles.savedFoodCardPreferenceIcon}
                                >
                                  {FOOD_PREFERENCE_ICONS[item.preference]}
                                </Text>
                              ) : null}
                            </View>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    ) : (
                      <Text style={styles.helperText}>
                        這個類別暫時未有常用名稱
                      </Text>
                    )}

                    <Text style={styles.selectorInputLabel}>
                      或直接輸入新食物名稱
                    </Text>
                    <TextInput
                      style={styles.input}
                      placeholder="例如 Royal Canin Indoor"
                      value={foodName}
                      onChangeText={(text) => {
                        setFoodName(text);
                        setSelectedFoodId(null);
                        setMealFoodPreference(null);
                      }}
                    />
                    <Text style={styles.helperText}>
                      沒有合適選項時再輸入；儲存後會自動加入目前類別的常用清單。
                    </Text>

                    {/* {shouldShowFoodPreference ? (
                      <>
                        <Text style={styles.selectorInputLabel}>
                          主子反應（選填）
                        </Text>
                        <View style={styles.foodPreferenceRow}>
                          {FOOD_PREFERENCE_OPTIONS.map((preference) => {
                            const selected = mealFoodPreference === preference;
                            return (
                              <TouchableOpacity
                                key={preference}
                                style={[
                                  styles.foodPreferenceButton,
                                  selected && styles.foodPreferenceButtonActive,
                                ]}
                                onPress={() =>
                                  setMealFoodPreference((current) =>
                                    current === preference ? null : preference,
                                  )
                                }
                              >
                                <Text
                                  style={[
                                    styles.foodPreferenceButtonText,
                                    selected &&
                                      styles.foodPreferenceButtonTextActive,
                                  ]}
                                >
                                  {FOOD_PREFERENCE_ICONS[preference]}{" "}
                                  {FOOD_PREFERENCE_LABELS[preference]}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                        <Text style={styles.helperText}>
                          下次再揀同一款食物時，會直接見到主子鍾意定唔鍾意。
                        </Text>
                      </>
                    ) : null} */}
                  </View>
                )}

                {/* Kcal input section - only show if needed */}
                {shouldShowKcalInput ? (
                  <View style={styles.compactSelectorCard}>
                    <Text style={styles.label}>熱量單位</Text>
                    <View style={styles.foodPreferenceRow}>
                      {KCAL_UNITS.map((unit) => {
                        const selected = mealKcalUnit === unit;
                        return (
                          <TouchableOpacity
                            key={unit}
                            style={[
                              styles.foodPreferenceButton,
                              selected && styles.foodPreferenceButtonActive,
                            ]}
                            onPress={() => setMealKcalUnit(unit)}
                          >
                            <Text
                              style={[
                                styles.foodPreferenceButtonText,
                                selected &&
                                  styles.foodPreferenceButtonTextActive,
                              ]}
                            >
                              {formatKcalUnit(unit)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={[styles.label, { marginTop: 12 }]}>
                      {getKcalInputLabel(mealKcalUnit)}
                    </Text>
                    <TextInput
                      style={styles.input}
                      placeholder={getKcalPlaceholder(mealKcalUnit)}
                      value={mealKcalAmount}
                      onChangeText={setMealKcalAmount}
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.helperText}>
                      輸入此食物的 {formatKcalUnit(mealKcalUnit)}
                      ，系統會自動計算這份的熱量攝取。
                    </Text>
                    {currentMealKcal > 0 && (
                      <View
                        style={{
                          marginTop: 12,
                          padding: 12,
                          backgroundColor: "#fff7ed",
                          borderRadius: 12,
                          borderLeftWidth: 4,
                          borderLeftColor: "#7FA655",
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: "ZenMaruGothic-Bold",
                            fontSize: 14,
                            color: "#111827",
                          }}
                        >
                          預計熱量攝取
                        </Text>
                        <Text
                          style={{
                            fontFamily: "ZenMaruGothic-Bold",
                            fontSize: 24,
                            color: "#7FA655",
                            marginTop: 4,
                          }}
                        >
                          {currentMealKcal} kcal
                        </Text>
                      </View>
                    )}
                  </View>
                ) : (
                  // If kcal is present, just show the kcal summary
                  currentMealKcal > 0 && (
                    <View
                      style={{
                        marginTop: 12,
                        padding: 12,
                        backgroundColor: "#fff7ed",
                        borderRadius: 12,
                        borderLeftWidth: 4,
                        borderLeftColor: "#7FA655",
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: "ZenMaruGothic-Bold",
                          fontSize: 14,
                          color: "#111827",
                        }}
                      >
                        預計熱量攝取
                      </Text>
                      <Text
                        style={{
                          fontFamily: "ZenMaruGothic-Bold",
                          fontSize: 24,
                          color: "#7FA655",
                          marginTop: 4,
                        }}
                      >
                        {currentMealKcal} kcal
                      </Text>
                    </View>
                  )
                )}

                {/* Supplement section always at the end */}
                <View style={styles.compactSelectorCard}>
                  <Text style={styles.label}>Supplements（選填）</Text>
                  {/* Chip selector for saved supplements */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginVertical: 8 }}
                    contentContainerStyle={{ flexDirection: "row", gap: 8 }}
                  >
                    {savedSupplements.length > 0 ? (
                      savedSupplements.map((item) => (
                        <TouchableOpacity
                          key={item.id}
                          style={[
                            styles.savedFoodChip,
                            selectedSupplementId === item.id &&
                              styles.savedFoodChipActive,
                          ]}
                          onPress={() => {
                            if (selectedSupplementId === item.id) {
                              clearSelectedSupplement();
                            } else {
                              handleSelectSavedSupplement(item);
                            }
                          }}
                        >
                          <Text
                            style={[styles.savedFoodChipText]}
                            numberOfLines={1}
                          >
                            {truncateChipText(item.name).toUpperCase()}
                          </Text>
                        </TouchableOpacity>
                      ))
                    ) : (
                      <Text style={styles.helperText}>暫時未有常用補充品</Text>
                    )}
                  </ScrollView>

                  <Text style={styles.selectorInputLabel}>
                    或直接輸入新補充品
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="例如 魚油、益生菌"
                    value={mealSupplement}
                    onChangeText={(text) => {
                      setMealSupplement(text);
                      setSelectedSupplementId(null);
                    }}
                  />
                  <Text style={styles.helperText}>
                    第一次輸入後，之後就可以直接從常用清單挑選。
                  </Text>
                </View>
              </View>
            )}

            {/* Water Form */}
            {activeTab === "water" && (
              <View style={styles.form}>
                {/* Date Picker above time picker */}
                <TouchableOpacity
                  style={[styles.timeTrigger, { marginBottom: 12 }]}
                  onPress={() => setShowDatePicker(true)}
                  activeOpacity={0.85}
                >
                  <View>
                    <Text style={styles.timeTriggerLabel}>選擇日期</Text>
                    <Text style={styles.timeTriggerValue}>
                      {formatDate(activeLogDate)}
                    </Text>
                  </View>
                  <Ionicons name="calendar-outline" size={20} color="#7FA655" />
                </TouchableOpacity>

                <Text style={styles.label}>紀錄時間*</Text>
                <TouchableOpacity
                  style={styles.timeTrigger}
                  onPress={() => openTimePicker("water")}
                  activeOpacity={0.85}
                >
                  <View>
                    <Text style={styles.timeTriggerLabel}>選擇飲水時間</Text>
                    <Text style={styles.timeTriggerValue}>
                      {formatTimeInput(waterTime)}
                    </Text>
                  </View>
                  <Ionicons name="time-outline" size={20} color="#0ea5e9" />
                </TouchableOpacity>

                <Text style={styles.label}>快速選擇</Text>
                <View style={styles.presetRow}>
                  {WATER_PRESETS.map((preset) => (
                    <TouchableOpacity
                      key={preset}
                      style={[
                        styles.presetBtn,
                        waterMl === preset && styles.presetBtnActive,
                      ]}
                      onPress={() => {
                        setWaterMl(preset);
                        setWaterText(String(preset));
                        setWaterSource("preset");
                      }}
                    >
                      <Text
                        style={[
                          styles.presetBtnText,
                          waterMl === preset && styles.presetBtnTextActive,
                        ]}
                      >
                        {WATER_PRESET_LABELS[preset]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>手動輸入（ml）</Text>
                <View style={styles.manualInputRow}>
                  <TextInput
                    style={[styles.input, styles.manualWaterInput]}
                    placeholder="輸入毫升數，例如 120"
                    value={waterText}
                    onChangeText={(raw) => {
                      setWaterText(raw);
                      const parsed = parseInt(raw, 10);
                      if (!isNaN(parsed) && parsed >= WATER_MIN) {
                        setWaterMl(clamp(parsed, WATER_MIN, WATER_MAX));
                        setWaterSource("manual");
                      }
                    }}
                    keyboardType="number-pad"
                    returnKeyType="done"
                  />
                  <Text style={styles.manualWaterUnit}>ml</Text>
                </View>

                <Text style={styles.label}>拖曳水位（估算）</Text>
                <View style={styles.waterCard}>
                  <Text style={styles.helperText}>
                    由滿滿一碗開始：向下拖曳，水位會同步下降，代表主子喝了更多。
                  </Text>
                  <View style={styles.bowlWrap}>
                    <View style={styles.bowl}>
                      <View
                        style={[
                          styles.waterFill,
                          {
                            top: waterSurfaceOffset,
                          },
                        ]}
                      />
                      <View
                        pointerEvents="none"
                        style={[
                          styles.waterSurfaceMarker,
                          {
                            top: waterSurfaceOffset,
                          },
                        ]}
                      >
                        <View style={styles.waterHandleLine} />
                      </View>
                      <View
                        {...waterPanResponder.panHandlers}
                        style={[
                          styles.waterHandleTouchArea,
                          {
                            top: waterHandleTouchTop,
                          },
                        ]}
                      />
                    </View>
                  </View>
                  <Text style={styles.waterValue}>
                    已喝 {waterMl ?? ""} ml{" "}
                    <Text style={styles.waterTag}>估算</Text>
                  </Text>
                </View>
              </View>
            )}

            {/* Litter Form */}
            {activeTab === "litter" && (
              <View style={styles.form}>
                {/* Date Picker above form */}
                <TouchableOpacity
                  style={[styles.timeTrigger, { marginBottom: 12 }]}
                  onPress={() => setShowDatePicker(true)}
                  activeOpacity={0.85}
                >
                  <View>
                    <Text style={styles.timeTriggerLabel}>選擇日期</Text>
                    <Text style={styles.timeTriggerValue}>
                      {formatDate(activeLogDate)}
                    </Text>
                  </View>
                  <Ionicons name="calendar-outline" size={20} color="#7FA655" />
                </TouchableOpacity>
                <Text style={styles.label}>種類</Text>
                <Text style={styles.label}>紀錄時間*</Text>
                <TouchableOpacity
                  style={styles.timeTrigger}
                  onPress={() => openTimePicker("litter")}
                  activeOpacity={0.85}
                >
                  <View>
                    <Text style={styles.timeTriggerLabel}>選擇去廁所時間</Text>
                    <Text style={styles.timeTriggerValue}>
                      {formatTimeInput(litterTime)}
                    </Text>
                  </View>
                  <Ionicons name="time-outline" size={20} color="#7FA655" />
                </TouchableOpacity>

                <View style={styles.litterRow}>
                  {(["wee", "poo"] as LitterKind[]).map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.litterBtn,
                        litterKind === type && styles.litterBtnActive,
                      ]}
                      onPress={() => setLitterKind(type)}
                    >
                      <Text
                        style={[
                          styles.litterBtnText,
                          litterKind === type && styles.litterBtnTextActive,
                        ]}
                      >
                        {type === "wee"
                          ? `🐾 ${LITTER_KIND_LABELS.wee}`
                          : `💩 ${LITTER_KIND_LABELS.poo}`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>幾多舊</Text>
                <View style={styles.countRow}>
                  <TouchableOpacity
                    style={styles.countBtn}
                    onPress={() =>
                      setLitterCount((current) =>
                        Math.max(LITTER_COUNT_MIN, current - 1),
                      )
                    }
                  >
                    <Text style={styles.countBtnText}>－</Text>
                  </TouchableOpacity>
                  <View style={styles.countValueWrap}>
                    <Text style={styles.countValue}>{litterCount}</Text>
                    <Text style={styles.helperText}>舊</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.countBtn}
                    onPress={() =>
                      setLitterCount((current) =>
                        Math.min(LITTER_COUNT_MAX, current + 1),
                      )
                    }
                  >
                    <Text style={styles.countBtnText}>＋</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>大小</Text>

                <View style={styles.litterRow}>
                  {LITTER_SIZE_OPTIONS.map((size) => (
                    <TouchableOpacity
                      key={size}
                      style={[
                        styles.litterBtn,
                        litterSize === size && styles.litterBtnActive,
                      ]}
                      onPress={() => setLitterSize(size)}
                    >
                      <Text
                        style={[
                          styles.litterBtnText,
                          litterSize === size && styles.litterBtnTextActive,
                        ]}
                      >
                        {LITTER_SIZE_LABELS[size]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {litterSize && (
                  <Text
                    style={[
                      styles.helperText,
                      {
                        fontSize: 13,
                        color: "#888",
                        marginTop: 6,
                        textAlign: "center",
                      },
                    ]}
                  >
                    {LITTER_SIZE_DESCRIPTIONS[litterSize]}
                  </Text>
                )}

                {litterKind === "poo" ? (
                  <>
                    <Text style={styles.label}>狀態</Text>
                    <View style={styles.litterRow}>
                      {LITTER_CONDITION_OPTIONS.map((condition) => (
                        <TouchableOpacity
                          key={condition}
                          style={[
                            styles.litterBtn,
                            litterCondition === condition &&
                              styles.litterBtnActive,
                          ]}
                          onPress={() => setLitterCondition(condition)}
                        >
                          <Text
                            style={[
                              styles.litterBtnText,
                              litterCondition === condition &&
                                styles.litterBtnTextActive,
                            ]}
                          >
                            {LITTER_CONDITION_LABELS[condition]}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : null}
              </View>
            )}

            {/* Care Form */}
            {activeTab === "care" && (
              <View style={styles.form}>
                {/* Date Picker above form */}
                <TouchableOpacity
                  style={[styles.timeTrigger, { marginBottom: 12 }]}
                  onPress={() => setShowDatePicker(true)}
                  activeOpacity={0.85}
                >
                  <View>
                    <Text style={styles.timeTriggerLabel}>選擇日期</Text>
                    <Text style={styles.timeTriggerValue}>
                      {formatDate(activeLogDate)}
                    </Text>
                  </View>
                  <Ionicons name="calendar-outline" size={20} color="#7FA655" />
                </TouchableOpacity>
                <Text style={styles.label}>紀錄時間*</Text>
                <TouchableOpacity
                  style={styles.timeTrigger}
                  onPress={() => openTimePicker("care")}
                  activeOpacity={0.85}
                >
                  <View>
                    <Text style={styles.timeTriggerLabel}>選擇護理時間</Text>
                    <Text style={styles.timeTriggerValue}>
                      {formatTimeInput(careTime)}
                    </Text>
                  </View>
                  <Ionicons name="time-outline" size={20} color="#7FA655" />
                </TouchableOpacity>

                <Text style={styles.label}>護理項目</Text>
                <View style={styles.careGrid}>
                  {CARE_ACTIONS.map((action) => (
                    <TouchableOpacity
                      key={action}
                      style={[
                        styles.careBtn,
                        careAction === action && styles.careBtnActive,
                      ]}
                      onPress={() => setCareAction(action)}
                    >
                      <Text style={styles.careIcon}>
                        {CARE_ACTION_ICONS[action]}
                      </Text>
                      <Text
                        style={[
                          styles.careBtnText,
                          careAction === action && styles.careBtnTextActive,
                        ]}
                      >
                        {CARE_ACTION_LABELS[action]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.label}>備註（選填）</Text>
                <TextInput
                  style={[
                    styles.input,
                    { minHeight: 80, textAlignVertical: "top" },
                  ]}
                  placeholder="例如：左前腳有點抗拒，記得下次多哄一哄"
                  value={careNote}
                  onChangeText={setCareNote}
                  multiline
                />
              </View>
            )}

            {/* Journal Form */}
            {activeTab === "journal" && (
              <View style={styles.form}>
                {/* Date Picker above form */}
                <TouchableOpacity
                  style={[styles.timeTrigger, { marginBottom: 12 }]}
                  onPress={() => setShowDatePicker(true)}
                  activeOpacity={0.85}
                >
                  <View>
                    <Text style={styles.timeTriggerLabel}>選擇日期</Text>
                    <Text style={styles.timeTriggerValue}>
                      {formatDate(activeLogDate)}
                    </Text>
                  </View>
                  <Ionicons name="calendar-outline" size={20} color="#7FA655" />
                </TouchableOpacity>
                <Text style={styles.label}>紀錄時間*</Text>
                <TouchableOpacity
                  style={styles.timeTrigger}
                  onPress={() => openTimePicker("journal")}
                  activeOpacity={0.85}
                >
                  <View>
                    <Text style={styles.timeTriggerLabel}>選擇日記時間</Text>
                    <Text style={styles.timeTriggerValue}>
                      {formatTimeInput(journalTime)}
                    </Text>
                  </View>
                  <Ionicons name="time-outline" size={20} color="#7FA655" />
                </TouchableOpacity>

                <Text style={styles.label}>今日狀態</Text>
                <View style={styles.moodGrid}>
                  {MOODS.map((mood) => (
                    <TouchableOpacity
                      key={mood}
                      style={[
                        styles.moodBtn,
                        journalMood === mood && styles.moodBtnActive,
                      ]}
                      onPress={() => setJournalMood(mood)}
                    >
                      <Text style={styles.moodIcon}>{MOOD_ICONS[mood]}</Text>
                      <Text
                        style={[
                          styles.moodBtnText,
                          journalMood === mood && styles.moodBtnTextActive,
                        ]}
                      >
                        {MOOD_LABELS[mood]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.noteCard}>
                  <Text style={styles.noteText}>
                    每天只會保留最新一筆日記紀錄。
                  </Text>
                </View>

                <Text style={styles.label}>今日日記（選填）</Text>
                <TextInput
                  style={[
                    styles.input,
                    { minHeight: 120, textAlignVertical: "top" },
                  ]}
                  placeholder="記下今天的觀察，例如：今天特別愛玩，追了好久紅點……"
                  value={journalNote}
                  onChangeText={setJournalNote}
                  multiline
                />

                <Text style={[styles.label, { marginTop: 16 }]}>
                  今日照片（選填）
                </Text>
                {journalPhotoUri ? (
                  <View style={styles.journalPhotoContainer}>
                    <Image
                      source={{ uri: journalPhotoUri }}
                      style={styles.journalPhotoPreview}
                      resizeMode="cover"
                    />
                    <TouchableOpacity
                      style={styles.journalPhotoRemove}
                      onPress={() => setJournalPhotoUri(null)}
                    >
                      <Text style={styles.journalPhotoRemoveText}>✕ 移除</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.journalPhotoBtn}
                    onPress={handlePickJournalPhoto}
                  >
                    <Text style={styles.journalPhotoBtnText}>📷 選擇相片</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <Text style={styles.saveBtnText}>儲存中…</Text>
              ) : (
                <Text style={styles.saveBtnText}>儲存紀錄</Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableWithoutFeedback>
      </ScrollView>

      <Modal
        visible={timePickerTarget !== null}
        animationType="slide"
        transparent
        onRequestClose={closeTimePicker}
      >
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>
                {timePickerTarget === "meal"
                  ? "選擇餵食時間"
                  : timePickerTarget === "water"
                    ? "選擇飲水時間"
                    : timePickerTarget === "litter"
                      ? "選擇去廁所時間"
                      : timePickerTarget === "care"
                        ? "選擇護理時間"
                        : "選擇日記時間"}
              </Text>
              <TouchableOpacity onPress={closeTimePicker}>
                <Text style={styles.pickerCloseText}>取消</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.customTimePickerRow}>
              <View style={styles.customTimeSpinnerWrap}>
                <Picker
                  selectedValue={pickerValue.getHours()}
                  onValueChange={(value) =>
                    setPickerValue(
                      buildTimeValue(Number(value), pickerValue.getMinutes()),
                    )
                  }
                  itemStyle={styles.customTimeSpinnerItem}
                  style={styles.customTimeSpinner}
                >
                  {HOUR_OPTIONS.map((hour) => (
                    <Picker.Item
                      key={`hour-${hour}`}
                      label={`${hour}`.padStart(2, "0")}
                      value={hour}
                    />
                  ))}
                </Picker>
              </View>

              <Text style={styles.customTimeDivider}>:</Text>

              <View style={styles.customTimeSpinnerWrap}>
                <Picker
                  selectedValue={pickerValue.getMinutes()}
                  onValueChange={(value) =>
                    setPickerValue(
                      buildTimeValue(pickerValue.getHours(), Number(value)),
                    )
                  }
                  itemStyle={styles.customTimeSpinnerItem}
                  style={styles.customTimeSpinner}
                >
                  {MINUTE_OPTIONS.map((minute) => (
                    <Picker.Item
                      key={`minute-${minute}`}
                      label={`${minute}`.padStart(2, "0")}
                      value={minute}
                    />
                  ))}
                </Picker>
              </View>
            </View>

            <View style={styles.pickerActionRow}>
              <TouchableOpacity
                style={[styles.pickerActionBtn, styles.pickerClearBtn]}
                onPress={closeTimePicker}
              >
                <Text style={styles.pickerClearText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pickerActionBtn, styles.pickerConfirmBtn]}
                onPress={applyTimePickerValue}
              >
                <Text style={styles.pickerConfirmText}>完成</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={savedPickerTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={closeSavedPicker}
      >
        <View style={styles.catalogBackdrop}>
          <View style={styles.savedPickerModal}>
            <View style={styles.savedPickerHeader}>
              <View style={styles.savedPickerTitleWrap}>
                <Text style={styles.catalogTitle}>
                  {savedPickerTarget === "food"
                    ? `選擇常用食物名稱`
                    : "選擇常用Supplement"}
                </Text>
                <Text style={styles.savedPickerSubtitle}>
                  {savedPickerTarget === "food"
                    ? mealCategory === null
                      ? "請先選擇食物類別。"
                      : "選一個已儲存名稱，或關閉後直接輸入新的名稱。"
                    : "選一個已儲存補充品，或關閉後直接輸入新的名稱。"}
                </Text>
              </View>
              <TouchableOpacity onPress={closeSavedPicker}>
                <Ionicons name="close" size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.savedPickerList}
              contentContainerStyle={styles.savedPickerListContent}
              keyboardShouldPersistTaps="handled"
            >
              {savedPickerTarget === "food" ? (
                mealCategory === null ? (
                  <View style={styles.noteCard}>
                    <Text style={styles.noteText}>
                      先選定食物類別，才可挑選對應的常用名稱。
                    </Text>
                  </View>
                ) : filteredSavedFoods.length > 0 ? (
                  filteredSavedFoods.map((item) => (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.savedPickerItem,
                        selectedFoodId === item.id &&
                          styles.savedPickerItemActive,
                      ]}
                      onPress={() => {
                        if (selectedFoodId === item.id) {
                          clearSelectedFood();
                        } else {
                          handleSelectSavedFood(item);
                        }
                        closeSavedPicker();
                      }}
                    >
                      <View style={styles.savedPickerItemBody}>
                        <Text
                          style={[
                            styles.savedPickerItemTitle,
                            selectedFoodId === item.id &&
                              styles.savedPickerItemTitleActive,
                          ]}
                        >
                          {item.name}
                        </Text>
                        <Text style={styles.savedPickerItemMeta}>
                          {MEAL_CATEGORY_ICONS[item.category]}{" "}
                          {MEAL_CATEGORY_LABELS[item.category]}
                        </Text>
                      </View>
                      {selectedFoodId === item.id ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={20}
                          color="#7FA655"
                        />
                      ) : null}
                    </TouchableOpacity>
                  ))
                ) : (
                  <View style={styles.noteCard}>
                    <Text style={styles.noteText}>
                      這個類別還未有常用名稱，直接輸入一次後就會自動建立。
                    </Text>
                  </View>
                )
              ) : savedSupplements.length > 0 ? (
                savedSupplements.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.savedPickerItem,
                      selectedSupplementId === item.id &&
                        styles.savedPickerItemActive,
                    ]}
                    onPress={() => {
                      if (selectedSupplementId === item.id) {
                        clearSelectedSupplement();
                      } else {
                        handleSelectSavedSupplement(item);
                      }
                      closeSavedPicker();
                    }}
                  >
                    <View style={styles.savedPickerItemBody}>
                      <Text
                        style={[
                          styles.savedPickerItemTitle,
                          selectedSupplementId === item.id &&
                            styles.savedPickerItemTitleActive,
                        ]}
                      >
                        {item.name}
                      </Text>
                      <Text style={styles.savedPickerItemMeta}>常用補充品</Text>
                    </View>
                    {selectedSupplementId === item.id ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color="#7FA655"
                      />
                    ) : null}
                  </TouchableOpacity>
                ))
              ) : (
                <View style={styles.noteCard}>
                  <Text style={styles.noteText}>
                    還未有常用補充品，直接輸入一次後就會自動建立。
                  </Text>
                </View>
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.savedPickerCloseBtn}
              onPress={closeSavedPicker}
            >
              <Text style={styles.savedPickerCloseText}>完成</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={foodCatalogVisible}
        transparent
        animationType="fade"
        onRequestClose={closeFoodCatalogManager}
      >
        <View style={styles.catalogBackdrop}>
          <TouchableWithoutFeedback
            onPress={Keyboard.dismiss}
            accessible={false}
          >
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={styles.catalogModal}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 16,
              }}
            >
              <Text style={styles.catalogTitle}>管理常用食物名稱</Text>
              <TouchableOpacity onPress={closeFoodCatalogManager}>
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            {/* Edit form only shows when editing a food */}
            {catalogEditingId && (
              <View>
                <ScrollView
                  style={{
                    maxHeight: 400,
                    marginBottom: 12,
                    paddingBottom: 4,
                  }}
                  keyboardShouldPersistTaps="handled"
                  onScrollBeginDrag={Keyboard.dismiss}
                >
                  <Text style={styles.label}>食物類別</Text>
                  <View style={styles.mealCategoryRow}>
                    {MEAL_CATEGORIES.map((category) => (
                      <TouchableOpacity
                        key={category}
                        style={[
                          styles.mealCategoryBtn,
                          catalogCategory === category &&
                            styles.mealCategoryBtnActive,
                        ]}
                        onPress={() => setCatalogCategory(category)}
                      >
                        <Text style={styles.mealCategoryIcon}>
                          {MEAL_CATEGORY_ICONS[category]}
                        </Text>
                        <Text
                          style={[
                            styles.mealCategoryText,
                            catalogCategory === category &&
                              styles.mealCategoryTextActive,
                          ]}
                        >
                          {MEAL_CATEGORY_LABELS[category]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.label}>修改名稱</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="例如 Royal Canin Indoor"
                    value={catalogName}
                    onChangeText={setCatalogName}
                  />

                  {/* Kcal fields for food */}
                  <Text style={styles.label}>熱量（每單位）</Text>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <TextInput
                      style={[styles.input, { flex: 1, minWidth: 80 }]}
                      placeholder="例如 350"
                      value={
                        typeof catalogKcalAmount === "number"
                          ? String(catalogKcalAmount)
                          : ""
                      }
                      onChangeText={(text) =>
                        setCatalogKcalAmount(
                          text === "" ? undefined : Number(text),
                        )
                      }
                      keyboardType="decimal-pad"
                    />
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 4,
                        maxWidth: 140,
                      }}
                    >
                      {KCAL_UNITS.map((unit) => (
                        <TouchableOpacity
                          key={unit}
                          style={[
                            styles.foodPreferenceButton,
                            catalogKcalUnit === unit &&
                              styles.foodPreferenceButtonActive,
                            { marginBottom: 4 },
                          ]}
                          onPress={() => setCatalogKcalUnit(unit)}
                        >
                          <Text
                            style={[
                              styles.foodPreferenceButtonText,
                              catalogKcalUnit === unit &&
                                styles.foodPreferenceButtonTextActive,
                            ]}
                          >
                            {formatKcalUnit(unit)}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <Text style={styles.helperText}>
                    可選填。輸入此食物的熱量後，日誌將自動帶入。
                  </Text>

                  <Text style={styles.label}>主子反應（選填）</Text>
                  <View style={styles.foodPreferenceRow}>
                    {FOOD_PREFERENCE_OPTIONS.map((preference) => {
                      const selected = catalogPreference === preference;
                      return (
                        <TouchableOpacity
                          key={preference}
                          style={[
                            styles.foodPreferenceButton,
                            selected && styles.foodPreferenceButtonActive,
                          ]}
                          onPress={() =>
                            setCatalogPreference((current) =>
                              current === preference ? null : preference,
                            )
                          }
                        >
                          <Text
                            style={[
                              styles.foodPreferenceButtonText,
                              selected && styles.foodPreferenceButtonTextActive,
                            ]}
                          >
                            {FOOD_PREFERENCE_ICONS[preference]}{" "}
                            {FOOD_PREFERENCE_LABELS[preference]}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
                <View style={styles.catalogActionRow}>
                  <TouchableOpacity
                    style={[styles.catalogActionBtn, styles.catalogCancelBtn]}
                    onPress={() => resetCatalogEditor()}
                  >
                    <Text style={styles.catalogCancelText}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.catalogActionBtn, styles.catalogSaveBtn]}
                    onPress={handleSaveFoodCatalogItem}
                  >
                    <Text style={styles.catalogSaveText}>更新</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <Text style={styles.catalogListTitle}>已儲存名稱</Text>
            <ScrollView
              style={styles.catalogList}
              contentContainerStyle={styles.catalogListContent}
              keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={Keyboard.dismiss}
            >
              {foodCatalog.length > 0 ? (
                foodCatalog.map((item) => (
                  <View key={item.id} style={styles.catalogItem}>
                    <View style={styles.catalogItemInfo}>
                      <View style={styles.catalogItemTitleRow}>
                        <Text style={styles.catalogItemName}>{item.name}</Text>
                        {item.preference ? (
                          <View
                            style={[
                              styles.foodPreferenceBadge,
                              getFoodPreferenceBadgeStyle(item.preference)
                                .container,
                            ]}
                          >
                            <Text
                              style={[
                                styles.foodPreferenceBadgeText,
                                getFoodPreferenceBadgeStyle(item.preference)
                                  .text,
                              ]}
                            >
                              {FOOD_PREFERENCE_ICONS[item.preference]}{" "}
                              {FOOD_PREFERENCE_LABELS[item.preference]}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.catalogItemMeta}>
                        {MEAL_CATEGORY_ICONS[item.category]}{" "}
                        {MEAL_CATEGORY_LABELS[item.category]}
                      </Text>
                    </View>
                    <View style={styles.catalogItemActions}>
                      <TouchableOpacity
                        onPress={() => handleEditCatalogItem(item)}
                      >
                        <Text style={styles.catalogEditText}>編輯</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleRemoveCatalogItem(item)}
                      >
                        <Text style={styles.catalogDeleteText}>刪除</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.noteCard}>
                  <Text style={styles.noteText}>尚未有已儲存的食物名稱。</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: "#ececec",
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#ececec",
  },
  chipActive: {
    backgroundColor: "#7FA655",
    borderColor: "#7FA655",
  },
  chipText: {
    color: "#4b5563",
    fontSize: 15,
  },
  chipTextActive: {
    color: "#fff",
    fontWeight: "bold",
  },
  container: { flex: 1, backgroundColor: "#F7F4EB" },
  content: {
    padding: 20,
    paddingBottom: 120,
    paddingTop: SCREEN_TOP_CONTENT_PADDING,
  },
  logTopline: {
    marginBottom: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 14,
  },
  logTitleWrap: {
    flex: 1,
  },
  logKicker: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: "#2E7A70",
    marginBottom: 6,
  },
  title: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 30,
    lineHeight: 36,
    color: "#172421",
  },
  logHeaderBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(23,36,33,0.08)",
  },
  logHeaderBadgeText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 12,
  },
  weightShortcut: {
    backgroundColor: "#FFF8ED",
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    borderRadius: 24,
    padding: 16,
    marginBottom: 16,
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
  weightShortcutContent: { flex: 1 },
  weightShortcutLabel: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#111827",
  },
  weightShortcutText: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6E7C74",
    marginTop: 4,
    lineHeight: 18,
  },

  tabScrollView: {
    marginBottom: 24,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 8,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: "#FFFDF6",
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    shadowColor: "#2c231a",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  tabActive: {
    backgroundColor: "#FFFDF6",
  },
  tabText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 14,
    color: "#34423E",
  },
  tabTextActive: { fontFamily: "ZenMaruGothic-Bold", color: "#7FA655" },
  logGuideCard: {
    marginTop: 10,
    borderRadius: 20,
    backgroundColor: "#FFF9EF",
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  logGuideTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 14,
    color: "#111827",
  },
  logGuideText: {
    marginTop: 4,
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    lineHeight: 18,
    color: "#6b7280",
  },

  form: { gap: 4 },
  label: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 14,
    color: "#374151",
    marginBottom: 6,
    marginTop: 12,
  },
  helperText: { fontSize: 12, color: "#6b7280" },
  timeTrigger: {
    marginTop: 4,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: "#FFFDF6",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  timeTriggerLabel: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6b7280",
  },
  timeTriggerValue: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 16,
    color: "#111827",
    marginTop: 2,
  },
  compactSelectorCard: {
    marginTop: 8,
    padding: 14,
    borderRadius: 20,
    backgroundColor: "#FFF9EF",
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    gap: 10,
  },
  input: {
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#FFFDF6",
  },
  mealCategoryRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  mealCategoryBtn: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    backgroundColor: "#FFFDF6",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 6,
  },
  mealCategoryBtnActive: {
    backgroundColor: "#fff7ed",
    borderColor: "#7FA655",
  },
  mealCategoryIcon: { fontSize: 22 },
  mealCategoryText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#6b7280",
  },
  mealCategoryTextActive: {
    color: "#7FA655",
    fontFamily: "ZenMaruGothic-Bold",
  },
  mealSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  manageFoodText: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#7FA655",
    fontSize: 13,
    marginTop: 10,
  },
  savedFoodWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  savedFoodList: {
    maxHeight: 176,
    marginVertical: 8,
  },
  savedFoodGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  savedFoodCard: {
    minWidth: "47%",
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  savedFoodCardActive: {
    backgroundColor: "#f0fdf4",
    borderColor: "#7FA655",
  },
  savedFoodCardContent: {
    gap: 8,
  },
  savedFoodCardBrand: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#6b7280",
    fontSize: 12,
  },
  savedFoodCardBrandActive: {
    color: "#4D7C0F",
  },
  savedFoodCardText: {
    fontFamily: "ZenMaruGothic-Bold",
    color: "#111827",
    fontSize: 13,
    lineHeight: 18,
  },
  savedFoodCardTextActive: {
    color: "#14532d",
  },
  savedFoodCardPreferenceIcon: {
    fontSize: 12,
    color: "#7FA655",
  },
  savedFoodChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  savedFoodChipActive: {
    backgroundColor: "#fff7ed",
    borderColor: "#7FA655",
  },
  savedFoodChipText: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#4b5563",
    fontSize: 13,
  },
  savedFoodChipTextActive: {
    fontFamily: "ZenMaruGothic-Bold",
    color: "#7FA655",
  },
  savedFoodChipContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  savedFoodChipPreferenceIcon: {
    fontSize: 12,
  },
  selectorTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 14,
    backgroundColor: "#fafafa",
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },
  selectorTriggerDisabled: {
    backgroundColor: "#f8fafc",
    borderColor: "#e2e8f0",
  },
  selectorTriggerActive: {
    backgroundColor: "#fff7ed",
    borderColor: "#7FA655",
  },
  selectorTriggerBody: {
    flex: 1,
    gap: 2,
  },
  selectorTriggerTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 14,
    color: "#111827",
  },
  selectorTriggerPlaceholder: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#6b7280",
  },
  selectorTriggerMeta: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6b7280",
  },
  selectorClearBtn: {
    alignSelf: "flex-start",
  },
  selectorClearText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 12,
    color: "#dc2626",
  },
  selectorInputLabel: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#4b5563",
  },
  foodPreferenceRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  foodPreferenceButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#fafafa",
  },
  foodPreferenceButtonActive: {
    backgroundColor: "#fff7ed",
    borderColor: "#7FA655",
  },
  foodPreferenceButtonText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#6b7280",
  },
  foodPreferenceButtonTextActive: {
    fontFamily: "ZenMaruGothic-Bold",
    color: "#7FA655",
  },

  presetRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  manualInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  manualWaterInput: { flex: 1 },
  manualWaterUnit: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 15,
    color: "#6b7280",
  },
  presetBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#fafafa",
  },
  presetBtnActive: { backgroundColor: "#fff7ed", borderColor: "#7FA655" },
  presetBtnText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 14,
    color: "#6b7280",
  },
  presetBtnTextActive: { color: "#7FA655" },

  waterCard: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 16,
    padding: 14,
    backgroundColor: "#fafafa",
  },
  bowlWrap: {
    marginTop: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  bowl: {
    width: WATER_BOWL_WIDTH,
    height: WATER_BOWL_HEIGHT,
    borderWidth: 2,
    borderColor: "#cbd5e1",
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    borderBottomLeftRadius: 25,
    borderBottomRightRadius: 25,
    backgroundColor: "#eff6ff",
    overflow: "hidden",
  },
  waterFill: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#7dd3fc",
    opacity: 0.9,
  },
  waterSurfaceMarker: {
    position: "absolute",
    left: 0,
    right: 0,
    height: WATER_LINE_HEIGHT,
  },
  waterHandleTouchArea: {
    position: "absolute",
    left: 0,
    width: WATER_BOWL_WIDTH,
    height: WATER_HANDLE_SIZE,
  },
  waterHandleLine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: WATER_LINE_HEIGHT,
    backgroundColor: "#0ea5e9",
    borderRadius: 0,
  },
  waterHandleText: { fontFamily: "ZenMaruGothic-Bold", color: "#0ea5e9" },
  waterValue: {
    fontFamily: "ZenMaruGothic-Bold",
    marginTop: 12,
    textAlign: "center",
    fontSize: 18,
    color: "#0f172a",
  },
  waterTag: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 12,
    color: "#7FA655",
  },

  litterRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  litterBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    backgroundColor: "#fafafa",
  },
  litterBtnActive: { backgroundColor: "#fff7ed", borderColor: "#7FA655" },
  litterBtnText: { fontSize: 13, color: "#6b7280" },
  litterBtnTextActive: { color: "#7FA655", fontWeight: "600" },

  countRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  countBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#fdba74",
    alignItems: "center",
    justifyContent: "center",
  },
  countBtnText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 24,
    color: "#7FA655",
    marginTop: -2,
  },
  countValueWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  countValue: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 30,
    color: "#111827",
  },

  noteCard: {
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 12,
  },
  noteText: {
    fontFamily: "ZenMaruGothic-Regular",
    color: "#475569",
    fontSize: 13,
    lineHeight: 18,
  },

  saveBtn: {
    marginTop: 32,
    backgroundColor: "#7FA655",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  saveBtnText: {
    fontFamily: "ZenMaruGothic-Bold",
    color: "#fff",
    fontSize: 16,
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
  customTimePickerRow: {
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "center",
    marginTop: 8,
  },
  customTimeSpinnerWrap: {
    flex: 1,
    maxWidth: 132,
    height: 216,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#fafafa",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  customTimeSpinner: {
    flex: 1,
  },
  customTimeSpinnerItem: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 26,
    color: "#111827",
  },
  customTimeDivider: {
    alignSelf: "center",
    marginHorizontal: 10,
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 30,
    color: "#111827",
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
  catalogBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  catalogModal: {
    maxHeight: "80%",
    borderRadius: 20,
    backgroundColor: "#fff",
    padding: 20,
  },
  savedPickerModal: {
    maxHeight: "72%",
    borderRadius: 20,
    backgroundColor: "#fff",
    padding: 20,
  },
  savedPickerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  savedPickerTitleWrap: {
    flex: 1,
  },
  savedPickerSubtitle: {
    marginTop: 4,
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    lineHeight: 18,
    color: "#6b7280",
  },
  savedPickerList: {
    marginTop: 16,
    maxHeight: 320,
  },
  savedPickerListContent: {
    gap: 10,
    paddingBottom: 4,
  },
  savedPickerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 14,
    backgroundColor: "#fafafa",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  savedPickerItemActive: {
    borderColor: "#7FA655",
    backgroundColor: "#fff7ed",
  },
  savedPickerItemBody: {
    flex: 1,
    gap: 2,
  },
  savedPickerItemTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 14,
    color: "#111827",
  },
  savedPickerItemTitleActive: {
    color: "#c2410c",
  },
  savedPickerItemMeta: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6b7280",
  },
  savedPickerCloseBtn: {
    marginTop: 16,
    borderRadius: 12,
    backgroundColor: "#7FA655",
    paddingVertical: 14,
    alignItems: "center",
  },
  savedPickerCloseText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#fff",
  },
  catalogTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 20,
    color: "#111827",
    marginBottom: 4,
  },
  catalogActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  catalogActionBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
  },
  catalogCancelBtn: {
    backgroundColor: "#f3f4f6",
  },
  catalogSaveBtn: {
    backgroundColor: "#7FA655",
  },
  catalogCancelText: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#4b5563",
    fontSize: 15,
  },
  catalogSaveText: {
    fontFamily: "ZenMaruGothic-Bold",
    color: "#fff",
    fontSize: 15,
  },
  catalogListTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 16,
    color: "#111827",
    marginTop: 20,
    marginBottom: 8,
  },
  catalogList: {
    maxHeight: 260,
  },
  catalogListContent: {
    gap: 10,
    paddingBottom: 4,
  },
  catalogItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#fafafa",
  },
  catalogItemInfo: {
    flex: 1,
    paddingRight: 12,
  },
  catalogItemTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  catalogItemName: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 14,
    color: "#111827",
  },
  catalogItemMeta: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
  },
  catalogItemActions: {
    flexDirection: "row",
    gap: 12,
  },
  catalogEditText: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#2563eb",
    fontSize: 13,
  },
  catalogDeleteText: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#dc2626",
    fontSize: 13,
  },
  foodPreferenceBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  foodPreferenceBadgeLike: {
    backgroundColor: "#ecfdf5",
  },
  foodPreferenceBadgeNeutral: {
    backgroundColor: "#f3f4f6",
  },
  foodPreferenceBadgeDislike: {
    backgroundColor: "#fef2f2",
  },
  foodPreferenceBadgeText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 11,
  },
  foodPreferenceBadgeTextLike: {
    color: "#15803d",
  },
  foodPreferenceBadgeTextNeutral: {
    color: "#4b5563",
  },
  foodPreferenceBadgeTextDislike: {
    color: "#b91c1c",
  },
  foodPreferenceSummaryCard: {
    marginTop: 16,
    borderRadius: 14,
    backgroundColor: "#fffdf9",
    borderWidth: 1,
    borderColor: "#ede9e1",
    padding: 14,
    gap: 12,
  },
  foodPreferenceSummaryTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#111827",
  },
  foodPreferenceSummarySection: {
    gap: 8,
  },
  foodPreferenceSummaryLabel: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#4b5563",
  },
  foodPreferenceSummaryChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  foodPreferenceSummaryChipLike: {
    borderRadius: 999,
    backgroundColor: "#ecfdf5",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  foodPreferenceSummaryChipDislike: {
    borderRadius: 999,
    backgroundColor: "#fef2f2",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  foodPreferenceSummaryChipTextLike: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 12,
    color: "#15803d",
  },
  foodPreferenceSummaryChipTextDislike: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 12,
    color: "#b91c1c",
  },

  // Care styles
  careGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  careBtn: {
    width: "22%",
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fafafa",
    gap: 4,
  },
  careBtnActive: { backgroundColor: "#f0fdf4", borderColor: "#22c55e" },
  careIcon: { fontSize: 24 },
  careBtnText: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 11,
    color: "#6b7280",
    textAlign: "center",
  },
  careBtnTextActive: { color: "#16a34a", fontFamily: "ZenMaruGothic-Medium" },

  // Mood styles
  moodGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  moodBtn: {
    width: "30%",
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fafafa",
    gap: 4,
  },
  moodBtnActive: { backgroundColor: "#faf5ff", borderColor: "#a855f7" },
  moodIcon: { fontSize: 28 },
  moodBtnText: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
  },
  moodBtnTextActive: { color: "#9333ea", fontFamily: "ZenMaruGothic-Medium" },

  // Journal photo
  journalPhotoBtn: {
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: "center",
    backgroundColor: "#f9fafb",
  },
  journalPhotoBtnText: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 16,
    color: "#6b7280",
  },
  journalPhotoContainer: { gap: 8 },
  journalPhotoPreview: {
    width: "100%",
    height: 200,
    borderRadius: 12,
  },
  journalPhotoRemove: { alignSelf: "flex-end" },
  journalPhotoRemoveText: {
    fontFamily: "ZenMaruGothic-Regular",
    color: "#ef4444",
    fontSize: 13,
  },
});
