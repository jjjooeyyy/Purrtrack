import { doc, setDoc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, SharedPetProfile, SavedFood, SavedSupplement } from '../types';
import {
  mergeFoodCatalogs,
  mergeSupplementCatalogs,
  sortFoodCatalog,
  sortSupplementCatalog,
} from './mealCatalog';
import { buildScheduleFoodCatalog } from './mealSchedule';

function areCatalogsEqual(left: unknown[], right: unknown[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function reconcileSharedCatalog(
  uid: string,
  userProfile: UserProfile | null,
  pets: SharedPetProfile[],
): Promise<UserProfile | null> {
  const petFoods = pets.flatMap((pet) => pet.foodCatalog ?? []);
  const petSupplements = pets.flatMap((pet) => pet.supplementCatalog ?? []);
  const scheduleEntries = pets.flatMap((pet) => pet.weeklyMealSchedule ?? []);

  const reconciledFoods = sortFoodCatalog(
    buildScheduleFoodCatalog(
      scheduleEntries,
      mergeFoodCatalogs(userProfile?.sharedFoodCatalog ?? [], petFoods),
    ),
  );
  const reconciledSupplements = sortSupplementCatalog(
    mergeSupplementCatalogs(
      userProfile?.sharedSupplementCatalog ?? [],
      petSupplements,
    ),
  );

  const currentFoods = sortFoodCatalog(userProfile?.sharedFoodCatalog ?? []);
  const currentSupplements = sortSupplementCatalog(
    userProfile?.sharedSupplementCatalog ?? [],
  );

  if (
    areCatalogsEqual(reconciledFoods, currentFoods) &&
    areCatalogsEqual(reconciledSupplements, currentSupplements)
  ) {
    return userProfile;
  }

  await setDoc(
    doc(db, 'users', uid),
    {
      sharedFoodCatalog: reconciledFoods,
      sharedSupplementCatalog: reconciledSupplements,
      updatedAt: new Date(),
    },
    { merge: true },
  );

  return userProfile
    ? {
        ...userProfile,
        sharedFoodCatalog: reconciledFoods,
        sharedSupplementCatalog: reconciledSupplements,
      }
    : userProfile;
}

/**
 * Migrates legacy per-pet catalogs into the shared user catalog.
 * This is a one-time operation that consolidates all pet food/supplement
 * catalogs into the owner's shared catalog, deduping by name and category.
 *
 * @param uid User ID
 * @param userProfile Current user profile
 * @param pets Array of all user's pets
 */
export async function migrateToSharedCatalog(
  uid: string,
  userProfile: UserProfile | null,
  pets: SharedPetProfile[],
): Promise<void> {
  // Skip if already migrated or no pets
  if (userProfile?.migratedToCatalogV2 || pets.length === 0) {
    return;
  }

  const reconciledProfile = await reconcileSharedCatalog(uid, userProfile, pets);

  // Update user profile with migrated catalogs and migration flag
  const userRef = doc(db, 'users', uid);
  await setDoc(
    userRef,
    {
      sharedFoodCatalog: reconciledProfile?.sharedFoodCatalog ?? [],
      sharedSupplementCatalog: reconciledProfile?.sharedSupplementCatalog ?? [],
      migratedToCatalogV2: true,
      updatedAt: new Date(),
    },
    { merge: true },
  );
}
