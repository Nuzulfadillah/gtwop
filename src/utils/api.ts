import { World, GrowAccount, FarmFile, UserSession, FarmSaleRecord } from '../types';

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

/**
 * Login or automatically create account on server
 */
export async function apiLogin(
  username: string,
  password?: string,
  isQuickDemo: boolean = false
): Promise<LoginResult> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, isQuickDemo }),
    });

    const json = await res.json();
    if (!res.ok) {
      return {
        success: false,
        error: json.error || 'Gagal masuk ke server farm',
      };
    }

    return {
      success: true,
      user: {
        isLoggedIn: true,
        username: json.user.username,
        growId: json.user.growId,
        avatarSeed: json.user.avatarSeed,
      },
      data: json.data,
    };
  } catch (err) {
    console.warn('API login network error, fallback to offline:', err);
    return {
      success: false,
      error: 'Tidak dapat terhubung ke server cloud. Periksa jaringan Anda.',
    };
  }
}

/**
 * Fetch latest user data from server (used for device sync polling)
 */
export async function apiFetchUserData(
  username: string
): Promise<{ success: boolean; data?: UserServerData; error?: string }> {
  try {
    const res = await fetch(
      `/api/user/data?username=${encodeURIComponent(username)}&t=${Date.now()}`,
      {
        headers: { 'Cache-Control': 'no-cache' },
      }
    );

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      return { success: false, error: errJson.error || 'Server error' };
    }

    const json = await res.json();
    return {
      success: true,
      data: {
        worlds: json.worlds,
        accounts: json.accounts,
        files: json.files,
        salesRecords: json.salesRecords || [],
        soundEnabled: json.soundEnabled,
        updatedAt: json.updatedAt,
      },
    };
  } catch (err) {
    return { success: false, error: 'Offline' };
  }
}

/**
 * Push local state changes to server so other devices see them
 */
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
  try {
    const res = await fetch('/api/user/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        ...payload,
      }),
    });

    if (!res.ok) return { success: false };
    const json = await res.json();
    return { success: true, updatedAt: json.updatedAt };
  } catch (err) {
    console.warn('Failed to sync to server (offline):', err);
    return { success: false };
  }
}
