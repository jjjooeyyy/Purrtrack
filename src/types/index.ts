import { Timestamp } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  name: string | null;
  email: string | null;
  photoURL: string | null;
  providerId: string | null;
  activePetId: string | null;
  sharedFoodCatalog?: SavedFood[];
  sharedSupplementCatalog?: SavedSupplement[];
  migratedToCatalogV2?: boolean;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  lastLoginAt?: Timestamp | null;
}

export interface CatProfile {
  id: string;
  name: string;
  birthday: Timestamp | null;
  breed: string;
  weight: number;
  gender: 'male' | 'female' | 'unknown';
  photoURL: string | null;
  createdAt: Timestamp;
}

export interface PetMembership {
  petId: string;
  uid: string;
  role: 'owner' | 'member';
  joinedAt: Timestamp;
  active: boolean;
  userName: string | null;
  userEmail: string | null;
  userPhotoURL: string | null;
}

export interface SharedPetProfile {
  id: string;
  name: string;
  birthday: Timestamp | null;
  breed: string;
  weight: number;
  gender: 'male' | 'female' | 'unknown';
  photoURL: string | null;
  createdByUid: string;
  createdAt: Timestamp;
  feederConfig?: FeederConfig | null;
  foodCatalog?: SavedFood[];
  supplementCatalog?: SavedSupplement[];
  weeklyMealSchedule?: WeeklyMealScheduleEntry[];
}

export interface FeederSchedule {
  id: string;
  portion: number;
  unit: 'g' | 'portion';
  dispatchTime: string; // HH:MM
  foodName?: string;
  kcalAmount?: number;
  kcalUnit?: KcalUnit;
}

export interface FeederConfig {
  enabled: boolean;
  schedules: FeederSchedule[];
}

export type MealCategory = 'dry' | 'wet' | 'snack';

export type KcalUnit = 'kg' | '100g';

export type FoodPreference = 'like' | 'neutral' | 'dislike';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface WeeklyMealScheduleEntry {
  id: string;
  day: Weekday;
  time: string; // HH:MM
  category: MealCategory;
  grams: number;
  foodName: string;
  brandName?: string;
  barcode?: string;
  note?: string;
  kcalAmount?: number;
  kcalUnit?: KcalUnit;
  kcalPerKg?: number; // legacy kcal per kilogram
  sortOrder: number;
}

export interface SavedFood {
  id: string;
  name: string;
  category: MealCategory;
  brandName?: string;
  preference?: FoodPreference;
  kcalAmount?: number;
  kcalUnit?: KcalUnit;
}

export interface SavedSupplement {
  id: string;
  name: string;
}

export interface MealEntry {
  grams: number;
  category?: MealCategory;
  foodName?: string;
  foodPreference?: FoodPreference;
  supplement?: string;
  foodType?: string;
  kcalAmount?: number;
  kcalUnit?: KcalUnit;
  kcalPerKg?: number;
  time: Timestamp;
}

export interface WaterEntry {
  ml: number;
  time: Timestamp;
  estimated: boolean;
  source: 'preset' | 'drag' | 'manual';
}

export interface LitterEntry {
  time: Timestamp;
  kind: 'wee' | 'poo';
  count: number;
  size: 'small' | 'medium' | 'large' | 'extraLarge';
  condition?: 'hard' | 'normal' | 'soft' | null;
}

export interface CareEntry {
  action:
    | 'nail_cut'
    | 'flea_treatment'
    | 'vet_visit'
    | 'vaccine'
    | 'deworming'
    | 'bath'
    | 'grooming'
    | 'other';
  note?: string;
  time: Timestamp;
}

export interface JournalEntry {
  mood: 'energetic' | 'playful' | 'normal' | 'tired' | 'anxious' | 'sick';
  note?: string;
  photoURL?: string;
  updatedAt: Timestamp;
}

export interface WeightEntry {
  kg: number;
  time: Timestamp;
  note?: string;
}

export interface DailyLog {
  date: string; // YYYY-MM-DD
  meals: MealEntry[];
  water: WaterEntry[];
  litter: LitterEntry[];
  care: CareEntry[];
  weights?: WeightEntry[];
  journal?: JournalEntry;
  suppressedMealScheduleIds?: string[];
  totalMeals: number;
  totalWater: number;
  litterVisits: number;
  petId: string;
}
