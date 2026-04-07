import React, { useState, useEffect } from "react";
import { dataService } from "../services/dataService";
import { Users, Key, Plus, Trash2, Shield, User as UserIcon, Check, Copy, Settings } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../lib/utils";

interface RedemptionCode {
  code: string;
  type: "permanent" | "daily" | "monthly";
  value: number;
  durationDays: number;
  isUsed: boolean;
  createdAt: any;
}

interface UserProfile {
  uid: string;
  email: string;
  role: "admin" | "user";
  balance: number;
}

export const AdminPanel: React.FC = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [codes, setCodes] = useState<RedemptionCode[]>([]);
  const [newCode, setNewCode] = useState({ type: "permanent", value: 1000, durationDays: 30 });
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [newBalance, setNewBalance] = useState(0);

  const [settings, setSettings] = useState({ guideLink: "" });
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  useEffect(() => {
    const unsubUsers = dataService.subscribeAllUsers((data) => {
      setUsers(data as UserProfile[]);
    });

    const unsubCodes = dataService.subscribeAllCodes((data) => {
      setCodes(data as RedemptionCode[]);
    });

    const unsubSettings = dataService.subscribeSettings((data) => {
      setSettings(data || { guideLink: "" });
    });

    return () => {
      unsubUsers();
      unsubCodes();
      unsubSettings();
    };
  }, []);

  const saveSettings = async () => {
    setIsSavingSettings(true);
    try {
      await dataService.updateSettings(settings);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const generateCode = async () => {
    setIsGenerating(true);
    try {
      const code = `NX-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      await dataService.addCode({
        code,
        type: newCode.type,
        value: newCode.value,
        durationDays: newCode.durationDays,
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteCode = async (code: string) => {
    try {
      await dataService.deleteCode(code);
    } catch (error) {
      console.error(error);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const updateUserBalance = async () => {
    if (!editingUser) return;
    try {
      await dataService.updateUserBalance(editingUser.uid, newBalance);
      setEditingUser(null);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="space-y-12 pb-20">
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Settings className="w-5 h-5 text-zinc-500" />
          <h2>系统设置</h2>
        </div>
        <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">使用指南链接</label>
            <input
              type="url"
              className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all"
              value={settings.guideLink}
              onChange={(e) => setSettings({ ...settings, guideLink: e.target.value })}
              placeholder="https://..."
            />
          </div>
          <button
            onClick={saveSettings}
            disabled={isSavingSettings}
            className="px-6 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl hover:opacity-90 disabled:opacity-50 transition-all"
          >
            保存设置
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Key className="w-5 h-5 text-zinc-500" />
          <h2>兑换码管理</h2>
        </div>
        
        <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 flex flex-wrap gap-4 items-end">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">类型</label>
            <select
              className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all"
              value={newCode.type}
              onChange={(e) => setNewCode({ ...newCode, type: e.target.value as any })}
            >
              <option value="permanent">额度直冲 (永久)</option>
              <option value="daily">天卡 (每日额度)</option>
              <option value="monthly">月卡 (每日额度)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              {newCode.type === "permanent" ? "额度 (Tokens)" : "每日额度 (Tokens)"}
            </label>
            <input
              type="number"
              className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all"
              value={newCode.value}
              onChange={(e) => setNewCode({ ...newCode, value: parseInt(e.target.value) })}
            />
          </div>
          {newCode.type !== "permanent" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">持续天数</label>
              <input
                type="number"
                className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all"
                value={newCode.durationDays}
                onChange={(e) => setNewCode({ ...newCode, durationDays: parseInt(e.target.value) })}
              />
            </div>
          )}
          <button
            onClick={generateCode}
            disabled={isGenerating}
            className="px-6 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            生成兑换码
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {codes.map((code) => (
              <motion.div
                key={code.code}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn(
                  "p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 flex items-center justify-between group",
                  code.isUsed && "opacity-50"
                )}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm">{code.code}</span>
                    {code.isUsed && (
                      <span className="px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        已使用
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
                    {code.type === "permanent" ? "永久额度" : code.type === "daily" ? "天卡" : "月卡"} • {code.value.toLocaleString()} Tokens
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => copyCode(code.code)}
                    className="p-1.5 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                  >
                    {copiedCode === code.code ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => deleteCode(code.code)}
                    className="p-1.5 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Users className="w-5 h-5 text-zinc-500" />
          <h2>用户管理</h2>
        </div>
        <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                <th className="px-6 py-3 font-medium text-zinc-500">用户</th>
                <th className="px-6 py-3 font-medium text-zinc-500">角色</th>
                <th className="px-6 py-3 font-medium text-zinc-500">余额</th>
                <th className="px-6 py-3 font-medium text-zinc-500 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {users.map((user) => (
                <tr key={user.uid} className="group hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                        <UserIcon className="w-4 h-4 text-zinc-500" />
                      </div>
                      <div className="font-medium">{user.email}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      {user.role === "admin" ? (
                        <Shield className="w-3.5 h-3.5 text-amber-500" />
                      ) : (
                        <UserIcon className="w-3.5 h-3.5 text-zinc-400" />
                      )}
                      <span className={cn(
                        "capitalize",
                        user.role === "admin" ? "text-amber-600 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-400"
                      )}>
                        {user.role}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs">
                    {user.balance.toLocaleString()} Tokens
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => {
                        setEditingUser(user);
                        setNewBalance(user.balance);
                      }}
                      className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                    >
                      编辑余额
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {editingUser && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl space-y-6"
            >
              <div className="space-y-2">
                <h3 className="text-xl font-bold tracking-tight">编辑用户余额</h3>
                <p className="text-sm text-zinc-500">修改 {editingUser.email} 的永久额度。</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">当前余额: {editingUser.balance.toLocaleString()}</label>
                <input
                  type="number"
                  className="w-full px-4 py-3 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all font-mono"
                  value={newBalance}
                  onChange={(e) => setNewBalance(parseInt(e.target.value))}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setEditingUser(null)}
                  className="flex-1 py-3 text-sm font-medium rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all"
                >
                  取消
                </button>
                <button
                  onClick={updateUserBalance}
                  className="flex-1 py-3 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl hover:opacity-90 transition-all"
                >
                  保存修改
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
