// Returns the total kcal for an array of meal entries
export function getTotalKcal(meals: MealKcalSource[]): number {
  if (!Array.isArray(meals)) return 0;
  return meals.reduce((sum, entry) => sum + calculateMealKcalFromEntry(entry), 0);
}
import { KcalUnit } from "../types";

export type KcalDensitySource = {
  kcalAmount?: number;
  kcalUnit?: KcalUnit;
  kcalPerKg?: number;
};

export type MealKcalSource = KcalDensitySource & {
  grams: number;
};

export const DEFAULT_KCAL_UNIT: KcalUnit = "kg";
export const KCAL_UNITS: KcalUnit[] = ["kg", "100g"];

export function formatKcalUnit(unit: KcalUnit): string {
  return unit === "100g" ? "kcal/100g" : "kcal/kg";
}

export function getKcalPlaceholder(unit: KcalUnit): string {
  return unit === "100g" ? "例如 40" : "例如 400";
}

export function getKcalInputLabel(unit: KcalUnit): string {
  return unit === "100g"
    ? "每 100 克熱量 kcal/100g（選填）"
    : "每公斤熱量 kcal/kg（選填）";
}

export function resolveKcalDensity(
  source: KcalDensitySource,
): { amount: number; unit: KcalUnit } | null {
  if (
    typeof source.kcalAmount === "number" &&
    Number.isFinite(source.kcalAmount) &&
    source.kcalAmount > 0
  ) {
    return {
      amount: source.kcalAmount,
      unit: source.kcalUnit ?? DEFAULT_KCAL_UNIT,
    };
  }

  if (
    typeof source.kcalPerKg === "number" &&
    Number.isFinite(source.kcalPerKg) &&
    source.kcalPerKg > 0
  ) {
    return {
      amount: source.kcalPerKg,
      unit: "kg",
    };
  }

  return null;
}

export function calculateMealKcal(
  grams: number,
  kcalAmount?: number,
  kcalUnit: KcalUnit = DEFAULT_KCAL_UNIT,
): number {
  if (!Number.isFinite(grams) || grams <= 0) {
    return 0;
  }
  if (!Number.isFinite(kcalAmount) || !kcalAmount || kcalAmount <= 0) {
    return 0;
  }

  const divisor = kcalUnit === "100g" ? 100 : 1000;
  return Math.round((grams / divisor) * kcalAmount);
}

export function calculateMealKcalFromEntry(entry: MealKcalSource): number {
  const density = resolveKcalDensity(entry);
  if (!density) {
    return 0;
  }

  return calculateMealKcal(entry.grams, density.amount, density.unit);
}