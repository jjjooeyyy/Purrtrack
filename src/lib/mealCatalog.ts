import { doc, getDoc, runTransaction, Timestamp } from "firebase/firestore";
import { MEAL_CATEGORY_LABELS } from "../constants/localization";
import { db } from "../firebase";
import {
    DailyLog, FeederSchedule, MealCategory,
    MealEntry,
    SavedFood,
    SavedSupplement, SharedPetProfile
} from "../types";

type VirtualFeederMealEntry = MealEntry & {
  __virtual?: boolean;
  __scheduleId?: string;
  __unit?: "g" | "portion";
};

// Ensures a virtual meal log exists for the given date and pet, based on feederConfig
export async function ensureVirtualMealLogForDay(date: string, pet: SharedPetProfile): Promise<void> {
  if (!pet.feederConfig?.enabled || !pet.feederConfig.schedules?.length) return;
  const logRef = doc(db, "pets", pet.id, "logs", date);
  const snap = await getDoc(logRef);
  let loadedLog: DailyLog | null = snap.exists() ? (snap.data() as DailyLog) : null;
  const persistedMeals = (loadedLog?.meals ?? []) as VirtualFeederMealEntry[];
  const suppressedMealScheduleIds = loadedLog?.suppressedMealScheduleIds ?? [];
  const manualMeals = persistedMeals.filter((meal) => !(meal as any).__virtual);
  const generatedMeals = pet.feederConfig.schedules
    .filter((schedule: FeederSchedule) => {
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
      return !manualMeals.some((meal) => isSameMealWindow(meal, scheduledMeal.time.toDate()));
    })
    .map((schedule: FeederSchedule) =>
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
  // Only update if needed
  const areEqual =
    persistedMeals.length === nextMeals.length &&
    persistedMeals.every((entry, idx) => {
      // Compare relevant fields
      const n = nextMeals[idx];
      return (
        entry.grams === n.grams &&
        entry.time.toMillis() === n.time.toMillis() &&
        entry.foodName === n.foodName &&
        entry.kcalAmount === n.kcalAmount &&
        entry.kcalUnit === n.kcalUnit &&
        (entry as any).__virtual === (n as any).__virtual &&
        (entry as any).__scheduleId === (n as any).__scheduleId &&
        (entry as any).__unit === (n as any).__unit
      );
    });
  if (!areEqual) {
    const updatedLog: DailyLog = {
      date,
      petId: pet.id,
      meals: nextMeals,
      water: loadedLog?.water ?? [],
      litter: loadedLog?.litter ?? [],
      care: loadedLog?.care ?? [],
      ...(loadedLog?.weights ? { weights: loadedLog.weights } : {}),
      ...(loadedLog?.journal ? { journal: loadedLog.journal } : {}),
      ...(suppressedMealScheduleIds.length > 0
        ? { suppressedMealScheduleIds }
        : {}),
      totalMeals: nextMeals.reduce((sum, m) => sum + m.grams, 0),
      totalWater: loadedLog?.totalWater ?? (loadedLog?.water ? loadedLog.water.reduce((sum, w) => sum + w.ml, 0) : 0),
      litterVisits: loadedLog?.litterVisits ?? (loadedLog?.litter?.length ?? 0),
    };
    await runTransaction(db, async (transaction) => {
      transaction.set(logRef, updatedLog, { merge: true });
    });
  }
}

const DRY_KEYWORDS = ["乾", "dry", "kibble"];
const SNACK_KEYWORDS = ["零食", "小食", "snack", "treat"];

function includesKeyword(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword));
}

