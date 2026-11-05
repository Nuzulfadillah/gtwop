/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { World, GrowAccount, FarmFile, UserSession, FarmSaleRecord } from './types';
import {
  INITIAL_WORLDS,
  INITIAL_ACCOUNTS,
  INITIAL_FILES,
  INITIAL_SALES_RECORDS,
} from './data/presets';
import { calculateHarvestTime } from './utils/time';
import { apiFetchUserData, apiSyncUserData, UserServerData } from './utils/api';
import { Header } from './components/Header';
import { Sidebar, NavTab } from './components/Sidebar';
import { BottomNav } from './components/BottomNav';
import { WorldModal } from './components/WorldModal';
import { AccountModal } from './components/AccountModal';
import { FileUploadModal } from './components/FileUploadModal';
import { HarvestModal } from './components/HarvestModal';
import { QuickPlantModal } from './components/QuickPlantModal';
import { DashboardPage } from './pages/DashboardPage';
import { WorldsPage } from './pages/WorldsPage';
import { AccountsPage } from './pages/AccountsPage';
import { FilesPage } from './pages/FilesPage';
import { CalculatorPage } from './pages/CalculatorPage';
import { LoginPage } from './pages/LoginPage';

const STORAGE_KEYS = {
  WORLDS: 'gt_farm_worlds_v1',
  ACCOUNTS: 'gt_farm_accounts_v1',
  FILES: 'gt_farm_files_v1',
  SALES: 'gt_farm_sales_v1',
  SESSION: 'gt_farm_session_v1',
  SOUND: 'gt_farm_sound_v1',
};

