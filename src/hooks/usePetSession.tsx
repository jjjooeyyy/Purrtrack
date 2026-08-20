import AsyncStorage from "@react-native-async-storage/async-storage";
import { onAuthStateChanged, User } from "firebase/auth";
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";
import DefaultPreference from "react-native-default-preference";
import { auth } from "../firebase";
import { ensureVirtualMealLogForDay } from "../lib/mealCatalog";
import {
    migrateToSharedCatalog,
    reconcileSharedCatalog,
} from "../lib/migration";
import {
    loadSharedPet,
    loadUserMemberships,
    loadUserProfile,
    setActivePet,
    upsertUserProfile,
} from "../lib/pets";
import {
    PetMembership,
    SavedFood,
    SavedSupplement,
    SharedPetProfile,
    UserProfile,
} from "../types";

type SessionCacheData = {
  profile: UserProfile;
  pets: SharedPetProfile[];
};

const CACHE_VERSION = "v2";
const PROFILE_UPDATE_TS_KEY = "purrtrack_profile_update_ts";
const PROFILE_UPDATE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function getTodayDateString() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sessionCacheKey(uid: string) {
  return `purrtrack_session_${uid}_${CACHE_VERSION}`;
}

async function readSessionCache(uid: string): Promise<SessionCacheData | null> {
  try {
    const raw = await AsyncStorage.getItem(sessionCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return rehydrateTimestamps(parsed) as SessionCacheData;
  } catch {
    return null;
  }
}

/**
 * Firestore Timestamp objects lose their `toDate()` method when round-tripped
 * through JSON.stringify/parse. Walk the tree and restore the method on any
 * plain { seconds, nanoseconds } objects so the rest of the app can call
 * .toDate() without crashing.
 */
function rehydrateTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(rehydrateTimestamps);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (
      typeof obj["seconds"] === "number" &&
      typeof obj["nanoseconds"] === "number" &&
      typeof obj["toDate"] !== "function"
    ) {
      return {
        ...obj,
        toDate: () => new Date((obj["seconds"] as number) * 1000),
      };
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = rehydrateTimestamps(obj[key]);
    }
    return result;
  }
  return value;
}

async function writeSessionCache(
  uid: string,
  data: SessionCacheData,
): Promise<void> {
  try {
    await AsyncStorage.setItem(sessionCacheKey(uid), JSON.stringify(data));
  } catch {
    // Non-critical: session will just reload from Firestore next time
  }
}

async function shouldUpdateProfile(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_UPDATE_TS_KEY);
    if (!raw) return true;
    return Date.now() - Number(raw) > PROFILE_UPDATE_INTERVAL_MS;
  } catch {
    return true;
  }
}

async function markProfileUpdated(): Promise<void> {
  try {
    await AsyncStorage.setItem(PROFILE_UPDATE_TS_KEY, String(Date.now()));
  } catch {}
}

type PetSessionValue = {
  user: User | null;
  profile: UserProfile | null;
  memberships: PetMembership[];
  pets: SharedPetProfile[];
  activePet: SharedPetProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  changeActivePet: (petId: string) => Promise<void>;
  updateSharedCatalogs: (
    catalogs: {
      foodCatalog?: SavedFood[];
      supplementCatalog?: SavedSupplement[];
    },
    options?: { updateCache?: boolean },
  ) => void;
};

const PetSessionContext = createContext<PetSessionValue | undefined>(undefined);

