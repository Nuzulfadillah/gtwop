import { World, GrowAccount, FarmFile, UserSession, FarmSaleRecord } from '../types';
import {
  INITIAL_WORLDS,
  INITIAL_ACCOUNTS,
  INITIAL_FILES,
  INITIAL_SALES_RECORDS,
} from '../data/presets';

export interface UserServerData {
  worlds: World[];
  accounts: GrowAccount[];
  files: FarmFile[];
  salesRecords?: FarmSaleRecord[];
  soundEnabled: boolean;
  updatedAt: number;
}

export interface LoginResult {
  success: boolean;
  error?: string;
  user?: UserSession;
  data?: UserServerData;
}

interface StoredUser {
  username: string;
  growId: string;
  password: string;
  avatarSeed: string;
  updatedAt: number;
  worlds: World[];
  accounts: GrowAccount[];
  files: FarmFile[];
  salesRecords: FarmSaleRecord[];
  soundEnabled: boolean;
}

const DB_NAME = 'growtopia_farm_manager';
const STORE = 'users';

const memoryStore = new Map<string, StoredUser>();

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (err) {
        reject(err);
      }
    });
  }
  return dbPromise;
}

async function readUser(key: string): Promise<StoredUser | undefined> {
  try {
    const db = await openDb();
    return await new Promise<StoredUser | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as StoredUser | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return memoryStore.get(key);
  }
}

async function writeUser(key: string, user: StoredUser): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(user, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    memoryStore.set(key, user);
  }
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function toData(user: StoredUser): UserServerData {
  return {
    worlds: user.worlds,
    accounts: user.accounts,
    files: user.files,
    salesRecords: user.salesRecords || [],
    soundEnabled: user.soundEnabled,
    updatedAt: user.updatedAt,
  };
}

export async function apiLogin(
  username: string,
  password?: string,
  isQuickDemo: boolean = false
): Promise<LoginResult> {
  const cleanName = (username || '').trim();
  if (!cleanName) {
    return { success: false, error: 'Username atau GrowID wajib diisi' };
  }
  const key = cleanName.toLowerCase();
  const isDemo = key === 'nuzulfarmer';

  let user = await readUser(key);

  if (!user) {
    user = {
      username: cleanName,
      growId: cleanName,
      password: password || '',
      avatarSeed: key,
      updatedAt: Date.now(),
      worlds: isDemo ? clone(INITIAL_WORLDS) : [],
      accounts: isDemo
        ? clone(INITIAL_ACCOUNTS)
        : [
            {
              id: `acc-${Date.now()}`,
              growId: cleanName,
              label: 'Akun Utama',
              notes: 'Akun Growtopia utama',
              level: 1,
              createdAt: new Date().toISOString(),
            } as GrowAccount,
          ],
      files: isDemo ? clone(INITIAL_FILES) : [],
      salesRecords: isDemo ? clone(INITIAL_SALES_RECORDS) : [],
      soundEnabled: true,
    };
    await writeUser(key, user);
  } else if (user.password && !isQuickDemo) {
    if (password && password !== user.password) {
      return { success: false, error: 'Sandi atau PIN salah untuk GrowID ini.' };
    }
  } else if (password && !user.password) {
    user.password = password;
    await writeUser(key, user);
  }

  return {
    success: true,
    user: {
      isLoggedIn: true,
      username: user.username,
      growId: user.growId,
      avatarSeed: user.avatarSeed,
    },
    data: toData(user),
  };
}

export async function apiFetchUserData(
  username: string
): Promise<{ success: boolean; data?: UserServerData; error?: string }> {
  const user = await readUser((username || '').trim().toLowerCase());
  if (!user) {
    return { success: false, error: 'Akun tidak ditemukan' };
  }
  return { success: true, data: toData(user) };
}

export async function apiSyncUserData(
  username: string,
  payload: {
    worlds: World[];
    accounts: GrowAccount[];
    files: FarmFile[];
    salesRecords?: FarmSaleRecord[];
    soundEnabled: boolean;
    clientUpdatedAt?: number;
  }
): Promise<{ success: boolean; updatedAt?: number }> {
  const cleanName = (username || '').trim();
  const key = cleanName.toLowerCase();
  if (!key) return { success: false };

  const existing = await readUser(key);
  const user: StoredUser = existing || {
    username: cleanName,
    growId: cleanName,
    password: '',
    avatarSeed: key,
    updatedAt: Date.now(),
    worlds: [],
    accounts: [],
    files: [],
    salesRecords: [],
    soundEnabled: true,
  };

  if (Array.isArray(payload.worlds)) user.worlds = payload.worlds;
  if (Array.isArray(payload.accounts)) user.accounts = payload.accounts;
  if (Array.isArray(payload.files)) user.files = payload.files;
  if (Array.isArray(payload.salesRecords)) user.salesRecords = payload.salesRecords;
  if (payload.soundEnabled !== undefined) user.soundEnabled = payload.soundEnabled;
  user.updatedAt = Date.now();

  await writeUser(key, user);
  return { success: true, updatedAt: user.updatedAt };
}
