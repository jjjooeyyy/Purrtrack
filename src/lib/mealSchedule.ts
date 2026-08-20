import { MealCategory, SavedFood, Weekday, WeeklyMealScheduleEntry } from "../types";
import {
    createFoodCatalogId,
    findMatchingFood,
    mergeFoodCatalogs,
    normalizeFoodName,
} from "./mealCatalog";

export const WEEKDAY_ORDER: Weekday[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};


const SNACK_KEYWORDS = [
  "treat",
  "snack",
  "零食",
  "tuna bite",
  "cream",
  "lick",
  "lickable",
  "chew",
  "bite",
  "reward",
];
const DRY_KEYWORDS = ["dry", "kibble", "乾糧", "crunchy", "biscuits", "biscuit"];

export function createWeeklyMealScheduleId(): string {
  return `schedule-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function isValidScheduleTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

export function compareScheduleEntries(
  left: WeeklyMealScheduleEntry,
  right: WeeklyMealScheduleEntry,
): number {
  if (left.day !== right.day) {
    return WEEKDAY_ORDER.indexOf(left.day) - WEEKDAY_ORDER.indexOf(right.day);
  }
  if (left.time !== right.time) {
    return left.time.localeCompare(right.time);
  }
  return left.sortOrder - right.sortOrder;
}

export function sortScheduleEntries(
  entries: WeeklyMealScheduleEntry[],
): WeeklyMealScheduleEntry[] {
  return [...entries].sort(compareScheduleEntries);
}

export function resequenceDayEntries(
  entries: WeeklyMealScheduleEntry[],
  day: Weekday,
): WeeklyMealScheduleEntry[] {
  const dayEntries = entries
    .filter((entry) => entry.day === day)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((entry, index) => ({ ...entry, sortOrder: index }));

  return sortScheduleEntries([
    ...entries.filter((entry) => entry.day !== day),
    ...dayEntries,
  ]);
}

export function getNextDaySortOrder(
  entries: WeeklyMealScheduleEntry[],
  day: Weekday,
): number {
  return entries.filter((entry) => entry.day === day).length;
}

export function buildScheduleFoodCatalog(
  entries: WeeklyMealScheduleEntry[],
  existingCatalog: SavedFood[],
): SavedFood[] {
  const merged = mergeFoodCatalogs(existingCatalog, []);

  for (const entry of entries) {
    const normalizedName = normalizeFoodName(entry.foodName);
    const normalizedBrandName = normalizeFoodName(entry.brandName ?? "");
    if (!normalizedName) {
      continue;
    }
    const exists = findMatchingFood(
      merged,
      entry.category,
      normalizedName,
      normalizedBrandName || undefined,
    );
    if (!exists) {
      merged.push({
        id: createFoodCatalogId(),
        name: normalizedName,
        category: entry.category,
        ...(normalizedBrandName ? { brandName: normalizedBrandName } : {}),
        ...(typeof entry.kcalAmount === "number"
          ? { kcalAmount: entry.kcalAmount }
          : {}),
        ...(entry.kcalUnit ? { kcalUnit: entry.kcalUnit } : {}),
      });
      continue;
    }
    if (typeof entry.kcalAmount === "number" || entry.kcalUnit) {
      const existingIndex = merged.findIndex((item) =>
        item.id === exists.id,
      );
      if (existingIndex >= 0) {
        merged[existingIndex] = {
          ...merged[existingIndex],
          ...(typeof entry.kcalAmount === "number"
            ? { kcalAmount: entry.kcalAmount }
            : {}),
          ...(entry.kcalUnit ? { kcalUnit: entry.kcalUnit } : {}),
        };
      }
    }
  }

  return merged.sort((left, right) => {
    if (left.category !== right.category) {
      return left.category.localeCompare(right.category);
    }
    const brandCompare = normalizeFoodName(left.brandName ?? "").localeCompare(
      normalizeFoodName(right.brandName ?? ""),
      "zh-HK",
    );
    if (brandCompare !== 0) {
      return brandCompare;
    }
    return left.name.localeCompare(right.name, "zh-HK");
  });
}

function inferCategoryFromProductText(value: string): MealCategory {
  const normalized = value.toLowerCase();
  if (SNACK_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "snack";
  }
  if (DRY_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "dry";
  }
  return "wet";
}

