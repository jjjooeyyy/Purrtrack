import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, deleteDoc, writeBatch } from 'firebase/firestore';
// Delete a pet and all related memberships
export async function deleteSharedPet(petId: string, userId: string): Promise<void> {
  // Remove all members from pets/{petId}/members FIRST
  const membersSnap = await getDocs(collection(db, 'pets', petId, 'members'));
  if (!membersSnap.empty) {
    const batch = writeBatch(db);
    membersSnap.forEach((docSnap) => {
      batch.delete(docSnap.ref);
    });
    await batch.commit();
  }

  // Remove pet membership from user
  await deleteDoc(doc(db, 'users', userId, 'petMemberships', petId));

  // Remove pet document LAST
  await deleteDoc(doc(db, 'pets', petId));
}
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { FeederConfig, PetMembership, SharedPetProfile, UserProfile } from '../types';

export async function upsertUserProfile(user: User): Promise<void> {
  const userRef = doc(db, 'users', user.uid);
  await setDoc(
    userRef,
    {
      uid: user.uid,
      name: user.displayName ?? null,
      email: user.email ?? null,
      photoURL: user.photoURL ?? null,
      providerId: user.providerData[0]?.providerId ?? null,
      lastLoginAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function loadUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function loadUserMemberships(uid: string): Promise<PetMembership[]> {
  const snap = await getDocs(query(collection(db, 'users', uid, 'petMemberships')));
  return snap.docs.map((d) => d.data() as PetMembership);
}

export async function loadSharedPet(petId: string): Promise<SharedPetProfile | null> {
  const snap = await getDoc(doc(db, 'pets', petId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as SharedPetProfile) : null;
}

export async function loadDefaultPetForUser(uid: string): Promise<SharedPetProfile | null> {
  const memberships = await loadUserMemberships(uid);
  if (memberships.length === 0) return null;
  const profile = await loadUserProfile(uid);
  const activeMembership =
    (profile?.activePetId ? memberships.find((m) => m.petId === profile.activePetId) : null) ??
    memberships.find((m) => m.active) ??
    memberships[0];

  if (!activeMembership) return null;

  return loadSharedPet(activeMembership.petId);
}

export async function setActivePet(uid: string, petId: string): Promise<void> {
  await Promise.all(
    [
      setDoc(
        doc(db, 'users', uid),
        {
          activePetId: petId,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      ),
      setDoc(
        doc(db, 'users', uid, 'petMemberships', petId),
        { active: true, updatedAt: serverTimestamp() },
        { merge: true },
      ),
    ],
  );
}

export async function linkUserToPet(params: {
  user: User;
  petId: string;
  role?: 'owner' | 'member';
}): Promise<void> {
  const { user, petId, role = 'member' } = params;
  const pet = await loadSharedPet(petId);
  if (!pet) {
    throw new Error('Pet not found.');
  }

  const membership: PetMembership = {
    petId,
    uid: user.uid,
    role,
    joinedAt: Timestamp.now(),
    active: true,
    userName: user.displayName ?? null,
    userEmail: user.email ?? null,
    userPhotoURL: user.photoURL ?? null,
  };

  await setDoc(doc(db, 'pets', petId, 'members', user.uid), membership, { merge: true });
  await setDoc(doc(db, 'users', user.uid, 'petMemberships', petId), membership, { merge: true });
  await setActivePet(user.uid, petId);
}

export async function createSharedPet(params: {
  user: User;
  name: string;
  birthday: Timestamp | null;
  breed: string;
  weight: number;
  gender: 'male' | 'female' | 'unknown';
  photoURL: string | null;
  feederConfig?: FeederConfig | null;
}): Promise<string> {
  const { user, ...petData } = params;
  const petRef = doc(collection(db, 'pets'));
  await setDoc(petRef, {
    ...petData,
    createdByUid: user.uid,
    createdAt: serverTimestamp(),
  });

  await linkUserToPet({ user, petId: petRef.id, role: 'owner' });

  return petRef.id;
}

export async function updateSharedPet(params: {
  petId: string;
  name: string;
  birthday: Timestamp | null;
  breed: string;
  weight: number;
  gender: 'male' | 'female' | 'unknown';
  photoURL: string | null;
  feederConfig?: FeederConfig | null;
}): Promise<void> {
  const { petId, ...petData } = params;
  await setDoc(
    doc(db, 'pets', petId),
    {
      ...petData,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
