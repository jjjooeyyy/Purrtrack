import { initializeApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebaseConfig } from './firebaseConfig';

type ReactNativeAsyncStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

function getReactNativePersistence(storage: ReactNativeAsyncStorage) {
  return class {
    static type = 'LOCAL' as const;
    readonly type = 'LOCAL' as const;

    async _isAvailable() {
      try {
        if (!storage) {
          return false;
        }
        await storage.setItem('__firebase_auth_test__', '1');
        await storage.removeItem('__firebase_auth_test__');
        return true;
      } catch {
        return false;
      }
    }

    _set(key: string, value: unknown) {
      return storage.setItem(key, JSON.stringify(value));
    }

    async _get<T>(key: string) {
      const json = await storage.getItem(key);
      return json ? JSON.parse(json) : null;
    }

    async _remove(key: string) {
      await storage.removeItem(key);
    }

    _addListener() {}

    _removeListener() {}
  };
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = (() => {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
})();
export const db = getFirestore(app);
export const storage = getStorage(app);
