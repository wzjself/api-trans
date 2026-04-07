import { format } from "date-fns";

// 模拟数据结构
export interface LocalUser {
  uid: string;
  email: string;
  password?: string;
  role: "admin" | "user";
  balance: number;
  quotaType: "none" | "daily" | "monthly";
  dailyQuota: number;
  createdAt: string;
}

export interface LocalApiKey {
  id: string;
  uid: string;
  name: string;
  key: string;
  status: "active" | "revoked";
  createdAt: any;
}

export interface LocalUsageLog {
  id: string;
  uid: string;
  tokens: number;
  model: string;
  timestamp: any;
}

export interface LocalRedemptionCode {
  code: string;
  type: "permanent" | "daily" | "monthly";
  value: number;
  durationDays: number;
  isUsed: boolean;
  createdAt: any;
}

// 本地存储封装
const STORAGE_KEYS = {
  USERS: "wzjself_users",
  KEYS: "wzjself_keys",
  LOGS: "wzjself_logs",
  CODES: "wzjself_codes",
  CURRENT_USER: "wzjself_current_user",
  SETTINGS: "wzjself_settings",
};

const get = (key: string) => JSON.parse(localStorage.getItem(key) || "[]");
const set = (key: string, data: any) => localStorage.setItem(key, JSON.stringify(data));