export function PetSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [memberships, setMemberships] = useState<PetMembership[]>([]);
  const [pets, setPets] = useState<SharedPetProfile[]>([]);
  const [activePet, setActivePetState] = useState<SharedPetProfile | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const currentUser = auth.currentUser;
    setUser(currentUser);

    if (!currentUser) {
      setProfile(null);
      setMemberships([]);
      setPets([]);
      setActivePetState(null);
      setLoading(false);
      return;
    }

    // FAST PATH: Apply cached session instantly so the UI shows immediately
    const cached = await readSessionCache(currentUser.uid);
    if (cached?.profile && cached.pets.length > 0) {
      const cachedActivePetId =
        cached.profile.activePetId ?? cached.pets[0]?.id ?? null;
      const cachedActivePet =
        (cachedActivePetId
          ? cached.pets.find((p) => p.id === cachedActivePetId)
          : null) ??
        cached.pets[0] ??
        null;
      setProfile(cached.profile);
      setPets(cached.pets);
      setActivePetState(cachedActivePet);
      setLoading(false);
    }

    // NETWORK PATH: Always fetch fresh data in background
    void (async () => {
      try {
        // Throttle profile timestamp write to once per hour
        if (await shouldUpdateProfile()) {
          void upsertUserProfile(currentUser)
            .then(() => markProfileUpdated())
            .catch((e) =>
              console.warn("Failed to update user profile timestamp", e),
            );
        }

        const [userProfile, userMemberships] = await Promise.all([
          loadUserProfile(currentUser.uid),
          loadUserMemberships(currentUser.uid),
        ]);

        const activePetId =
          userProfile?.activePetId ??
          userMemberships.find((m) => m.active)?.petId ??
          userMemberships[0]?.petId ??
          null;

        const activePetProfile = activePetId
          ? await loadSharedPet(activePetId)
          : null;

        setProfile(userProfile);
        setMemberships(userMemberships);
        setPets(activePetProfile ? [activePetProfile] : []);
        setActivePetState(activePetProfile);
        if (!cached) setLoading(false);

        // Load remaining pets concurrently
        const loadedPets = (
          await Promise.all(
            userMemberships
              .filter((m) => m.petId !== activePetId)
              .map((m) => loadSharedPet(m.petId)),
          )
        ).filter((pet): pet is SharedPetProfile => pet !== null);

        const allPets = activePetProfile
          ? [activePetProfile, ...loadedPets]
          : loadedPets;

        // One-time migration
        let latestProfile = userProfile;
        if (latestProfile && !latestProfile.migratedToCatalogV2) {
          try {
            await migrateToSharedCatalog(
              currentUser.uid,
              latestProfile,
              allPets,
            );
            latestProfile = await loadUserProfile(currentUser.uid);
            setProfile(latestProfile);
          } catch (error) {
            console.warn("Migration to shared catalog failed", error);
          }
        }

        // Reconcile shared catalog once
        try {
          latestProfile = await reconcileSharedCatalog(
            currentUser.uid,
            latestProfile,
            allPets,
          );
          setProfile(latestProfile);
        } catch (error) {
          console.warn("Shared catalog reconciliation failed", error);
        }

        const orderedPets = activePetId
          ? [...allPets].sort(
              (l, r) =>
                Number(r.id === activePetId) - Number(l.id === activePetId),
            )
          : allPets;

        setPets(orderedPets);
        const finalActivePet =
          orderedPets.find((p) => p.id === activePetId) ??
          orderedPets[0] ??
          null;
        setActivePetState(finalActivePet);

        // Update App Group for Widget
        if (finalActivePet) {
          DefaultPreference.setName("group.com.jjjooeyyy.purrtrack");
          DefaultPreference.set("activePetId", finalActivePet.id);
          DefaultPreference.set("activePetName", finalActivePet.name);

          // Sync schedule for the current day
          const mealSchedule =
            finalActivePet.weeklyMealSchedule ||
            (finalActivePet as any).mealSchedule;
          if (mealSchedule) {
            const days: any = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
            const today = days[new Date().getDay()];
            const todaySchedule = mealSchedule
              .filter((s: any) => s.day === today)
              .sort((a: any, b: any) => a.time.localeCompare(b.time));

            DefaultPreference.set(
              "todaySchedule",
              JSON.stringify(todaySchedule),
            );
          } else {
            console.log("No schedule found for syncing");
            DefaultPreference.set("todaySchedule", "[]");
          }

          if (
            finalActivePet.feederConfig?.enabled &&
            finalActivePet.feederConfig.schedules?.length
          ) {
            await ensureVirtualMealLogForDay(
              getTodayDateString(),
              finalActivePet,
            );
          }
        }

        // Persist fresh data so next session starts instantly
        if (latestProfile) {
          void writeSessionCache(currentUser.uid, {
            profile: latestProfile,
            pets: orderedPets,
          });
        }
      } catch (error) {
        console.warn("Failed to load pet session from network", error);
        if (!cached) setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, () => {
      setLoading(true);
      refresh().catch((error) => {
        console.error("Failed to load pet session", error);
        setLoading(false);
      });
    });
    return unsubscribe;
  }, [refresh]);

  const changeActivePet = useCallback(
    async (petId: string) => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const nextActivePet = pets.find((pet) => pet.id === petId) ?? null;
      const orderedPets = [...pets].sort(
        (l, r) => Number(r.id === petId) - Number(l.id === petId),
      );

      if (nextActivePet) {
        setActivePetState(nextActivePet);
        setPets(orderedPets);
        setProfile((p) => (p ? { ...p, activePetId: petId } : p));

        // Update App Group for Widget
        DefaultPreference.setName("group.com.jjjooeyyy.purrtrack");
        DefaultPreference.set("activePetId", nextActivePet.id);
        DefaultPreference.set("activePetName", nextActivePet.name);

        // Sync schedule for the current day
        const mealSchedule =
          nextActivePet.weeklyMealSchedule ||
          (nextActivePet as any).mealSchedule;
        if (mealSchedule) {
          const days: any = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
          const today = days[new Date().getDay()];
          const todaySchedule = mealSchedule
            .filter((s: any) => s.day === today)
            .sort((a: any, b: any) => a.time.localeCompare(b.time));
          DefaultPreference.set("todaySchedule", JSON.stringify(todaySchedule));
        } else {
          DefaultPreference.set("todaySchedule", "[]");
        }

        if (
          nextActivePet.feederConfig?.enabled &&
          nextActivePet.feederConfig.schedules?.length
        ) {
          await ensureVirtualMealLogForDay(getTodayDateString(), nextActivePet);
        }
      }

      try {
        await setActivePet(uid, petId);
        // Update the cache so the next refresh uses the correct active pet
        if (profile) {
          void writeSessionCache(uid, {
            profile: { ...profile, activePetId: petId },
            pets: orderedPets,
          });
        }
      } catch (error) {
        // On error revert to a clean state via full refresh
        await refresh();
        throw error;
      }
    },
    [pets, profile, refresh],
  );

  const updateSharedCatalogs = useCallback(
    (
      {
        foodCatalog,
        supplementCatalog,
      }: {
        foodCatalog?: SavedFood[];
        supplementCatalog?: SavedSupplement[];
      },
      options?: { updateCache?: boolean },
    ) => {
      setProfile((currentProfile) => {
        if (!currentProfile) {
          return currentProfile;
        }

        const nextProfile = {
          ...currentProfile,
          ...(foodCatalog ? { sharedFoodCatalog: foodCatalog } : {}),
          ...(supplementCatalog
            ? { sharedSupplementCatalog: supplementCatalog }
            : {}),
        };

        if (options?.updateCache && user) {
          void writeSessionCache(user.uid, {
            profile: nextProfile,
            pets: pets,
          });
        }

        return nextProfile;
      });
    },
    [user, pets],
  );

  return (
    <PetSessionContext.Provider
      value={{
        user,
        profile,
        memberships,
        pets,
        activePet,
        loading,
        refresh,
        changeActivePet,
        updateSharedCatalogs,
      }}
    >
      {children}
    </PetSessionContext.Provider>
  );
}

export function usePetSession() {
  const ctx = useContext(PetSessionContext);
  if (!ctx) {
    throw new Error("usePetSession must be used within PetSessionProvider");
  }
  return ctx;
}