export function normalizeFoodName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
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
): VirtualFeederMealEntry {
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

function sanitizeMealEntry(entry: VirtualFeederMealEntry): VirtualFeederMealEntry {
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

function hasMatchingFoodBrand(
  leftBrandName?: string | null,
  rightBrandName?: string | null,
): boolean {
  const normalizedLeft = normalizeFoodName(leftBrandName ?? "").toLowerCase();
  const normalizedRight = normalizeFoodName(rightBrandName ?? "").toLowerCase();

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.length === 0 ||
    normalizedRight.length === 0
  );
}

export function inferMealCategoryFromLegacy(foodType?: string | null): MealCategory {
  const normalized = (foodType ?? "").trim().toLowerCase();
  if (includesKeyword(normalized, DRY_KEYWORDS)) {
    return "dry";
  }
  if (includesKeyword(normalized, SNACK_KEYWORDS)) {
    return "snack";
  }
  return "wet";
}

export function getLegacyMealFoodName(foodType?: string | null): string {
  const normalized = normalizeFoodName(foodType ?? "");
  if (!normalized) {
    return "";
  }

  const prefixedLabels = Object.values(MEAL_CATEGORY_LABELS);
  for (const label of prefixedLabels) {
    const prefix = `${label} · `;
    if (normalized.startsWith(prefix)) {
      return normalizeFoodName(normalized.slice(prefix.length));
    }
  }

  const lower = normalized.toLowerCase();
  if (
    includesKeyword(lower, DRY_KEYWORDS) ||
    includesKeyword(lower, SNACK_KEYWORDS) ||
    lower.includes("濕") ||
    lower === MEAL_CATEGORY_LABELS.dry ||
    lower === MEAL_CATEGORY_LABELS.wet ||
    lower === MEAL_CATEGORY_LABELS.snack
  ) {
    return "";
  }

  return normalized;
}

export function getMealCategory(meal: MealEntry): MealCategory {
  return meal.category ?? inferMealCategoryFromLegacy(meal.foodType);
}

export function getMealDisplayLabel(meal: MealEntry): string {
  if (meal.category || meal.foodName) {
    const categoryLabel = MEAL_CATEGORY_LABELS[getMealCategory(meal)];
    const foodName = normalizeFoodName(meal.foodName ?? "");
    return foodName ? `${categoryLabel} · ${foodName}` : categoryLabel;
  }

  return meal.foodType?.trim() || "未註明";
}

export function buildMealLegacyFoodType(
  category: MealCategory,
  foodName?: string | null,
): string {
  const label = MEAL_CATEGORY_LABELS[category];
  const normalizedName = normalizeFoodName(foodName ?? "");
  return normalizedName ? `${label} · ${normalizedName}` : label;
}

export function createFoodCatalogId(): string {
  return `food-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function createSupplementCatalogId(): string {
  return `supp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function findMatchingFood(
  catalog: SavedFood[],
  category: MealCategory,
  name: string,
  brandName?: string,
): SavedFood | undefined {
  const normalizedTarget = normalizeFoodName(name).toLowerCase();
  return catalog.find(
    (item) =>
      item.category === category &&
      normalizeFoodName(item.name).toLowerCase() === normalizedTarget &&
      hasMatchingFoodBrand(item.brandName, brandName),
  );
}

export function sortFoodCatalog(catalog: SavedFood[]): SavedFood[] {
  return [...catalog].sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category);
    }
    const brandCompare = normalizeFoodName(a.brandName ?? "").localeCompare(
      normalizeFoodName(b.brandName ?? ""),
      "zh-HK",
    );
    if (brandCompare !== 0) {
      return brandCompare;
    }
    return a.name.localeCompare(b.name, "zh-HK");
  });
}

function mergeSavedFoodItem(existing: SavedFood, incoming: SavedFood): SavedFood {
  return {
    ...existing,
    ...(incoming.brandName ? { brandName: incoming.brandName } : {}),
    ...(incoming.preference ? { preference: incoming.preference } : {}),
    ...(typeof incoming.kcalAmount === "number"
      ? { kcalAmount: incoming.kcalAmount }
      : {}),
    ...(incoming.kcalUnit ? { kcalUnit: incoming.kcalUnit } : {}),
  };
}

