import { Ionicons } from "@expo/vector-icons";
import { doc, runTransaction, setDoc } from "firebase/firestore";
import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import EditTimePickerModal from "../components/EditTimePickerModal";
import {
  MEAL_CATEGORY_ICONS,
  MEAL_CATEGORY_LABELS,
} from "../constants/localization";
import { SCREEN_TOP_CONTENT_PADDING } from "../constants/theme";
import { db } from "../firebase";
import { usePetSession } from "../hooks/usePetSession";
import {
  mergeFoodCatalogs,
  normalizeFoodName,
  sortFoodCatalog,
} from "../lib/mealCatalog";
import {
  calculateMealKcalFromEntry,
  DEFAULT_KCAL_UNIT,
  formatKcalUnit,
  resolveKcalDensity,
} from "../lib/mealKcal";
import {
  buildScheduleFoodCatalog,
  createWeeklyMealScheduleId,
  getNextDaySortOrder,
  isValidScheduleTime,
  resequenceDayEntries,
  sortScheduleEntries,
  WEEKDAY_LABELS,
  WEEKDAY_ORDER,
} from "../lib/mealSchedule";
import {
  FeederConfig,
  FeederSchedule,
  KcalUnit,
  MealCategory,
  Weekday,
  WeeklyMealScheduleEntry,
} from "../types";

type ScheduleFormState = {
  days: Weekday[];
  time: string;
  category: MealCategory;
  grams: string;
  foodName: string;
  brandName: string;
  note: string;
  kcalAmount: string;
  kcalUnit: KcalUnit;
};

type ActivityLevel = "sedentary" | "moderate" | "active";
type WeightGoal = "maintain" | "gain" | "lose";
type SavedScheduleFoodOption = {
  id: string;
  category: MealCategory;
  name: string;
  brandName?: string;
  kcalAmount?: number;
  kcalUnit?: KcalUnit;
  kcalPerKg?: number;
};

type FeederScheduleDraft = {
  id: string;
  portion: string;
  unit: FeederSchedule["unit"];
  dispatchTime: string;
  foodName: string;
  kcalAmount: string;
  kcalUnit: FeederSchedule["kcalUnit"];
};

const APP_BACKGROUND = "#F7F4EB";
const CARD_BACKGROUND = "#FFFDF7";
const DAY_STRIPE_COLORS: Record<Weekday, string> = {
  mon: "#A8D5BA",
  tue: "#F6D186",
  wed: "#F1B5CB",
  thu: "#B8D8F8",
  fri: "#C9C3F5",
  sat: "#F8C291",
  sun: "#B7E4C7",
};
const MEAL_CATEGORIES: MealCategory[] = ["dry", "wet", "snack"];

const MAINTENANCE_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  moderate: 1.4,
  active: 1.6,
};

const GAIN_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.4,
  moderate: 1.6,
  active: 1.8,
};

const LOSE_RER_FACTOR_MIN = 0.7;
const LOSE_RER_FACTOR_MAX = 0.8;

function calculateCatDailyKcal(
  weightKg: number,
  activityLevel: ActivityLevel,
  weightGoal: WeightGoal,
): { min: number; max: number; recommended: number } {
  if (weightKg <= 0) return { min: 0, max: 0, recommended: 0 };
  const rer = 70 * Math.pow(weightKg, 0.75);
  if (weightGoal === "lose") {
    const min = Math.round(rer * LOSE_RER_FACTOR_MIN);
    const max = Math.round(rer * LOSE_RER_FACTOR_MAX);
    return { min, max, recommended: Math.round((min + max) / 2) };
  }
  if (weightGoal === "gain") {
    const multiplier = GAIN_MULTIPLIERS[activityLevel];
    const recommended = Math.round(rer * multiplier);
    return { min: recommended, max: recommended, recommended };
  }
  const multiplier = MAINTENANCE_MULTIPLIERS[activityLevel];
  const recommended = Math.round(rer * multiplier);
  return { min: recommended, max: recommended, recommended };
}

function createDefaultForm(day: Weekday): ScheduleFormState {
  return {
    days: [day],
    time: "08:00",
    category: "wet",
    grams: "",
    foodName: "",
    brandName: "",
    note: "",
    kcalAmount: "",
    kcalUnit: DEFAULT_KCAL_UNIT,
  };
}