export default function App() {
  // Session State
  const [session, setSession] = useState<UserSession>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SESSION);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return {
      isLoggedIn: true,
      username: 'NuzulFarmer',
      growId: 'NuzulFarmer',
      avatarSeed: 'nuzulfarmer',
    };
  });

  // Data States with LocalStorage Persistence
  const [worlds, setWorlds] = useState<World[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.WORLDS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // If the user's saved data doesn't have an empty world yet, seed sample empty world
          const hasEmpty = parsed.some((w: World) => w.isEmpty);
          const sampleEmpty = INITIAL_WORLDS.find((w) => w.id === 'w-7');
          if (!hasEmpty && sampleEmpty && !parsed.some((w: World) => w.id === sampleEmpty.id)) {
            return [...parsed, sampleEmpty];
          }
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return INITIAL_WORLDS;
  });

  const [accounts, setAccounts] = useState<GrowAccount[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.ACCOUNTS);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return INITIAL_ACCOUNTS;
  });

  const [files, setFiles] = useState<FarmFile[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.FILES);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return INITIAL_FILES;
  });

  const [salesRecords, setSalesRecords] = useState<FarmSaleRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SALES);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return INITIAL_SALES_RECORDS;
  });

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SOUND);
      if (saved !== null) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return true;
  });

  // Current active navigation tab
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [worldStatusFilter, setWorldStatusFilter] = useState<string>('all');

  // Realtime clock ticker (ticks every 1000ms for smooth live countdown)
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.WORLDS, JSON.stringify(worlds));
    } catch {
      // ignore
    }
  }, [worlds]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts));
    } catch {
      // ignore
    }
  }, [accounts]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.FILES, JSON.stringify(files));
    } catch {
      // ignore
    }
  }, [files]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(salesRecords));
    } catch {
      // ignore
    }
  }, [salesRecords]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
    } catch {
      // ignore
    }
  }, [session]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SOUND, JSON.stringify(soundEnabled));
    } catch {
      // ignore
    }
  }, [soundEnabled]);

  // Cloud Sync & Multi-Device States
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline'>('synced');
  const [serverUpdatedAt, setServerUpdatedAt] = useState<number>(0);
  const isInitialMount = useRef(true);
  const skipNextSync = useRef(false);

  // 1. Debounced auto-sync to server whenever local state changes
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    if (!session.isLoggedIn || !session.username) return;

    setSyncStatus('syncing');
    const timer = setTimeout(async () => {
      const res = await apiSyncUserData(session.username, {
        worlds,
        accounts,
        files,
        salesRecords,
        soundEnabled,
      });
      if (res.success && res.updatedAt) {
        setServerUpdatedAt(res.updatedAt);
        setSyncStatus('synced');
      } else {
        setSyncStatus('offline');
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [worlds, accounts, files, salesRecords, soundEnabled, session.isLoggedIn, session.username]);

  // 2. Background polling from server so other devices' changes reflect immediately
  useEffect(() => {
    if (!session.isLoggedIn || !session.username) return;

    const fetchFromServer = async () => {
      const res = await apiFetchUserData(session.username);
      if (res.success && res.data) {
        if (!serverUpdatedAt || res.data.updatedAt > serverUpdatedAt) {
          skipNextSync.current = true;
          setWorlds(res.data.worlds);
          setAccounts(res.data.accounts);
          setFiles(res.data.files);
          if (res.data.salesRecords) setSalesRecords(res.data.salesRecords);
          setSoundEnabled(res.data.soundEnabled);
          setServerUpdatedAt(res.data.updatedAt);
        }
        setSyncStatus('synced');
      }
    };

    fetchFromServer();

    // Poll every 3500ms
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchFromServer();
      }
    }, 3500);

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        fetchFromServer();
      }
    };

    window.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('focus', onVisibilityOrFocus);

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('focus', onVisibilityOrFocus);
    };
  }, [session.isLoggedIn, session.username, serverUpdatedAt]);

  const handleManualSync = useCallback(async () => {
    if (!session.isLoggedIn || !session.username) return;
    setSyncStatus('syncing');
    const res = await apiFetchUserData(session.username);
    if (res.success && res.data) {
      skipNextSync.current = true;
      setWorlds(res.data.worlds);
      setAccounts(res.data.accounts);
      setFiles(res.data.files);
      if (res.data.salesRecords) setSalesRecords(res.data.salesRecords);
      setSoundEnabled(res.data.soundEnabled);
      setServerUpdatedAt(res.data.updatedAt);
      setSyncStatus('synced');
    } else {
      setSyncStatus('offline');
    }
  }, [session.isLoggedIn, session.username]);

  // Modal States
  const [isWorldModalOpen, setIsWorldModalOpen] = useState(false);
  const [worldToEdit, setWorldToEdit] = useState<World | null>(null);

  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [accountToEdit, setAccountToEdit] = useState<GrowAccount | null>(null);

  const [isFileModalOpen, setIsFileModalOpen] = useState(false);

  const [isHarvestModalOpen, setIsHarvestModalOpen] = useState(false);
  const [worldToHarvest, setWorldToHarvest] = useState<World | null>(null);

  const [isPlantModalOpen, setIsPlantModalOpen] = useState(false);
  const [worldToPlant, setWorldToPlant] = useState<World | null>(null);

  // Handlers for World
  const handleOpenAddWorld = () => {
    setWorldToEdit(null);
    setIsWorldModalOpen(true);
  };

  const handleEditWorld = (world: World) => {
    setWorldToEdit(world);
    setIsWorldModalOpen(true);
  };

  const handleSaveWorld = (
    worldData: Omit<World, 'id' | 'harvestCount'> & { id?: string }
  ) => {
    if (worldData.id) {
      // Update
      setWorlds((prev) =>
        prev.map((w) =>
          w.id === worldData.id
            ? {
                ...w,
                ...worldData,
                id: worldData.id!,
              }
            : w
        )
      );
    } else {
      // Create
      const newWorld: World = {
        ...worldData,
        id: `world-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        harvestCount: 0,
      };
      setWorlds((prev) => [newWorld, ...prev]);
    }
  };

  const handleDeleteWorld = (worldId: string) => {
    setWorlds((prev) => prev.filter((w) => w.id !== worldId));
  };

  // Quick Harvest & Replant action
  const handleTriggerHarvest = (world: World) => {
    setWorldToHarvest(world);
    setIsHarvestModalOpen(true);
  };

  const handleReplantWorld = (worldId: string) => {
    const target = worlds.find((w) => w.id === worldId);
    if (!target) return;

    const nowISO = new Date().toISOString();
    const newHarvestISO = calculateHarvestTime(
      nowISO,
      target.durationDays,
      target.durationHours,
      target.durationMinutes
    );

    setWorlds((prev) =>
      prev.map((w) =>
        w.id === worldId
          ? {
              ...w,
              plantedAt: nowISO,
              harvestAt: newHarvestISO,
              harvestCount: (w.harvestCount || 0) + 1,
              lastHarvestedAt: nowISO,
            }
          : w
      )
    );

    setIsHarvestModalOpen(false);
    setWorldToHarvest(null);
  };

  const handleMarkHarvestedOnly = (worldId: string) => {
    const nowISO = new Date().toISOString();
    setWorlds((prev) =>
      prev.map((w) =>
        w.id === worldId
          ? {
              ...w,
              isEmpty: true,
              plantedAt: '',
              harvestAt: '',
              harvestCount: (w.harvestCount || 0) + 1,
              lastHarvestedAt: nowISO,
            }
          : w
      )
    );
    setIsHarvestModalOpen(false);
    setWorldToHarvest(null);
  };

  const handlePlantWorld = (world: World) => {
    setWorldToPlant(world);
    setIsPlantModalOpen(true);
  };

  const handleConfirmPlant = (
    worldId: string,
    updatedCrop?: {
      cropType: string;
      treeCount: number;
      durationDays: number;
      durationHours: number;
      durationMinutes: number;
    }
  ) => {
    const nowISO = new Date().toISOString();
    setWorlds((prev) =>
      prev.map((w) => {
        if (w.id !== worldId) return w;
        const days = updatedCrop?.durationDays ?? w.durationDays;
        const hours = updatedCrop?.durationHours ?? w.durationHours;
        const mins = updatedCrop?.durationMinutes ?? w.durationMinutes;
        const harvestISO = calculateHarvestTime(nowISO, days, hours, mins);
        return {
          ...w,
          cropType: updatedCrop?.cropType ?? w.cropType,
          treeCount: updatedCrop?.treeCount ?? w.treeCount,
          durationDays: days,
          durationHours: hours,
          durationMinutes: mins,
          plantedAt: nowISO,
          harvestAt: harvestISO,
          isEmpty: false,
        };
      })
    );
  };

  // Handlers for Account
  const handleOpenAddAccount = () => {
    setAccountToEdit(null);
    setIsAccountModalOpen(true);
  };

  const handleEditAccount = (acc: GrowAccount) => {
    setAccountToEdit(acc);
    setIsAccountModalOpen(true);
  };

  const handleSaveAccount = (
    accountData: Omit<GrowAccount, 'id' | 'createdAt'> & { id?: string }
  ) => {
    if (accountData.id) {
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === accountData.id
            ? {
                ...a,
                ...accountData,
                id: accountData.id!,
              }
            : a
        )
      );
    } else {
      const newAcc: GrowAccount = {
        ...accountData,
        id: `acc-${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      setAccounts((prev) => [...prev, newAcc]);
    }
  };

  const handleDeleteAccount = (accId: string) => {
    if (accounts.length <= 1) {
      alert('Minimal harus ada 1 akun Growtopia yang tersimpan.');
      return;
    }
    setAccounts((prev) => prev.filter((a) => a.id !== accId));
  };

  // Handlers for Files
  const handleUploadFile = (fileData: Omit<FarmFile, 'id' | 'uploadDate'>) => {
    const newFile: FarmFile = {
      ...fileData,
      id: `file-${Date.now()}`,
      uploadDate: new Date().toISOString(),
    };
    setFiles((prev) => [newFile, ...prev]);
  };

  const handleDeleteFile = (fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  // Handlers for Sales Records
  const handleAddSaleRecord = (record: Omit<FarmSaleRecord, 'id' | 'createdAt'>) => {
    const newRecord: FarmSaleRecord = {
      ...record,
      id: `sale-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date().toISOString(),
    };
    setSalesRecords((prev) => [newRecord, ...prev]);
  };

  const handleDeleteSaleRecord = (saleId: string) => {
    setSalesRecords((prev) => prev.filter((s) => s.id !== saleId));
  };

  // Auth Handlers
  const handleLogin = (newSession: UserSession, serverData?: UserServerData) => {
    setSession(newSession);
    if (serverData) {
      skipNextSync.current = true;
      setWorlds(serverData.worlds);
      setAccounts(serverData.accounts);
      setFiles(serverData.files);
      if (serverData.salesRecords) setSalesRecords(serverData.salesRecords);
      setSoundEnabled(serverData.soundEnabled);
      setServerUpdatedAt(serverData.updatedAt || Date.now());
      setSyncStatus('synced');
    } else {
      setSyncStatus('syncing');
      apiFetchUserData(newSession.username).then((res) => {
        if (res.success && res.data) {
          skipNextSync.current = true;
          setWorlds(res.data.worlds);
          setAccounts(res.data.accounts);
          setFiles(res.data.files);
          if (res.data.salesRecords) setSalesRecords(res.data.salesRecords);
          setSoundEnabled(res.data.soundEnabled);
          setServerUpdatedAt(res.data.updatedAt);
          setSyncStatus('synced');
        }
      });
    }
  };

  const handleLogout = () => {
    setSession({
      isLoggedIn: false,
      username: '',
      growId: '',
      avatarSeed: '',
    });
    try {
      localStorage.removeItem(STORAGE_KEYS.SESSION);
    } catch {
      // ignore
    }
  };

  // If not logged in, render game Login Page
  if (!session.isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col antialiased selection:bg-emerald-500 selection:text-white">
      <div className="flex flex-1 min-h-screen">
        {/* Desktop Sidebar Navigation */}
        <Sidebar
          currentTab={currentTab}
          onTabChange={(tab) => {
            setCurrentTab(tab);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          worlds={worlds}
          accounts={accounts}
          onOpenAddWorld={handleOpenAddWorld}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 pb-20 lg:pb-8">
          {/* Top Header */}
          <Header
            worlds={worlds}
            userSession={session}
            soundEnabled={soundEnabled}
            syncStatus={syncStatus}
            onManualSync={handleManualSync}
            onToggleSound={() => setSoundEnabled(!soundEnabled)}
            onOpenAddWorld={handleOpenAddWorld}
            onSelectWorld={(world) => {
              setWorldToEdit(world);
              setIsWorldModalOpen(true);
            }}
            onHarvestWorld={handleTriggerHarvest}
            onNavigateToWorlds={() => {
              setCurrentTab('worlds');
              setWorldStatusFilter('ready');
            }}
            onLogout={handleLogout}
          />

          {/* Page Routing */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
            {currentTab === 'dashboard' && (
              <DashboardPage
                worlds={worlds}
                accounts={accounts}
                currentTimeMs={currentTimeMs}
                onOpenAddWorld={handleOpenAddWorld}
                onSelectWorld={(world) => {
                  setWorldToEdit(world);
                  setIsWorldModalOpen(true);
                }}
                onHarvestWorld={handleTriggerHarvest}
                onPlantWorld={handlePlantWorld}
                onNavigateToWorlds={(statusFilter) => {
                  if (statusFilter) setWorldStatusFilter(statusFilter);
                  setCurrentTab('worlds');
                }}
                onNavigateToAccounts={() => setCurrentTab('accounts')}
                onNavigateToCalculator={() => setCurrentTab('calculator')}
              />
            )}

            {currentTab === 'worlds' && (
              <WorldsPage
                worlds={worlds}
                accounts={accounts}
                currentTimeMs={currentTimeMs}
                initialFilterStatus={worldStatusFilter}
                onOpenAddWorld={handleOpenAddWorld}
                onEditWorld={handleEditWorld}
                onDeleteWorld={handleDeleteWorld}
                onHarvestWorld={handleTriggerHarvest}
                onPlantWorld={handlePlantWorld}
              />
            )}

            {currentTab === 'calculator' && (
              <CalculatorPage
                salesRecords={salesRecords}
                onAddSaleRecord={handleAddSaleRecord}
                onDeleteSaleRecord={handleDeleteSaleRecord}
                worlds={worlds}
                accounts={accounts}
                onApplyToNewWorld={(cropData) => {
                  const nowISO = new Date().toISOString();
                  const harvestISO = calculateHarvestTime(
                    nowISO,
                    cropData.days,
                    cropData.hours,
                    cropData.minutes
                  );
                  const newWorldObj: World = {
                    id: '',
                    name: `${cropData.cropType.replace(/\s+/g, '').toUpperCase()}_FARM`,
                    cropType: cropData.cropType,
                    treeCount: cropData.treeCount,
                    plantedAt: nowISO,
                    durationDays: cropData.days,
                    durationHours: cropData.hours,
                    durationMinutes: cropData.minutes,
                    harvestAt: harvestISO,
                    accountId: accounts[0]?.id || 'acc-1',
                    notes: 'Dibuat otomatis dari Kalkulator Farm',
                    harvestCount: 0,
                  };
                  setWorldToEdit(newWorldObj);
                  setIsWorldModalOpen(true);
                }}
              />
            )}

            {currentTab === 'accounts' && (
              <AccountsPage
                accounts={accounts}
                worlds={worlds}
                onOpenAddAccount={handleOpenAddAccount}
                onEditAccount={handleEditAccount}
                onDeleteAccount={handleDeleteAccount}
                onViewWorldsForAccount={(accId) => {
                  setCurrentTab('worlds');
                  setWorldStatusFilter('all');
                }}
              />
            )}

            {currentTab === 'files' && (
              <FilesPage
                files={files}
                onOpenUploadModal={() => setIsFileModalOpen(true)}
                onDirectUpload={handleUploadFile}
                onDeleteFile={handleDeleteFile}
              />
            )}
          </main>
        </div>
      </div>

      {/* Mobile Bottom Tab Navigation */}
      <BottomNav
        currentTab={currentTab}
        onTabChange={(tab) => {
          setCurrentTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        worlds={worlds}
      />

      {/* Modals */}
      <WorldModal
        isOpen={isWorldModalOpen}
        worldToEdit={worldToEdit}
        accounts={accounts}
        onClose={() => {
          setIsWorldModalOpen(false);
          setWorldToEdit(null);
        }}
        onSave={handleSaveWorld}
        onHarvestAndReplant={(worldId) => handleReplantWorld(worldId)}
      />

      <AccountModal
        isOpen={isAccountModalOpen}
        accountToEdit={accountToEdit}
        onClose={() => {
          setIsAccountModalOpen(false);
          setAccountToEdit(null);
        }}
        onSave={handleSaveAccount}
      />

      <FileUploadModal
        isOpen={isFileModalOpen}
        onClose={() => setIsFileModalOpen(false)}
        onUpload={handleUploadFile}
      />

      <HarvestModal
        world={worldToHarvest}
        isOpen={isHarvestModalOpen}
        soundEnabled={soundEnabled}
        onClose={() => {
          setIsHarvestModalOpen(false);
          setWorldToHarvest(null);
        }}
        onReplant={(worldId) => handleReplantWorld(worldId)}
        onMarkHarvestedOnly={(worldId) => handleMarkHarvestedOnly(worldId)}
      />

      <QuickPlantModal
        world={worldToPlant}
        isOpen={isPlantModalOpen}
        soundEnabled={soundEnabled}
        onClose={() => {
          setIsPlantModalOpen(false);
          setWorldToPlant(null);
        }}
        onConfirmPlant={handleConfirmPlant}
      />
    </div>
  );
}