function addMergedFoodItem(
  merged: Map<string, SavedFood>,
  item: SavedFood,
): void {
  const existingById = merged.get(item.id);
  if (existingById) {
    merged.set(item.id, mergeSavedFoodItem(existingById, item));
    return;
  }

  const duplicateEntry = [...merged.values()].find(
    (candidate) =>
      candidate.category === item.category &&
      normalizeFoodName(candidate.name).toLowerCase() ===
        normalizeFoodName(item.name).toLowerCase() &&
      hasMatchingFoodBrand(candidate.brandName, item.brandName),
  );

  if (duplicateEntry) {
    merged.set(duplicateEntry.id, mergeSavedFoodItem(duplicateEntry, item));
    return;
  }

  merged.set(item.id, { ...item });
}

export function findMatchingSupplement(
  catalog: SavedSupplement[],
  name: string,
): SavedSupplement | undefined {
  const normalizedTarget = normalizeFoodName(name).toLowerCase();
  return catalog.find(
    (item) => normalizeFoodName(item.name).toLowerCase() === normalizedTarget,
  );
}

export function sortSupplementCatalog(
  catalog: SavedSupplement[],
): SavedSupplement[] {
  return [...catalog].sort((a, b) => a.name.localeCompare(b.name, "zh-HK"));
}

export function mergeFoodCatalogs(
  sharedCatalog: SavedFood[],
  petCatalog: SavedFood[],
): SavedFood[] {
  const merged = new Map<string, SavedFood>();

  for (const item of sharedCatalog) {
    addMergedFoodItem(merged, item);
  }

  for (const item of petCatalog) {
    addMergedFoodItem(merged, item);
  }

  return sortFoodCatalog([...merged.values()]);
}

export function mergeSupplementCatalogs(
  sharedCatalog: SavedSupplement[],
  petCatalog: SavedSupplement[],
): SavedSupplement[] {
  const merged = new Map<string, SavedSupplement>();

  for (const item of sharedCatalog) {
    merged.set(item.id, { ...item });
  }

  for (const item of petCatalog) {
    const existingById = merged.get(item.id);
    if (existingById) {
      merged.set(item.id, existingById);
      continue;
    }

    const duplicateEntry = [...merged.values()].find(
      (candidate) =>
        normalizeFoodName(candidate.name).toLowerCase() ===
        normalizeFoodName(item.name).toLowerCase(),
    );

    if (!duplicateEntry) {
      merged.set(item.id, { ...item });
    }
  }

  return sortSupplementCatalog([...merged.values()]);
}

export function upsertFoodCatalogItem(
  catalog: SavedFood[],
  item: SavedFood,
): SavedFood[] {
  const merged = new Map<string, SavedFood>();

  for (const entry of catalog) {
    if (entry.id !== item.id) {
      addMergedFoodItem(merged, entry);
    }
  }

  addMergedFoodItem(merged, item);

  return sortFoodCatalog([...merged.values()]);
}

export function removeFoodCatalogItem(
  catalog: SavedFood[],
  itemId: string,
): SavedFood[] {
  return sortFoodCatalog(catalog.filter((entry) => entry.id !== itemId));
}

export function upsertSupplementCatalogItem(
  catalog: SavedSupplement[],
  item: SavedSupplement,
): SavedSupplement[] {
  return sortSupplementCatalog([
    ...catalog.filter((entry) => entry.id !== item.id),
    item,
  ]);
}

export function removeSupplementCatalogItem(
  catalog: SavedSupplement[],
  itemId: string,
): SavedSupplement[] {
  return sortSupplementCatalog(catalog.filter((entry) => entry.id !== itemId));
}

// Maps JS Date.getDay() (0=Sun, 1=Mon…6=Sat) to Weekday keys
const JS_DAY_TO_WEEKDAY: Record<number, import("../types").Weekday> = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

