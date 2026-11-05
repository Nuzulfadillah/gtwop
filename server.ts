import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { INITIAL_WORLDS, INITIAL_ACCOUNTS, INITIAL_FILES, INITIAL_SALES_RECORDS } from './src/data/presets';
import { World, GrowAccount, FarmFile, FarmSaleRecord } from './src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// High limit for base64 file sync
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Persistent Database File Storage
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'farm_database.json');

interface UserData {
  username: string;
  growId: string;
  password?: string;
  avatarSeed: string;
  updatedAt: number;
  worlds: World[];
  accounts: GrowAccount[];
  files: FarmFile[];
  salesRecords?: FarmSaleRecord[];
  soundEnabled: boolean;
}

interface DatabaseSchema {
  users: Record<string, UserData>;
}

function loadDatabase(): DatabaseSchema {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.users === 'object') {
        // Ensure salesRecords array exists on users
        for (const k in parsed.users) {
          if (!Array.isArray(parsed.users[k].salesRecords)) {
            parsed.users[k].salesRecords = k === 'nuzulfarmer' ? INITIAL_SALES_RECORDS : [];
          }
        }
        return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to read database file, initializing default:', err);
  }

  // Initial seed with NuzulFarmer
  const defaultDb: DatabaseSchema = {
    users: {
      nuzulfarmer: {
        username: 'NuzulFarmer',
        growId: 'NuzulFarmer',
        password: '',
        avatarSeed: 'nuzulfarmer',
        updatedAt: Date.now(),
        worlds: INITIAL_WORLDS,
        accounts: INITIAL_ACCOUNTS,
        files: INITIAL_FILES,
        salesRecords: INITIAL_SALES_RECORDS,
        soundEnabled: true,
      },
    },
  };
  saveDatabase(defaultDb);
  return defaultDb;
}

function saveDatabase(data: DatabaseSchema) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save database file:', err);
  }
}

// In-memory cache synced with disk
let dbState = loadDatabase();

// API ROUTES
// 1. Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    usersCount: Object.keys(dbState.users).length,
  });
});

// 2. Auth: Login or Auto-Register
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { username, password, isQuickDemo } = req.body;
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username atau GrowID wajib diisi' });
  }

  const cleanName = username.trim();
  const userKey = cleanName.toLowerCase();

  // Reload latest from disk in case updated by other process
  dbState = loadDatabase();

  let user = dbState.users[userKey];

  if (!user) {
    // Auto register new user
    user = {
      username: cleanName,
      growId: cleanName,
      password: password || '',
      avatarSeed: userKey,
      updatedAt: Date.now(),
      // If it's NuzulFarmer or demo, give sample data, otherwise start with a clean farm + starter account
      worlds: userKey === 'nuzulfarmer' ? INITIAL_WORLDS : [],
      accounts:
        userKey === 'nuzulfarmer'
          ? INITIAL_ACCOUNTS
          : [
              {
                id: `acc-${Date.now()}`,
                growId: cleanName,
                label: 'Akun Utama',
                notes: 'Akun Growtopia utama',
                level: 1,
                createdAt: new Date().toISOString(),
              },
            ],
      files: userKey === 'nuzulfarmer' ? INITIAL_FILES : [],
      salesRecords: userKey === 'nuzulfarmer' ? INITIAL_SALES_RECORDS : [],
      soundEnabled: true,
    };
    dbState.users[userKey] = user;
    saveDatabase(dbState);
  } else {
    // If user already exists: verify password if password was set and not quick demo
    if (user.password && user.password !== '' && !isQuickDemo) {
      if (password && password !== user.password) {
        return res.status(401).json({
          error: 'Sandi atau PIN salah untuk GrowID ini.',
        });
      }
    } else if (password && (!user.password || user.password === '')) {
      // Set password if not previously set
      user.password = password;
      saveDatabase(dbState);
    }
  }

  return res.json({
    success: true,
    user: {
      username: user.username,
      growId: user.growId,
      avatarSeed: user.avatarSeed,
    },
    data: {
      worlds: user.worlds,
      accounts: user.accounts,
      files: user.files,
      salesRecords: user.salesRecords || [],
      soundEnabled: user.soundEnabled,
      updatedAt: user.updatedAt,
    },
  });
});

// 3. Get user latest data (for polling & multi-device sync)
app.get('/api/user/data', (req: Request, res: Response) => {
  const username = req.query.username as string;
  if (!username) {
    return res.status(400).json({ error: 'Parameter username diperlukan' });
  }

  const userKey = username.trim().toLowerCase();
  dbState = loadDatabase();
  const user = dbState.users[userKey];

  if (!user) {
    return res.status(404).json({ error: 'Akun tidak ditemukan di server' });
  }

  return res.json({
    success: true,
    updatedAt: user.updatedAt,
    worlds: user.worlds,
    accounts: user.accounts,
    files: user.files,
    salesRecords: user.salesRecords || [],
    soundEnabled: user.soundEnabled,
  });
});

// 4. Sync client changes to server
app.post('/api/user/sync', (req: Request, res: Response) => {
  const { username, worlds, accounts, files, salesRecords, soundEnabled, clientUpdatedAt } =
    req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username wajib disertakan' });
  }

  const userKey = username.trim().toLowerCase();
  dbState = loadDatabase();
  let user = dbState.users[userKey];

  if (!user) {
    user = {
      username: username.trim(),
      growId: username.trim(),
      avatarSeed: userKey,
      updatedAt: Date.now(),
      worlds: Array.isArray(worlds) ? worlds : [],
      accounts: Array.isArray(accounts) ? accounts : [],
      files: Array.isArray(files) ? files : [],
      salesRecords: Array.isArray(salesRecords) ? salesRecords : [],
      soundEnabled: soundEnabled !== undefined ? soundEnabled : true,
    };
    dbState.users[userKey] = user;
  } else {
    // Update user state
    if (Array.isArray(worlds)) user.worlds = worlds;
    if (Array.isArray(accounts)) user.accounts = accounts;
    if (Array.isArray(files)) user.files = files;
    if (Array.isArray(salesRecords)) user.salesRecords = salesRecords;
    if (soundEnabled !== undefined) user.soundEnabled = soundEnabled;
    user.updatedAt = Date.now();
  }

  saveDatabase(dbState);

  return res.json({
    success: true,
    updatedAt: user.updatedAt,
  });
});

// 5. Reset user data to initial presets (optional helper)
app.post('/api/user/reset', (req: Request, res: Response) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username diperlukan' });
  }

  const userKey = username.trim().toLowerCase();
  dbState = loadDatabase();
  if (dbState.users[userKey]) {
    dbState.users[userKey].worlds = INITIAL_WORLDS;
    dbState.users[userKey].accounts = INITIAL_ACCOUNTS;
    dbState.users[userKey].files = INITIAL_FILES;
    dbState.users[userKey].updatedAt = Date.now();
    saveDatabase(dbState);

    return res.json({
      success: true,
      message: 'Data berhasil direset ke demo default',
      data: dbState.users[userKey],
    });
  }

  return res.status(404).json({ error: 'User tidak ditemukan' });
});

// Mount Vite in development or serve static in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    } else {
      console.warn('dist directory does not exist, run npm run build first');
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Growtopia Farm Manager Server running on port ${PORT}`);
  });
}

startServer();