function createFeederDraft(): FeederScheduleDraft {
  return {
    id: `feeder-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    portion: "",
    unit: "g",
    dispatchTime: "08:00",
    foodName: "",
    kcalAmount: "",
    kcalUnit: DEFAULT_KCAL_UNIT,
  };
}

function parseTimeToDate(value: string): Date {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
}

function formatTimeInput(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

function sortSelectedDays(days: Weekday[]): Weekday[] {
  return WEEKDAY_ORDER.filter((day) => days.includes(day));
}

function normalizeMealIdentityValue(value?: string): string {
  return normalizeFoodName(value ?? "").toLowerCase();
}

function buildSavedFoodKey(
  category: MealCategory,
  name: string,
  brandName?: string,
): string {
  return [
    category,
    normalizeMealIdentityValue(brandName),
    normalizeMealIdentityValue(name),
  ].join("::");
}

function isSameScheduleMeal(
  left: Pick<
    WeeklyMealScheduleEntry,
    "time" | "category" | "foodName" | "brandName"
  >,
  right: Pick<
    WeeklyMealScheduleEntry,
    "time" | "category" | "foodName" | "brandName"
  >,
): boolean {
  return (
    left.time === right.time &&
    left.category === right.category &&
    normalizeMealIdentityValue(left.foodName) ===
      normalizeMealIdentityValue(right.foodName) &&
    normalizeMealIdentityValue(left.brandName) ===
      normalizeMealIdentityValue(right.brandName)
  );
}

const ScheduleMealCard = memo(function ScheduleMealCard({
  item,
  onEdit,
  onDelete,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  item: WeeklyMealScheduleEntry;
  onEdit: (entry: WeeklyMealScheduleEntry) => void;
  onDelete: (entry: WeeklyMealScheduleEntry) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.92}
      onPress={() => onEdit(item)}
      style={styles.mealCard}
    >
      <View style={styles.mealTimePill}>
        <Ionicons name="time-outline" size={13} color="#14532d" />
        <Text style={styles.mealTimeText}>{item.time}</Text>
      </View>
      <View style={styles.mealTitleRow}>
        <Text style={styles.mealIcon}>
          {MEAL_CATEGORY_ICONS[item.category]}
        </Text>
        <View style={styles.mealTitleWrap}>
          {item.brandName ? (
            <>
              <Text style={styles.mealBrandName} numberOfLines={1}>
                {item.brandName}
              </Text>
              <Text style={styles.mealTitle} numberOfLines={1}>
                {item.foodName}
              </Text>
            </>
          ) : (
            <Text style={styles.mealTitle} numberOfLines={2}>
              {item.foodName}
            </Text>
          )}
          <Text style={styles.mealMeta}>
            {MEAL_CATEGORY_LABELS[item.category]} ・ {item.grams} g
            {calculateMealKcalFromEntry(item) > 0
              ? ` ・ ${calculateMealKcalFromEntry(item)} kcal`
              : ""}
          </Text>
        </View>
      </View>
      <View style={styles.mealActionColumn}>
        <TouchableOpacity
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => onDelete(item)}
          style={styles.mealIconButton}
        >
          <Ionicons name="trash-outline" size={17} color="#9A3412" />
        </TouchableOpacity>
        <View style={styles.mealReorderColumn}>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={!canMoveUp}
            hitSlop={8}
            onPress={onMoveUp}
            style={[
              styles.mealIconButton,
              !canMoveUp && styles.mealIconButtonDisabled,
            ]}
          >
            <Ionicons name="chevron-up" size={16} color="#6B7280" />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={!canMoveDown}
            hitSlop={8}
            onPress={onMoveDown}
            style={[
              styles.mealIconButton,
              !canMoveDown && styles.mealIconButtonDisabled,
            ]}
          >
            <Ionicons name="chevron-down" size={16} color="#6B7280" />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
});

export default function Schedule() {
  const { user, pets, activePet, profile, refresh, updateSharedCatalogs } =
    usePetSession();
  const [entries, setEntries] = useState<WeeklyMealScheduleEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [selectedSavedFoodId, setSelectedSavedFoodId] = useState<string | null>(
    null,
  );
  const [formState, setFormState] = useState<ScheduleFormState>(
    createDefaultForm("mon"),
  );
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [timePickerValue, setTimePickerValue] = useState<Date>(
    parseTimeToDate("08:00"),
  );
  const [feederEditorVisible, setFeederEditorVisible] = useState(false);
  const [autoFeederEnabled, setAutoFeederEnabled] = useState(false);
  const [feederSchedules, setFeederSchedules] = useState<FeederScheduleDraft[]>(
    [],
  );
  const [feederSaving, setFeederSaving] = useState(false);
  const [feederTimePickerTarget, setFeederTimePickerTarget] = useState<
    string | null
  >(null);
  const [feederTimePickerValue, setFeederTimePickerValue] = useState<Date>(
    parseTimeToDate("08:00"),
  );
  const [catWeight, setCatWeight] = useState<string>(
    activePet?.weight ? String(activePet.weight) : "",
  );
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>(
    (activePet as any)?.kcalActivityLevel ?? "moderate",
  );
  const [weightGoal, setWeightGoal] = useState<WeightGoal>(
    (activePet as any)?.kcalWeightGoal ?? "maintain",
  );
  const activePetKcalActivityLevel = (activePet as any)?.kcalActivityLevel as
    | ActivityLevel
    | undefined;
  const activePetKcalWeightGoal = (activePet as any)?.kcalWeightGoal as
    | WeightGoal
    | undefined;

  const syncFeederEditorState = useCallback((nextPet: typeof activePet) => {
    if (nextPet?.feederConfig?.enabled) {
      setAutoFeederEnabled(true);
      setFeederSchedules(
        nextPet.feederConfig.schedules.length > 0
          ? nextPet.feederConfig.schedules.map((schedule) => ({
              id: schedule.id,
              portion: `${schedule.portion}`,
              unit: schedule.unit,
              dispatchTime: schedule.dispatchTime,
              foodName: schedule.foodName ?? "",
              kcalAmount:
                typeof schedule.kcalAmount === "number"
                  ? `${schedule.kcalAmount}`
                  : "",
              kcalUnit: schedule.kcalUnit ?? DEFAULT_KCAL_UNIT,
            }))
          : [],
      );
      return;
    }

    setAutoFeederEnabled(false);
    setFeederSchedules([]);
  }, []);

  useEffect(() => {
    setEntries(sortScheduleEntries(activePet?.weeklyMealSchedule ?? []));
    if (activePet?.weight) setCatWeight(String(activePet.weight));
    if (activePetKcalActivityLevel)
      setActivityLevel(activePetKcalActivityLevel);
    if (activePetKcalWeightGoal) setWeightGoal(activePetKcalWeightGoal);
    syncFeederEditorState(activePet);
  }, [
    activePet,
    activePet?.weeklyMealSchedule,
    activePet?.weight,
    activePetKcalActivityLevel,
    activePetKcalWeightGoal,
    syncFeederEditorState,
  ]);

  const dailyKcal = useMemo(() => {
    const weight = parseFloat(catWeight);
    if (!weight || weight <= 0) return { min: 0, max: 0, recommended: 0 };
    return calculateCatDailyKcal(weight, activityLevel, weightGoal);
  }, [catWeight, activityLevel, weightGoal]);

  const savedScheduleFoods = useMemo(() => {
    const options = new Map<string, SavedScheduleFoodOption>();
    const sharedFoodOptions = mergeFoodCatalogs(
      profile?.sharedFoodCatalog ?? [],
      pets.flatMap((pet) => pet.foodCatalog ?? []),
    );
    sharedFoodOptions.forEach((item) => {
      const normalizedFoodName = normalizeFoodName(item.name);
      if (!normalizedFoodName) return;
      const normalizedBrandName = normalizeFoodName(item.brandName ?? "");
      const key = buildSavedFoodKey(
        item.category,
        normalizedFoodName,
        normalizedBrandName,
      );
      options.set(key, {
        id: item.id,
        category: item.category,
        name: normalizedFoodName,
        ...(normalizedBrandName ? { brandName: normalizedBrandName } : {}),
      });
    });
    entries.forEach((entry) => {
      const normalizedFoodName = normalizeFoodName(entry.foodName);
      if (!normalizedFoodName) return;
      const normalizedBrandName = normalizeFoodName(entry.brandName ?? "");
      const kcalDensity = resolveKcalDensity(entry);
      const key = buildSavedFoodKey(
        entry.category,
        normalizedFoodName,
        normalizedBrandName,
      );
      const existingOption = options.get(key);
      if (!existingOption) {
        options.set(key, {
          id: key,
          category: entry.category,
          name: normalizedFoodName,
          ...(normalizedBrandName ? { brandName: normalizedBrandName } : {}),
          ...(kcalDensity
            ? { kcalAmount: kcalDensity.amount, kcalUnit: kcalDensity.unit }
            : {}),
        });
        return;
      }
      if (!resolveKcalDensity(existingOption) && kcalDensity) {
        options.set(key, {
          ...existingOption,
          kcalAmount: kcalDensity.amount,
          kcalUnit: kcalDensity.unit,
        });
      }
    });
    return [...options.values()].sort((left, right) => {
      if (left.category !== right.category)
        return left.category.localeCompare(right.category);
      const brandCompare = normalizeFoodName(
        left.brandName ?? "",
      ).localeCompare(normalizeFoodName(right.brandName ?? ""), "zh-HK");
      if (brandCompare !== 0) return brandCompare;
      return left.name.localeCompare(right.name, "zh-HK");
    });
  }, [entries, pets, profile?.sharedFoodCatalog]);

  const filteredSavedFoods = useMemo(
    () =>
      savedScheduleFoods.filter((item) => item.category === formState.category),
    [formState.category, savedScheduleFoods],
  );

  const selectedSavedFood = useMemo(
    () =>
      filteredSavedFoods.find((item) => item.id === selectedSavedFoodId) ??
      null,
    [filteredSavedFoods, selectedSavedFoodId],
  );

  const shouldShowKcalInput = !(
    selectedSavedFood && typeof selectedSavedFood.kcalAmount === "number"
  );

  const feederSavedFoods = useMemo(
    () =>
      savedScheduleFoods.filter(
        (item) => normalizeFoodName(item.name).length > 0,
      ),
    [savedScheduleFoods],
  );

  const weeklyGroups = useMemo(
    () =>
      WEEKDAY_ORDER.map((day) => {
        const dayItems = [...entries]
          .filter((entry) => entry.day === day)
          .sort(
            (left, right) =>
              left.time.localeCompare(right.time) ||
              left.sortOrder - right.sortOrder,
          );
        return { day, items: dayItems };
      }),
    [entries],
  );

  const getDayKcal = useCallback(
    (day: Weekday): number => {
      const dayItems = entries.filter((entry) => entry.day === day);
      return dayItems.reduce(
        (sum, entry) => sum + calculateMealKcalFromEntry(entry),
        0,
      );
    },
    [entries],
  );

  const getKcalStatusColor = useCallback(
    (dayKcal: number): string => {
      if (dailyKcal.recommended === 0) return "#94A3B8";
      const tolerance = dailyKcal.recommended * 0.1;
      const min = dailyKcal.recommended - tolerance;
      const max = dailyKcal.recommended + tolerance;
      if (dayKcal >= min && dayKcal <= max) return "#7FA655";
      if (dayKcal < min) return "#F59E0B";
      return "#EF4444";
    },
    [dailyKcal.recommended],
  );

  const resetEditor = useCallback((day: Weekday) => {
    setEditingEntryId(null);
    setSelectedSavedFoodId(null);
    setFormState(createDefaultForm(day));
    setTimePickerValue(parseTimeToDate("08:00"));
    setShowTimePicker(false);
  }, []);

  const openCreateModal = useCallback(
    (day: Weekday) => {
      resetEditor(day);
      setEditorVisible(true);
    },
    [resetEditor],
  );

  const openEditModal = useCallback(
    (entry: WeeklyMealScheduleEntry) => {
      const linkedEntries = entries.filter((item) =>
        isSameScheduleMeal(item, entry),
      );
      const kcalDensity = resolveKcalDensity(entry);
      const matchedSavedFood = savedScheduleFoods.find(
        (item) =>
          item.category === entry.category &&
          normalizeMealIdentityValue(item.name) ===
            normalizeMealIdentityValue(entry.foodName) &&
          normalizeMealIdentityValue(item.brandName) ===
            normalizeMealIdentityValue(entry.brandName),
      );
      setEditingEntryId(entry.id);
      setSelectedSavedFoodId(matchedSavedFood?.id ?? null);
      setFormState({
        days: sortSelectedDays(
          linkedEntries.length > 0
            ? linkedEntries.map((item) => item.day)
            : [entry.day],
        ),
        time: entry.time,
        category: entry.category,
        grams: String(entry.grams),
        foodName: entry.foodName,
        brandName: entry.brandName ?? "",
        note: entry.note ?? "",
        kcalAmount: kcalDensity ? String(kcalDensity.amount) : "",
        kcalUnit: kcalDensity?.unit ?? DEFAULT_KCAL_UNIT,
      });
      setTimePickerValue(parseTimeToDate(entry.time));
      setShowTimePicker(false);
      setEditorVisible(true);
    },
    [entries, savedScheduleFoods],
  );

  const closeEditor = useCallback(() => {
    setEditorVisible(false);
    setEditingEntryId(null);
    setSelectedSavedFoodId(null);
    setShowTimePicker(false);
  }, []);

  const handleSelectSavedFood = useCallback(
    (item: SavedScheduleFoodOption) => {
      const isSameSelection = selectedSavedFoodId === item.id;
      setSelectedSavedFoodId(isSameSelection ? null : item.id);
      setFormState((current) => {
        if (isSameSelection) {
          return {
            ...current,
            brandName: "",
            foodName: "",
            kcalAmount: "",
            kcalUnit: DEFAULT_KCAL_UNIT,
          };
        }
        return {
          ...current,
          category: item.category,
          brandName: item.brandName ?? "",
          foodName: item.name,
          kcalAmount:
            typeof item.kcalAmount === "number" ? String(item.kcalAmount) : "",
          kcalUnit: item.kcalUnit ?? DEFAULT_KCAL_UNIT,
        };
      });
    },
    [selectedSavedFoodId],
  );

  const persistEntries = useCallback(
    async (nextEntries: WeeklyMealScheduleEntry[]) => {
      if (!user || !activePet) {
        Alert.alert("尚未選擇寵物", "請先建立或選擇一個寵物資料。");
        return false;
      }
      const normalizedEntries = sortScheduleEntries(
        nextEntries.map((entry) => {
          const { brandName, note, barcode, ...requiredEntry } = entry;
          const normalizedBrandName = normalizeFoodName(brandName ?? "");
          const normalizedNote = normalizeFoodName(note ?? "");
          const normalizedBarcode = normalizeFoodName(barcode ?? "");
          const kcalDensity = resolveKcalDensity(entry);
          return {
            ...requiredEntry,
            foodName: normalizeFoodName(entry.foodName),
            ...(normalizedBrandName ? { brandName: normalizedBrandName } : {}),
            ...(normalizedNote ? { note: normalizedNote } : {}),
            ...(normalizedBarcode ? { barcode: normalizedBarcode } : {}),
            ...(kcalDensity
              ? { kcalAmount: kcalDensity.amount, kcalUnit: kcalDensity.unit }
              : {}),
          };
        }),
      );
      setSaving(true);
      try {
        const userRef = doc(db, "users", user.uid);
        const petRef = doc(db, "pets", activePet.id);
        const optimisticCatalog = sortFoodCatalog(
          buildScheduleFoodCatalog(
            normalizedEntries,
            mergeFoodCatalogs(
              profile?.sharedFoodCatalog ?? [],
              pets.flatMap((pet) => pet.foodCatalog ?? []),
            ),
          ),
        );
        await Promise.all([
          setDoc(
            petRef,
            { weeklyMealSchedule: normalizedEntries },
            { merge: true },
          ),
          setDoc(
            userRef,
            { sharedFoodCatalog: optimisticCatalog },
            { merge: true },
          ),
        ]);
        setEntries(normalizedEntries);
        updateSharedCatalogs({ foodCatalog: optimisticCatalog });
        void refresh().catch((error) =>
          console.error("Failed to refresh pet session:", error),
        );
        return true;
      } catch (error) {
        Alert.alert(
          "儲存失敗",
          error instanceof Error ? error.message : "更新餵食Schedule失敗。",
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [
      activePet,
      pets,
      profile?.sharedFoodCatalog,
      refresh,
      updateSharedCatalogs,
      user,
    ],
  );

  const persistKcalSettings = useCallback(
    async (newActivityLevel: ActivityLevel, newWeightGoal: WeightGoal) => {
      if (!activePet) return;
      try {
        const petRef = doc(db, "pets", activePet.id);
        await runTransaction(db, async (transaction) => {
          transaction.set(
            petRef,
            {
              kcalActivityLevel: newActivityLevel,
              kcalWeightGoal: newWeightGoal,
            },
            { merge: true },
          );
        });
        await refresh();
      } catch (error) {
        console.error("Failed to persist kcal settings:", error);
      }
    },
    [activePet, refresh],
  );

  const handleActivityLevelChange = useCallback(
    (level: ActivityLevel) => {
      setActivityLevel(level);
      void persistKcalSettings(level, weightGoal);
    },
    [weightGoal, persistKcalSettings],
  );

  const handleWeightGoalChange = useCallback(
    (goal: WeightGoal) => {
      setWeightGoal(goal);
      void persistKcalSettings(activityLevel, goal);
    },
    [activityLevel, persistKcalSettings],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const toggleFormDay = useCallback((day: Weekday) => {
    setFormState((current) => {
      const nextDays = current.days.includes(day)
        ? current.days.filter((item) => item !== day)
        : [...current.days, day];
      return { ...current, days: sortSelectedDays(nextDays) };
    });
  }, []);

  const handleSave = useCallback(async () => {
    const grams = Number.parseFloat(formState.grams);
    const kcalAmount = formState.kcalAmount
      ? Number.parseFloat(formState.kcalAmount)
      : undefined;
    const normalizedFoodName = normalizeFoodName(formState.foodName);
    const normalizedBrand = normalizeFoodName(formState.brandName);
    const normalizedNote = normalizeFoodName(formState.note);
    const selectedDays = sortSelectedDays(formState.days);
    if (!normalizedFoodName) {
      Alert.alert("資料未填寫", "請輸入食物名稱。");
      return;
    }
    if (selectedDays.length === 0) {
      Alert.alert("資料未填寫", "請至少選擇一個日子。");
      return;
    }
    if (!formState.grams || Number.isNaN(grams) || grams <= 0) {
      Alert.alert("資料無效", "請輸入正確的克數。");
      return;
    }
    if (!isValidScheduleTime(formState.time)) {
      Alert.alert("時間格式錯誤", "請使用 HH:MM 格式，例如 08:30。");
      return;
    }
    if (formState.kcalAmount && (!kcalAmount || Number.isNaN(kcalAmount))) {
      Alert.alert(
        "資料無效",
        `請輸入正確的 ${formatKcalUnit(formState.kcalUnit)} 值。`,
      );
      return;
    }
    const currentEntry = editingEntryId
      ? (entries.find((entry) => entry.id === editingEntryId) ?? null)
      : null;
    const linkedEntries = currentEntry
      ? entries.filter((entry) => isSameScheduleMeal(entry, currentEntry))
      : [];
    const linkedEntryIds = new Set(linkedEntries.map((entry) => entry.id));
    const filteredEntries = editingEntryId
      ? entries.filter((entry) => !linkedEntryIds.has(entry.id))
      : entries;
    const createdEntries: WeeklyMealScheduleEntry[] = selectedDays.map(
      (day) => {
        const previousEntry = linkedEntries.find((entry) => entry.day === day);
        return {
          id: previousEntry?.id ?? createWeeklyMealScheduleId(),
          day,
          time: formState.time,
          category: formState.category,
          grams,
          foodName: normalizedFoodName,
          ...(normalizedBrand ? { brandName: normalizedBrand } : {}),
          ...(normalizedNote ? { note: normalizedNote } : {}),
          ...(kcalAmount ? { kcalAmount, kcalUnit: formState.kcalUnit } : {}),
          sortOrder:
            previousEntry?.sortOrder ??
            getNextDaySortOrder(filteredEntries, day),
        };
      },
    );
    let nextEntries = [...filteredEntries, ...createdEntries];
    const affectedDays = new Set<Weekday>([
      ...selectedDays,
      ...linkedEntries.map((entry) => entry.day),
    ]);
    for (const day of WEEKDAY_ORDER) {
      if (affectedDays.has(day))
        nextEntries = resequenceDayEntries(nextEntries, day);
    }
    const saved = await persistEntries(nextEntries);
    if (saved) closeEditor();
  }, [closeEditor, editingEntryId, entries, formState, persistEntries]);

  const handleDelete = useCallback(
    (entry: WeeklyMealScheduleEntry) => {
      Alert.alert("刪除餐單", `刪除 ${entry.foodName} 這筆安排？`, [
        { text: "取消", style: "cancel" },
        {
          text: "刪除",
          style: "destructive",
          onPress: () => {
            const filteredEntries = entries.filter(
              (item) => item.id !== entry.id,
            );
            void persistEntries(
              resequenceDayEntries(filteredEntries, entry.day),
            );
          },
        },
      ]);
    },
    [entries, persistEntries],
  );

  const moveDayEntry = useCallback(
    async (day: Weekday, entryId: string, direction: "up" | "down") => {
      const dayEntries = entries
        .filter((entry) => entry.day === day)
        .sort(
          (left, right) =>
            left.time.localeCompare(right.time) ||
            left.sortOrder - right.sortOrder,
        );
      const currentIndex = dayEntries.findIndex(
        (entry) => entry.id === entryId,
      );
      if (currentIndex === -1) {
        return;
      }

      const targetIndex =
        direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= dayEntries.length) {
        return;
      }

      const reorderedEntries = [...dayEntries];
      const [movedEntry] = reorderedEntries.splice(currentIndex, 1);
      reorderedEntries.splice(targetIndex, 0, movedEntry);

      const nextEntries = sortScheduleEntries([
        ...entries.filter((entry) => entry.day !== day),
        ...reorderedEntries.map((entry, index) => ({
          ...entry,
          sortOrder: index,
        })),
      ]);

      await persistEntries(nextEntries);
    },
    [entries, persistEntries],
  );

  const onTimeChange = (date: Date) => {
    setTimePickerValue(date);
    setFormState((prev) => ({ ...prev, time: formatTimeInput(date) }));
  };

  const openFeederEditor = useCallback(() => {
    syncFeederEditorState(activePet);
    setFeederEditorVisible(true);
  }, [activePet, syncFeederEditorState]);

  const closeFeederEditor = useCallback(() => {
    syncFeederEditorState(activePet);
    setFeederEditorVisible(false);
    setFeederTimePickerTarget(null);
  }, [activePet, syncFeederEditorState]);

  const addFeederSchedule = useCallback(() => {
    setFeederSchedules((current) => [...current, createFeederDraft()]);
  }, []);

  const updateFeederScheduleDraft = useCallback(
    (id: string, patch: Partial<Omit<FeederScheduleDraft, "id">>) => {
      setFeederSchedules((current) =>
        current.map((schedule) =>
          schedule.id === id ? { ...schedule, ...patch } : schedule,
        ),
      );
    },
    [],
  );

  const removeFeederSchedule = useCallback((id: string) => {
    setFeederSchedules((current) =>
      current.filter((schedule) => schedule.id !== id),
    );
  }, []);

  const toggleAutoFeeder = useCallback((enabled: boolean) => {
    setAutoFeederEnabled(enabled);
    setFeederSchedules((current) =>
      enabled ? (current.length > 0 ? current : [createFeederDraft()]) : [],
    );
  }, []);

  const findSavedFoodForFeeder = useCallback(
    (foodName: string): SavedScheduleFoodOption | null => {
      const normalizedTarget = normalizeFoodName(foodName).toLowerCase();
      if (!normalizedTarget) {
        return null;
      }

      return (
        feederSavedFoods.find(
          (item) =>
            normalizeFoodName(item.name).toLowerCase() === normalizedTarget,
        ) ?? null
      );
    },
    [feederSavedFoods],
  );

  const handleSelectFeederFood = useCallback(
    (scheduleId: string, item: SavedScheduleFoodOption) => {
      const currentSchedule = feederSchedules.find(
        (schedule) => schedule.id === scheduleId,
      );
      const isSameSelection =
        currentSchedule !== undefined &&
        findSavedFoodForFeeder(currentSchedule.foodName)?.id === item.id;

      if (isSameSelection) {
        updateFeederScheduleDraft(scheduleId, {
          foodName: "",
          kcalAmount: "",
          kcalUnit: DEFAULT_KCAL_UNIT,
        });
        return;
      }

      updateFeederScheduleDraft(scheduleId, {
        foodName: item.name,
        kcalAmount:
          typeof item.kcalAmount === "number" ? `${item.kcalAmount}` : "",
        kcalUnit: item.kcalUnit ?? DEFAULT_KCAL_UNIT,
      });
    },
    [feederSchedules, findSavedFoodForFeeder, updateFeederScheduleDraft],
  );

  const openFeederTimePicker = useCallback(
    (scheduleId: string, currentValue: string) => {
      setFeederTimePickerTarget(scheduleId);
      setFeederTimePickerValue(parseTimeToDate(currentValue || "08:00"));
    },
    [],
  );

  const buildFeederConfig = useCallback((): FeederConfig | null => {
    if (!autoFeederEnabled) {
      return null;
    }

    if (feederSchedules.length === 0) {
      throw new Error("請至少新增一筆自動餵食排程。");
    }

    const schedules = feederSchedules.map((schedule, index) => {
      const portion = Number.parseFloat(schedule.portion);
      if (!schedule.portion || Number.isNaN(portion) || portion <= 0) {
        throw new Error(`第 ${index + 1} 筆排程的份量不正確。`);
      }
      if (!isValidScheduleTime(schedule.dispatchTime.trim())) {
        throw new Error(`第 ${index + 1} 筆排程的時間格式應為 HH:MM。`);
      }

      const foodName = normalizeFoodName(schedule.foodName);
      const kcalAmount = schedule.kcalAmount
        ? Number.parseFloat(schedule.kcalAmount)
        : undefined;
      if (schedule.kcalAmount && (!kcalAmount || Number.isNaN(kcalAmount))) {
        throw new Error(`第 ${index + 1} 筆排程的熱量數值不正確。`);
      }

      return {
        id: schedule.id,
        portion,
        unit: schedule.unit,
        dispatchTime: schedule.dispatchTime.trim(),
        ...(foodName ? { foodName } : {}),
        ...(kcalAmount ? { kcalAmount, kcalUnit: schedule.kcalUnit } : {}),
      };
    });

    return { enabled: true, schedules };
  }, [autoFeederEnabled, feederSchedules]);

  const persistFeederConfig = useCallback(async () => {
    if (!activePet) {
      return;
    }

    let feederConfig: FeederConfig | null = null;
    try {
      feederConfig = buildFeederConfig();
    } catch (error) {
      Alert.alert(
        "資料無效",
        error instanceof Error ? error.message : "自動餵食排程格式錯誤。",
      );
      return;
    }

    setFeederSaving(true);
    try {
      await setDoc(
        doc(db, "pets", activePet.id),
        { feederConfig },
        { merge: true },
      );
      await refresh();
      setFeederEditorVisible(false);
      setFeederTimePickerTarget(null);
    } catch (error) {
      Alert.alert(
        "儲存失敗",
        error instanceof Error ? error.message : "更新自動餵食機設定失敗。",
      );
    } finally {
      setFeederSaving(false);
    }
  }, [activePet, buildFeederConfig, refresh]);

  if (!activePet) {
    return (
      <SafeAreaView style={styles.emptySafeArea}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>🐾</Text>
          <Text style={styles.emptyTitle}>未有寵物資料</Text>
          <Text style={styles.emptySubtitle}>
            先建立或切換寵物，之後先可以安排每週餵食 timetable。
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#7FA655"
          />
        }
      >
        <View style={styles.heroCard}>
          <View style={styles.heroBadgeRow}>
            <Text style={styles.heroPetName}>{activePet.name}</Text>
          </View>
          <Text style={styles.heroTitle}>餵食時間表</Text>
          <Text style={styles.heroSubtitle}>
            在這裡安排每週餵食、查看自動餵食機設定，並用熱量參考微調整體節奏。
          </Text>
          <View style={styles.heroActionRow}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => openCreateModal("mon")}
              style={styles.primaryButton}
            >
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>新增餐單</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => {}}
              style={[styles.primaryButton, styles.secondaryHeroButton]}
            >
              <Text
                style={[
                  styles.primaryButtonText,
                  styles.secondaryHeroButtonText,
                ]}
              >
                匯出成 PDF! 分享給家人或寵物保姆
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.feederManagerCard}>
          <View style={styles.feederManagerHeader}>
            <View style={styles.feederManagerCopy}>
              <Text style={styles.sectionEyebrow}>自動化</Text>
              <Text style={styles.feederManagerTitle}>自動餵食機</Text>
              <Text style={styles.feederManagerSubtitle}>
                詳細排程放在這裡管理；系統會每日自動在 Detail log
                建立對應的餵食紀錄。
              </Text>
            </View>
            <View
              style={[
                styles.feederStatusPill,
                autoFeederEnabled && styles.feederStatusPillActive,
              ]}
            >
              <Text
                style={[
                  styles.feederStatusText,
                  autoFeederEnabled && styles.feederStatusTextActive,
                ]}
              >
                {autoFeederEnabled ? "已開啟" : "未開啟"}
              </Text>
            </View>
          </View>
          <Text style={styles.feederSummaryText}>
            {autoFeederEnabled
              ? `目前有 ${feederSchedules.length} 筆排程。`
              : "未設定自動餵食排程。"}
          </Text>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={openFeederEditor}
            style={styles.feederManageButton}
          >
            <Ionicons name="hardware-chip-outline" size={18} color="#fff" />
            <Text style={styles.feederManageButtonText}>管理自動餵食機</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.kcalCard}>
          <View style={styles.kcalHeader}>
            <Text style={styles.sectionEyebrow}>營養參考</Text>
            <Text style={styles.kcalTitle}>🐱 每日熱量需求</Text>
            <Text style={styles.kcalSubtitle}>
              根據體重和活動水平計算，只作餐單規劃參考。
            </Text>
          </View>
          <View style={styles.kcalInputGroup}>
            <Text style={styles.kcalInputLabel}>體重 (公斤)</Text>
            <TextInput
              style={styles.kcalInput}
              placeholder="例如 4.5"
              placeholderTextColor="#94A3B8"
              value={catWeight}
              onChangeText={setCatWeight}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.kcalInputGroup}>
            <Text style={styles.kcalInputLabel}>活動水平</Text>
            <View style={styles.kcalButtonRow}>
              {(["sedentary", "moderate", "active"] as ActivityLevel[]).map(
                (level) => (
                  <TouchableOpacity
                    key={level}
                    onPress={() => handleActivityLevelChange(level)}
                    style={[
                      styles.kcalButton,
                      activityLevel === level && styles.kcalButtonActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.kcalButtonText,
                        activityLevel === level && styles.kcalButtonTextActive,
                      ]}
                    >
                      {level === "sedentary"
                        ? "不活躍"
                        : level === "moderate"
                          ? "適中"
                          : "活躍"}
                    </Text>
                  </TouchableOpacity>
                ),
              )}
            </View>
          </View>
          <View style={styles.kcalInputGroup}>
            <Text style={styles.kcalInputLabel}>體重目標</Text>
            <View style={styles.kcalButtonRow}>
              {(["maintain", "gain", "lose"] as WeightGoal[]).map((goal) => (
                <TouchableOpacity
                  key={goal}
                  onPress={() => handleWeightGoalChange(goal)}
                  style={[
                    styles.kcalButton,
                    weightGoal === goal && styles.kcalButtonActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.kcalButtonText,
                      weightGoal === goal && styles.kcalButtonTextActive,
                    ]}
                  >
                    {goal === "maintain"
                      ? "維持"
                      : goal === "gain"
                        ? "增重"
                        : "減重"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.kcalResultCard}>
            <Text style={styles.kcalResultLabel}>每日建議熱量攝取</Text>
            <Text style={styles.kcalResultValue}>
              {dailyKcal.recommended}
              <Text style={styles.kcalResultUnit}> kcal</Text>
            </Text>
          </View>
        </View>

        <View style={styles.manualScheduleIntro}>
          <Text style={styles.sectionEyebrow}>手動規劃</Text>
          <Text style={styles.manualScheduleTitle}>每週手動餐單</Text>
          <Text style={styles.manualScheduleText}>
            這裡是你主動安排的餵食節奏。可直接編輯、刪除，亦可用箭嘴調整次序。
          </Text>
        </View>

        {weeklyGroups.map(({ day, items }) => {
          const dayKcal = getDayKcal(day);
          return (
            <View key={day} style={styles.daySection}>
              <View style={styles.daySectionHeader}>
                <View style={styles.dayHeadingWrap}>
                  <View
                    style={[
                      styles.dayAccent,
                      { backgroundColor: DAY_STRIPE_COLORS[day] },
                    ]}
                  />
                  <View>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Text style={styles.dayTitle}>{WEEKDAY_LABELS[day]}</Text>
                      <Text
                        style={{
                          fontFamily: "ZenMaruGothic-Bold",
                          fontSize: 14,
                          color: getKcalStatusColor(dayKcal),
                          marginLeft: 2,
                        }}
                      >
                        {dayKcal > 0 ? `${dayKcal} kcal` : ""}
                      </Text>
                    </View>
                    <Text style={styles.daySubtitle}>{items.length} 餐</Text>
                  </View>
                </View>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => openCreateModal(day)}
                  style={styles.dayAddButton}
                >
                  <Ionicons name="add" size={18} color="#14532d" />
                </TouchableOpacity>
              </View>
              {items.length > 0 ? (
                <View style={styles.dayList}>
                  <View style={styles.dayListContent}>
                    {items.map((item, index) => (
                      <ScheduleMealCard
                        key={item.id}
                        item={item}
                        onEdit={openEditModal}
                        onDelete={handleDelete}
                        canMoveUp={index > 0}
                        canMoveDown={index < items.length - 1}
                        onMoveUp={() => {
                          void moveDayEntry(day, item.id, "up");
                        }}
                        onMoveDown={() => {
                          void moveDayEntry(day, item.id, "down");
                        }}
                      />
                    ))}
                  </View>
                </View>
              ) : (
                <View style={styles.emptyDayCard}>
                  <Text style={styles.emptyDayText}>
                    未安排餐單，按右上角加入。
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={closeEditor}
        transparent
        visible={editorVisible}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalKeyboardWrap}
          >
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>
                    {editingEntryId ? "編輯餐單" : "新增餐單"}
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    品牌、名稱、份量、時間、日子都可以在這裡設定。
                  </Text>
                </View>
                <TouchableOpacity onPress={closeEditor}>
                  <Ionicons name="close" size={22} color="#111827" />
                </TouchableOpacity>
              </View>
              <ScrollView
                contentContainerStyle={styles.formContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.fieldLabel}>日子（可多選）</Text>
                <View style={styles.dayChipWrap}>
                  {WEEKDAY_ORDER.map((day) => (
                    <TouchableOpacity
                      key={day}
                      onPress={() => toggleFormDay(day)}
                      style={[
                        styles.dayChip,
                        formState.days.includes(day) && styles.dayChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayChipText,
                          formState.days.includes(day) &&
                            styles.dayChipTextActive,
                        ]}
                      >
                        {WEEKDAY_LABELS[day]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.fieldLabel}>時間</Text>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => setShowTimePicker(true)}
                  style={styles.timeButton}
                >
                  <Ionicons name="time-outline" size={18} color="#14532d" />
                  <Text style={styles.timeButtonText}>{formState.time}</Text>
                </TouchableOpacity>
                <Text style={styles.fieldLabel}>食物種類</Text>
                <View style={styles.categoryWrap}>
                  {MEAL_CATEGORIES.map((category) => (
                    <TouchableOpacity
                      key={category}
                      onPress={() => setFormState((c) => ({ ...c, category }))}
                      style={[
                        styles.categoryChip,
                        formState.category === category &&
                          styles.categoryChipActive,
                      ]}
                    >
                      <Text style={styles.categoryEmoji}>
                        {MEAL_CATEGORY_ICONS[category]}
                      </Text>
                      <Text
                        style={[
                          styles.categoryChipText,
                          formState.category === category &&
                            styles.categoryChipTextActive,
                        ]}
                      >
                        {MEAL_CATEGORY_LABELS[category]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {/* Saved Food List */}
                {filteredSavedFoods.length > 0 && (
                  <View style={{ marginTop: 12, marginBottom: 8 }}>
                    <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>
                      常用食物
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 10,
                      }}
                    >
                      {filteredSavedFoods.map((item) => {
                        const isSelected = selectedSavedFoodId === item.id;
                        return (
                          <TouchableOpacity
                            key={item.id}
                            onPress={() => handleSelectSavedFood(item)}
                            style={{
                              minWidth: "47%",
                              flex: 1,
                              borderRadius: 16,
                              borderWidth: 1,
                              borderColor: isSelected ? "#7FA655" : "#e5e7eb",
                              backgroundColor: isSelected
                                ? "#f0fdf4"
                                : "#ffffff",
                              paddingHorizontal: 12,
                              paddingVertical: 12,
                              marginBottom: 10,
                            }}
                          >
                            <View style={{ gap: 8 }}>
                              {item.brandName ? (
                                <Text
                                  style={{
                                    fontFamily: "ZenMaruGothic-Medium",
                                    color: isSelected ? "#4D7C0F" : "#6b7280",
                                    fontSize: 12,
                                  }}
                                  numberOfLines={1}
                                >
                                  {item.brandName}
                                </Text>
                              ) : null}
                              <Text
                                style={{
                                  fontFamily: "ZenMaruGothic-Bold",
                                  color: isSelected ? "#14532d" : "#111827",
                                  fontSize: 13,
                                  lineHeight: 18,
                                }}
                                numberOfLines={2}
                              >
                                {item.name}
                              </Text>
                              {typeof item.kcalAmount === "number" &&
                                item.kcalAmount > 0 && (
                                  <Text
                                    style={{ fontSize: 11, color: "#7FA655" }}
                                  >
                                    kcal: {item.kcalAmount}{" "}
                                    {formatKcalUnit(
                                      item.kcalUnit ?? DEFAULT_KCAL_UNIT,
                                    )}
                                  </Text>
                                )}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
                <Text style={styles.fieldLabel}>食物名稱</Text>
                <TextInput
                  onChangeText={(v) =>
                    setFormState((c) => ({ ...c, foodName: v }))
                  }
                  placeholder="例如 Indoor Chicken Recipe"
                  placeholderTextColor="#94A3B8"
                  style={styles.input}
                  value={formState.foodName}
                />
                {shouldShowKcalInput && (
                  <>
                    <Text style={styles.fieldLabel}>kcal</Text>
                    <View style={styles.kcalRow}>
                      <TextInput
                        keyboardType="decimal-pad"
                        onChangeText={(v) =>
                          setFormState((c) => ({ ...c, kcalAmount: v }))
                        }
                        placeholder="例如 320"
                        placeholderTextColor="#94A3B8"
                        style={[styles.input, styles.kcalAmountInput]}
                        value={formState.kcalAmount}
                      />
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() =>
                          setFormState((current) => ({
                            ...current,
                            kcalUnit: current.kcalUnit === "kg" ? "100g" : "kg",
                          }))
                        }
                        style={styles.kcalUnitButton}
                      >
                        <Text style={styles.kcalUnitButtonText}>
                          {formatKcalUnit(formState.kcalUnit)}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
                <Text style={styles.fieldLabel}>份量</Text>
                <View style={styles.gramRow}>
                  <TextInput
                    keyboardType="decimal-pad"
                    onChangeText={(v) =>
                      setFormState((c) => ({ ...c, grams: v }))
                    }
                    placeholder="0"
                    placeholderTextColor="#94A3B8"
                    style={[styles.input, styles.gramInput]}
                    value={formState.grams}
                  />
                  <View style={styles.gramSuffix}>
                    <Text style={styles.gramSuffixText}>gram</Text>
                  </View>
                </View>
              </ScrollView>
              <View style={styles.modalFooter}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={closeEditor}
                  style={styles.modalSecondaryButton}
                >
                  <Text style={styles.modalSecondaryButtonText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.9}
                  disabled={saving}
                  onPress={() => void handleSave()}
                  style={styles.modalPrimaryButton}
                >
                  <Text style={styles.modalPrimaryButtonText}>
                    {saving ? "儲存中..." : "儲存餐單"}
                  </Text>
                </TouchableOpacity>
              </View>

              <EditTimePickerModal
                visible={showTimePicker}
                initialValue={timePickerValue}
                onCancel={() => setShowTimePicker(false)}
                onConfirm={(date) => {
                  onTimeChange(date);
                  setShowTimePicker(false);
                }}
              />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={closeFeederEditor}
        transparent
        visible={feederEditorVisible}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalKeyboardWrap}
          >
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>有自動餵食機?</Text>
                  <Text style={styles.modalSubtitle}>
                    在這裡管理自動餵食Schedule, 系統會每日自動在 Detail log
                    建立對應的餵食紀錄。
                  </Text>
                </View>
                <TouchableOpacity onPress={closeFeederEditor}>
                  <Ionicons name="close" size={22} color="#111827" />
                </TouchableOpacity>
              </View>

              <ScrollView
                contentContainerStyle={styles.formContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.fieldLabel}>是否有使用自動餵食機?</Text>
                <View style={styles.feederToggleRow}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => toggleAutoFeeder(false)}
                    style={[
                      styles.feederToggleButton,
                      !autoFeederEnabled && styles.feederToggleButtonActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.feederToggleText,
                        !autoFeederEnabled && styles.feederToggleTextActive,
                      ]}
                    >
                      沒有
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => toggleAutoFeeder(true)}
                    style={[
                      styles.feederToggleButton,
                      autoFeederEnabled && styles.feederToggleButtonActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.feederToggleText,
                        autoFeederEnabled && styles.feederToggleTextActive,
                      ]}
                    >
                      有，使用自動餵食機
                    </Text>
                  </TouchableOpacity>
                </View>

                {autoFeederEnabled ? (
                  <View style={styles.feederScheduleList}>
                    {feederSchedules.map((schedule, index) => {
                      const selectedFood = findSavedFoodForFeeder(
                        schedule.foodName,
                      );

                      return (
                        <View
                          key={schedule.id}
                          style={styles.feederScheduleCard}
                        >
                          <View style={styles.feederScheduleHeader}>
                            <Text style={styles.feederScheduleTitle}>
                              Schedule {index + 1}
                            </Text>
                            <TouchableOpacity
                              onPress={() => removeFeederSchedule(schedule.id)}
                            >
                              <Text style={styles.feederRemoveText}>移除</Text>
                            </TouchableOpacity>
                          </View>

                          <Text style={styles.fieldLabel}>時間</Text>
                          <TouchableOpacity
                            activeOpacity={0.9}
                            onPress={() =>
                              openFeederTimePicker(
                                schedule.id,
                                schedule.dispatchTime,
                              )
                            }
                            style={styles.timeButton}
                          >
                            <Ionicons
                              name="time-outline"
                              size={18}
                              color="#14532d"
                            />
                            <Text style={styles.timeButtonText}>
                              {schedule.dispatchTime || "選擇時間"}
                            </Text>
                          </TouchableOpacity>

                          {feederSavedFoods.length > 0 ? (
                            <View style={styles.feederSavedFoodSection}>
                              <Text style={styles.fieldLabel}>常用食物</Text>
                              <View style={styles.feederSavedFoodGrid}>
                                {feederSavedFoods.map((item) => {
                                  const isSelected =
                                    selectedFood?.id === item.id;

                                  return (
                                    <TouchableOpacity
                                      key={item.id}
                                      activeOpacity={0.9}
                                      onPress={() =>
                                        handleSelectFeederFood(
                                          schedule.id,
                                          item,
                                        )
                                      }
                                      style={[
                                        styles.feederSavedFoodCard,
                                        isSelected &&
                                          styles.feederSavedFoodCardActive,
                                      ]}
                                    >
                                      {item.brandName ? (
                                        <Text
                                          style={[
                                            styles.feederSavedFoodBrand,
                                            isSelected &&
                                              styles.feederSavedFoodBrandActive,
                                          ]}
                                          numberOfLines={1}
                                        >
                                          {item.brandName}
                                        </Text>
                                      ) : null}
                                      <Text
                                        style={[
                                          styles.feederSavedFoodName,
                                          isSelected &&
                                            styles.feederSavedFoodNameActive,
                                        ]}
                                        numberOfLines={2}
                                      >
                                        {item.name}
                                      </Text>
                                      {typeof item.kcalAmount === "number" &&
                                      item.kcalAmount > 0 ? (
                                        <Text
                                          style={styles.feederSavedFoodKcal}
                                        >
                                          kcal: {item.kcalAmount}{" "}
                                          {formatKcalUnit(
                                            item.kcalUnit ?? DEFAULT_KCAL_UNIT,
                                          )}
                                        </Text>
                                      ) : null}
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                            </View>
                          ) : null}

                          <Text style={styles.fieldLabel}>
                            食物名稱（選填）
                          </Text>
                          <TextInput
                            onChangeText={(value) =>
                              updateFeederScheduleDraft(schedule.id, {
                                foodName: value,
                              })
                            }
                            placeholder="例如 Indoor Chicken Recipe"
                            placeholderTextColor="#94A3B8"
                            style={styles.input}
                            value={schedule.foodName}
                          />

                          <Text style={styles.fieldLabel}>kcal（選填）</Text>
                          <View style={styles.kcalRow}>
                            <TextInput
                              keyboardType="decimal-pad"
                              onChangeText={(value) =>
                                updateFeederScheduleDraft(schedule.id, {
                                  kcalAmount: value,
                                })
                              }
                              placeholder="例如 320"
                              placeholderTextColor="#94A3B8"
                              style={[styles.input, styles.kcalAmountInput]}
                              value={schedule.kcalAmount}
                            />
                            <TouchableOpacity
                              activeOpacity={0.9}
                              onPress={() =>
                                updateFeederScheduleDraft(schedule.id, {
                                  kcalUnit:
                                    schedule.kcalUnit === "kg" ? "100g" : "kg",
                                })
                              }
                              style={styles.kcalUnitButton}
                            >
                              <Text style={styles.kcalUnitButtonText}>
                                {formatKcalUnit(
                                  schedule.kcalUnit ?? DEFAULT_KCAL_UNIT,
                                )}
                              </Text>
                            </TouchableOpacity>
                          </View>

                          <Text style={styles.fieldLabel}>份量</Text>
                          <View style={styles.gramRow}>
                            <TextInput
                              keyboardType="decimal-pad"
                              onChangeText={(value) =>
                                updateFeederScheduleDraft(schedule.id, {
                                  portion: value,
                                })
                              }
                              placeholder="0"
                              placeholderTextColor="#94A3B8"
                              style={[styles.input, styles.gramInput]}
                              value={schedule.portion}
                            />
                            <TouchableOpacity
                              activeOpacity={0.9}
                              onPress={() =>
                                updateFeederScheduleDraft(schedule.id, {
                                  unit: schedule.unit === "g" ? "portion" : "g",
                                })
                              }
                              style={styles.kcalUnitButton}
                            >
                              <Text style={styles.kcalUnitButtonText}>
                                {schedule.unit === "g" ? "克" : "份"}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}

                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={addFeederSchedule}
                      style={styles.feederAddButton}
                    >
                      <Text style={styles.feederAddButtonText}>
                        + 新增Schedule
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </ScrollView>

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={closeFeederEditor}
                  style={styles.modalSecondaryButton}
                >
                  <Text style={styles.modalSecondaryButtonText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.9}
                  disabled={feederSaving}
                  onPress={() => void persistFeederConfig()}
                  style={styles.modalPrimaryButton}
                >
                  <Text style={styles.modalPrimaryButtonText}>
                    {feederSaving ? "儲存中..." : "儲存Schedule"}
                  </Text>
                </TouchableOpacity>
              </View>

              <EditTimePickerModal
                visible={feederTimePickerTarget !== null}
                initialValue={feederTimePickerValue}
                onCancel={() => setFeederTimePickerTarget(null)}
                onConfirm={(date) => {
                  if (feederTimePickerTarget) {
                    updateFeederScheduleDraft(feederTimePickerTarget, {
                      dispatchTime: formatTimeInput(date),
                    });
                  }
                  setFeederTimePickerValue(date);
                  setFeederTimePickerTarget(null);
                }}
                title="選擇自動餵食時間"
              />
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: APP_BACKGROUND },
  container: { flex: 1, backgroundColor: APP_BACKGROUND },
  content: {
    paddingHorizontal: 20,
    paddingTop: SCREEN_TOP_CONTENT_PADDING - 20,
    paddingBottom: 120,
    gap: 18,
  },
  emptySafeArea: { flex: 1, backgroundColor: APP_BACKGROUND },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  emptyEmoji: { fontSize: 42, marginBottom: 12 },
  emptyTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 24,
    color: "#111827",
    marginBottom: 10,
  },
  emptySubtitle: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 14,
    lineHeight: 22,
    color: "#475569",
    textAlign: "center",
  },
  heroCard: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#182C28",
    borderRadius: 28,
    padding: 20,
    gap: 16,
    borderWidth: 1.5,
    borderColor: "rgba(23,36,33,0.3)",
  },
  heroBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroPetName: {
    fontFamily: "ZenMaruGothic-Medium",
    color: "#d8eee8",
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  heroTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    color: "#FFFFFF",
    fontSize: 30,
  },
  heroSubtitle: {
    fontFamily: "ZenMaruGothic-Regular",
    color: "#D1D5DB",
    fontSize: 14,
    lineHeight: 22,
  },
  heroActionRow: { flexDirection: "column", gap: 10 },
  primaryButton: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "#2E7A70",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    gap: 8,
  },
  primaryButtonText: {
    fontFamily: "ZenMaruGothic-Bold",
    color: "#FFFFFF",
    fontSize: 15,
  },
  secondaryHeroButton: {
    backgroundColor: "rgba(255,253,246,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,253,246,0.18)",
  },
  secondaryHeroButtonText: {
    color: "#E5E7EB",
  },
  sectionEyebrow: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 11,
    letterSpacing: 1,
    color: "#7C2D12",
  },
  feederManagerCard: {
    backgroundColor: CARD_BACKGROUND,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    gap: 14,
    shadowColor: "#2c231a",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  feederManagerHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  feederManagerCopy: {
    flex: 1,
    gap: 6,
  },
  feederManagerTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    color: "#111827",
    fontSize: 18,
  },
  feederManagerSubtitle: {
    fontFamily: "ZenMaruGothic-Regular",
    color: "#6B7280",
    fontSize: 13,
    lineHeight: 19,
  },
  feederStatusPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#F3F4F6",
  },
  feederStatusPillActive: {
    backgroundColor: "#ECFCCB",
  },
  feederStatusText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 12,
    color: "#6B7280",
  },
  feederStatusTextActive: {
    color: "#4D7C0F",
  },
  feederSummaryText: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 14,
    color: "#374151",
  },
  feederManageButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    backgroundColor: "#14532d",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  feederManageButtonText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 14,
    color: "#FFFFFF",
  },
  guideCard: {
    backgroundColor: "#FFF9EF",
    borderRadius: 24,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    gap: 8,
  },
  guideTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 16,
    color: "#9A3412",
  },
  guideText: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 13,
    lineHeight: 20,
    color: "#7C2D12",
  },
  manualScheduleIntro: {
    gap: 4,
    paddingHorizontal: 2,
  },
  manualScheduleTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 18,
    color: "#111827",
  },
  manualScheduleText: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 13,
    lineHeight: 19,
    color: "#6B7280",
  },
  daySection: {
    backgroundColor: CARD_BACKGROUND,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    gap: 14,
    shadowColor: "#2c231a",
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  daySectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dayHeadingWrap: { flexDirection: "row", alignItems: "center", gap: 12 },
  dayAccent: { width: 10, alignSelf: "stretch", borderRadius: 999 },
  dayTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 22,
    color: "#111827",
  },
  daySubtitle: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 13,
    color: "#6B7280",
  },
  dayAddButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "#ECFCCB",
    alignItems: "center",
    justifyContent: "center",
  },
  dayList: { maxHeight: 350, overflow: "hidden" },
  dayListContent: { gap: 8, paddingBottom: 2 },
  emptyDayCard: {
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    borderStyle: "dashed",
    padding: 16,
    backgroundColor: "#FFFDF6",
  },
  emptyDayText: {
    fontFamily: "ZenMaruGothic-Regular",
    color: "#64748B",
    fontSize: 13,
  },
  mealCard: {
    minHeight: 66,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: "#FFFDF6",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  mealCardDragging: {
    opacity: 0.9,
    borderColor: "#7FA655",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 5,
  },
  mealTimePill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 12,
    minWidth: 72,
  },
  mealTimeText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 12,
    color: "#14532d",
  },
  mealTitleRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },
  mealIcon: { fontSize: 22, lineHeight: 24 },
  mealTitleWrap: { flex: 1, gap: 3, minWidth: 0 },
  mealBrandName: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 11,
    color: "#7FA655",
  },
  mealTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#111827",
  },
  mealMeta: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 12,
    color: "#6B7280",
  },
  mealActionColumn: { flexDirection: "row", alignItems: "center", gap: 2 },
  mealReorderColumn: { gap: 2 },
  mealIconButton: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },
  mealIconButtonDisabled: {
    opacity: 0.45,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
    justifyContent: "flex-end",
  },
  modalKeyboardWrap: { justifyContent: "flex-end" },
  modalCard: {
    backgroundColor: "#FFFCF6",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    maxHeight: "90%",
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 22,
    gap: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  modalTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 22,
    color: "#111827",
  },
  modalSubtitle: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 13,
    lineHeight: 20,
    color: "#6B7280",
    marginTop: 4,
  },
  formContent: { gap: 12, paddingBottom: 12 },
  fieldLabel: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 13,
    color: "#334155",
  },
  dayChipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dayChip: {
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#DDD2C3",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#FFFDF6",
  },
  dayChipActive: { backgroundColor: "#EAF4EF", borderColor: "#2E7A70" },
  dayChipText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#334155",
  },
  dayChipTextActive: { color: "#2E7A70" },
  feederToggleRow: { flexDirection: "row", gap: 10 },
  feederToggleButton: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  feederToggleButtonActive: {
    borderColor: "#7FA655",
    backgroundColor: "#F0FDF4",
  },
  feederToggleText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 13,
    color: "#6B7280",
    textAlign: "center",
  },
  feederToggleTextActive: {
    color: "#14532d",
  },
  feederScheduleList: { gap: 14, marginTop: 6 },
  feederScheduleCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    padding: 14,
    gap: 10,
  },
  feederScheduleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  feederScheduleTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#111827",
  },
  feederRemoveText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 13,
    color: "#B91C1C",
  },
  feederSavedFoodSection: { marginTop: 2, gap: 8 },
  feederSavedFoodGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  feederSavedFoodCard: {
    minWidth: "47%",
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  feederSavedFoodCardActive: {
    borderColor: "#7FA655",
    backgroundColor: "#F0FDF4",
  },
  feederSavedFoodBrand: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 12,
    color: "#6B7280",
  },
  feederSavedFoodBrandActive: {
    color: "#4D7C0F",
  },
  feederSavedFoodName: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 13,
    lineHeight: 18,
    color: "#111827",
  },
  feederSavedFoodNameActive: {
    color: "#14532d",
  },
  feederSavedFoodKcal: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 11,
    color: "#7FA655",
  },
  timeButton: {
    borderRadius: 16,
    backgroundColor: "#ECFCCB",
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  timeButtonText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#14532d",
  },
  categoryWrap: { flexDirection: "row", gap: 10 },
  categoryChip: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    paddingVertical: 12,
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
  },
  categoryChipActive: { borderColor: "#7FA655", backgroundColor: "#F0FDF4" },
  categoryEmoji: { fontSize: 20 },
  categoryChipText: {
    fontFamily: "ZenMaruGothic-Medium",
    fontSize: 13,
    color: "#475569",
  },
  categoryChipTextActive: { color: "#14532d" },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 14,
    color: "#111827",
  },
  kcalRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  kcalAmountInput: { flex: 1 },
  kcalUnitButton: {
    borderRadius: 16,
    backgroundColor: "#ECFCCB",
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  kcalUnitButtonText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 13,
    color: "#14532d",
  },
  gramRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  gramInput: { flex: 1 },
  gramSuffix: {
    borderRadius: 16,
    backgroundColor: "#ECFCCB",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  gramSuffixText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 13,
    color: "#14532d",
  },
  feederAddButton: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#7FA655",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    paddingVertical: 14,
  },
  feederAddButtonText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 14,
    color: "#14532d",
  },
  modalFooter: { flexDirection: "row", gap: 10 },
  modalSecondaryButton: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D1D5DB",
    alignItems: "center",
    paddingVertical: 14,
  },
  modalSecondaryButtonText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#334155",
  },
  modalPrimaryButton: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: "#7FA655",
    alignItems: "center",
    paddingVertical: 14,
  },
  modalPrimaryButtonText: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 15,
    color: "#FFFFFF",
  },
  kcalCard: {
    backgroundColor: "#FFF7ED",
    borderRadius: 20,
    padding: 18,
    gap: 16,
    borderWidth: 1,
    borderColor: "#F6D7A7",
  },
  kcalHeader: { gap: 4 },
  kcalTitle: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 18,
    color: "#111827",
  },
  kcalSubtitle: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 13,
    color: "#6B7280",
  },
  kcalInputGroup: { gap: 8 },
  kcalInputLabel: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 13,
    color: "#374151",
  },
  kcalInput: {
    borderWidth: 1,
    borderColor: "#F6D7A7",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#FFFDF9",
    fontFamily: "ZenMaruGothic-Regular",
  },
  kcalButtonRow: { flexDirection: "row", gap: 8 },
  kcalButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  kcalButtonActive: { backgroundColor: "#FDE7C7", borderColor: "#B45309" },
  kcalButtonText: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 13,
    color: "#6B7280",
  },
  kcalButtonTextActive: { color: "#B45309", fontFamily: "ZenMaruGothic-Bold" },
  kcalResultCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#F6D7A7",
  },
  kcalResultLabel: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 13,
    color: "#6B7280",
  },
  kcalResultValue: {
    fontFamily: "ZenMaruGothic-Bold",
    fontSize: 36,
    color: "#7FA655",
    marginTop: 6,
  },
  kcalResultUnit: {
    fontFamily: "ZenMaruGothic-Regular",
    fontSize: 18,
    color: "#7FA655",
  },
});