export const storageService = {
  // 初始化默认数据 (例如默认管理员)
  init: () => {
    const users = get(STORAGE_KEYS.USERS);
    if (users.length === 0) {
      // 预设一个管理员账号: admin@wzjself.com / 123456
      users.push({
        uid: "admin-123",
        email: "admin@wzjself.com",
        password: "123456",
        role: "admin",
        balance: 1000000,
        quotaType: "none",
        dailyQuota: 0,
        createdAt: new Date().toISOString(),
      });
      set(STORAGE_KEYS.USERS, users);
    }
    
    const codes = get(STORAGE_KEYS.CODES);
    if (codes.length === 0) {
      codes.push({
        code: "WELCOME666",
        type: "permanent",
        value: 50000,
        durationDays: 0,
        isUsed: false,
        createdAt: new Date().toISOString(),
      });
      set(STORAGE_KEYS.CODES, codes);
    }

    if (!localStorage.getItem(STORAGE_KEYS.SETTINGS)) {
      set(STORAGE_KEYS.SETTINGS, { guideLink: "https://docs.wzjself.site" });
    }
  },

  // Settings
  getSettings: () => {
    const settings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return settings ? JSON.parse(settings) : { guideLink: "" };
  },
  updateSettings: (settings: any) => {
    const current = storageService.getSettings();
    set(STORAGE_KEYS.SETTINGS, { ...current, ...settings });
  },

  // Auth 逻辑
  login: (email: string, pass: string) => {
    const users = get(STORAGE_KEYS.USERS);
    const user = users.find((u: any) => u.email === email && u.password === pass);
    if (user) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
      return user;
    }
    throw new Error("邮箱或密码错误");
  },

  register: (email: string, pass: string) => {
    const users = get(STORAGE_KEYS.USERS);
    if (users.find((u: any) => u.email === email)) throw new Error("邮箱已被注册");
    
    const newUser: LocalUser = {
      uid: Math.random().toString(36).substr(2, 9),
      email,
      password: pass,
      role: email === "wzjself@gmail.com" ? "admin" : "user", // 保持您的管理员权限
      balance: 0,
      quotaType: "none",
      dailyQuota: 0,
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    set(STORAGE_KEYS.USERS, users);
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(newUser));
    return newUser;
  },

  logout: () => localStorage.removeItem(STORAGE_KEYS.CURRENT_USER),

  getCurrentUser: () => JSON.parse(localStorage.getItem(STORAGE_KEYS.CURRENT_USER) || "null"),

  // 数据操作
  getApiKeys: (uid: string) => get(STORAGE_KEYS.KEYS).filter((k: any) => k.uid === uid),
  addApiKey: (uid: string, name: string) => {
    const keys = get(STORAGE_KEYS.KEYS);
    const newKey = {
      id: Math.random().toString(36).substr(2, 9),
      uid,
      name,
      key: `sk-${Math.random().toString(36).substr(2, 32)}`,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    keys.push(newKey);
    set(STORAGE_KEYS.KEYS, keys);
    return newKey;
  },
  revokeKey: (id: string) => {
    const keys = get(STORAGE_KEYS.KEYS);
    const index = keys.findIndex((k: any) => k.id === id);
    if (index > -1) {
      keys[index].status = "revoked";
      set(STORAGE_KEYS.KEYS, keys);
    }
  },

  getLogs: (uid: string) => get(STORAGE_KEYS.LOGS).filter((l: any) => l.uid === uid),
  addLog: (uid: string, tokens: number, model: string) => {
    const logs = get(STORAGE_KEYS.LOGS);
    const newLog = {
      id: Math.random().toString(36).substr(2, 9),
      uid,
      tokens,
      model,
      timestamp: new Date().toISOString(),
    };
    logs.push(newLog);
    set(STORAGE_KEYS.LOGS, logs);

    // Deduct balance if using permanent quota
    const users = get(STORAGE_KEYS.USERS);
    const userIdx = users.findIndex((u: any) => u.uid === uid);
    if (userIdx > -1) {
      const u = users[userIdx];
      if (!u.quotaType || u.quotaType === "none" || u.quotaType === "permanent") {
        u.balance = Math.max(0, (u.balance || 0) - tokens);
        set(STORAGE_KEYS.USERS, users);
        const currentUser = storageService.getCurrentUser();
        if (currentUser && currentUser.uid === uid) {
          localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(u));
        }
      }
    }
    return newLog;
  },

  getRedemptionCodes: () => get(STORAGE_KEYS.CODES),
  addCode: (codeData: any) => {
    const codes = get(STORAGE_KEYS.CODES);
    codes.push({ ...codeData, isUsed: false, createdAt: new Date().toISOString() });
    set(STORAGE_KEYS.CODES, codes);
  },
  deleteCode: (code: string) => {
    const codes = get(STORAGE_KEYS.CODES);
    const filtered = codes.filter((c: any) => c.code !== code);
    set(STORAGE_KEYS.CODES, filtered);
  },
  useCode: (code: string, uid: string) => {
    const codes = get(STORAGE_KEYS.CODES);
    const users = get(STORAGE_KEYS.USERS);
    const codeIdx = codes.findIndex((c: any) => c.code === code && !c.isUsed);
    const userIdx = users.findIndex((u: any) => u.uid === uid);

    if (codeIdx === -1) throw new Error("无效或已使用的兑换码");
    if (userIdx === -1) throw new Error("用户不存在");

    const c = codes[codeIdx];
    const u = users[userIdx];

    if (c.type === "permanent") {
      u.balance = (u.balance || 0) + c.value;
    } else {
      u.quotaType = c.type;
      u.dailyQuota = c.value;
      const now = new Date();
      u.quotaExpiresAt = new Date(now.getTime() + (c.durationDays || 30) * 24 * 60 * 60 * 1000).toISOString();
    }

    c.isUsed = true;
    set(STORAGE_KEYS.CODES, codes);
    set(STORAGE_KEYS.USERS, users);
    
    // 更新当前登录状态
    const currentUser = storageService.getCurrentUser();
    if (currentUser && currentUser.uid === uid) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(u));
    }
    return u;
  },

  getAllUsers: () => get(STORAGE_KEYS.USERS),
  updateUserBalance: (uid: string, balance: number) => {
    const users = get(STORAGE_KEYS.USERS);
    const idx = users.findIndex((u: any) => u.uid === uid);
    if (idx > -1) {
      users[idx].balance = balance;
      set(STORAGE_KEYS.USERS, users);
      
      const currentUser = storageService.getCurrentUser();
      if (currentUser && currentUser.uid === uid) {
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(users[idx]));
      }
    }
  }
};