/**
 * Auto-generates MealEntry records in today's DailyLog from WeeklyMealSchedule entries.
 * - Only runs for today's date (current day's weekday).
 * - Skips entries already suppressed by the user (suppressedMealScheduleIds).
 * - Does NOT overwrite manual (non-virtual) entries.
 * - Marks generated entries as __virtual + __scheduleId so they can be distinguished.
 */
export async function ensureWeeklyScheduleMealLogForToday(
  pet: SharedPetProfile,
): Promise<void> {
  const schedule = pet.weeklyMealSchedule;
  if (!schedule || schedule.length === 0) return;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const todayWeekday = JS_DAY_TO_WEEKDAY[today.getDay()];
  const todayEntries = schedule.filter((e) => e.day === todayWeekday);
  if (todayEntries.length === 0) return;

  const logRef = doc(db, "pets", pet.id, "logs", dateStr);
  const snap = await getDoc(logRef);
  const loadedLog: DailyLog | null = snap.exists() ? (snap.data() as DailyLog) : null;

  const suppressedIds: string[] = loadedLog?.suppressedMealScheduleIds ?? [];
  const existingMeals = (loadedLog?.meals ?? []) as (MealEntry & {
    __scheduleId?: string;
    __virtual?: boolean;
  })[];
  const manualMeals = existingMeals.filter((m) => !m.__virtual);

  // Meals already generated from this schedule (by __scheduleId)
  const existingScheduleIds = new Set(
    existingMeals.filter((m) => m.__scheduleId).map((m) => m.__scheduleId as string),
  );

  const newVirtualMeals: (MealEntry & {
    __virtual: true;
    __scheduleId: string;
  })[] = [];

  for (const entry of todayEntries) {
    if (suppressedIds.includes(entry.id)) continue;
    if (existingScheduleIds.has(entry.id)) continue;

    const [hour, minute] = entry.time.split(":").map(Number);
    const mealTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute, 0, 0);

    // Skip if a manual meal already exists within ±30 min
    const hasManualConflict = manualMeals.some(
      (m) => Math.abs(m.time.toDate().getTime() - mealTime.getTime()) <= 30 * 60 * 1000,
    );
    if (hasManualConflict) continue;

    newVirtualMeals.push({
      grams: entry.grams,
      time: Timestamp.fromDate(mealTime),
      category: entry.category,
      ...(entry.foodName ? { foodName: entry.foodName } : {}),
      ...(entry.brandName ? { foodType: entry.brandName } : {}),
      ...(entry.kcalAmount ? { kcalAmount: entry.kcalAmount } : {}),
      ...(entry.kcalUnit ? { kcalUnit: entry.kcalUnit } : {}),
      __virtual: true as const,
      __scheduleId: entry.id,
    });
  }

  if (newVirtualMeals.length === 0) return;

  const nextMeals = [...existingMeals, ...newVirtualMeals].sort(
    (a, b) => a.time.toMillis() - b.time.toMillis(),
  );

  const updatedLog: DailyLog = {
    date: dateStr,
    petId: pet.id,
    meals: nextMeals,
    water: loadedLog?.water ?? [],
    litter: loadedLog?.litter ?? [],
    care: loadedLog?.care ?? [],
    ...(loadedLog?.weights ? { weights: loadedLog.weights } : {}),
    ...(loadedLog?.journal ? { journal: loadedLog.journal } : {}),
    ...(suppressedIds.length > 0 ? { suppressedMealScheduleIds: suppressedIds } : {}),
    totalMeals: nextMeals.reduce((sum, m) => sum + m.grams, 0),
    totalWater: loadedLog?.totalWater ?? (loadedLog?.water?.reduce((s, w) => s + w.ml, 0) ?? 0),
    litterVisits: loadedLog?.litterVisits ?? (loadedLog?.litter?.length ?? 0),
  };

  await runTransaction(db, async (transaction) => {
    transaction.set(logRef, updatedLog, { merge: true });
  });
}
