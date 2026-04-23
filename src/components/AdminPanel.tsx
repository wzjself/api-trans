import React, { useEffect, useMemo, useState } from "react";
import { dataService } from "../services/dataService";
import {
  Users,
  Key,
  Trash2,
  Shield,
  User as UserIcon,
  Check,
  Copy,
  Settings,
  Database,
  Save,
  RefreshCw,
  AlertTriangle,
  Download,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import { cn } from "../lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface RedemptionCode {
  code: string;
  type: "permanent" | "daily" | "monthly";
  value: number;
  durationDays: number;
  isUsed: boolean;
  createdAt: any;
  usedBy?: string | null;
}

interface UserProfile {
  uid: string;
  email: string;
  role: "admin" | "user";
  balance: number;
  quotaType?: string;
  dailyQuota?: number;
  quotaExpiresAt?: any;
  totalUsedTokens?: number;
  usedToday?: number;
  apiKeyCount?: number;
  createdAt?: any;
}

const USER_FILTERS = [
  { key: "all", label: "全部用户" },
  { key: "daily", label: "日卡用户" },
  { key: "monthly", label: "月卡用户" },
  { key: "permanent", label: "永久额度用户" },
  { key: "none", label: "无卡用户" },
] as const;

interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  models: string[];
}

interface ImageProviderConfig extends ProviderConfig {
  pricePerImage: number;
}

export const AdminPanel: React.FC = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [codes, setCodes] = useState<RedemptionCode[]>([]);
  const [newCode, setNewCode] = useState({ type: "permanent", value: 1000, durationDays: 0, count: 1 });
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<UserProfile | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [newBalance, setNewBalance] = useState(0);
  const [settings, setSettings] = useState({ guideLink: "", announcement: "", announcementPopupEnabled: false, announcementPopupVersion: "" });
  const [isSavingGuideLink, setIsSavingGuideLink] = useState(false);
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);

  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [providerForm, setProviderForm] = useState<ProviderConfig>({ id: "", name: "", baseUrl: "", apiKey: "", enabled: true, models: [] });
  const [providerModelsInput, setProviderModelsInput] = useState("");
  const [isSavingProvider, setIsSavingProvider] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const [imageProviders, setImageProviders] = useState<ImageProviderConfig[]>([]);
  const [activeImageProviderId, setActiveImageProviderId] = useState("");
  const [defaultImageModel, setDefaultImageModel] = useState("");
  const [imageProviderForm, setImageProviderForm] = useState<ImageProviderConfig>({
    id: "",
    name: "",
    baseUrl: "",
    apiKey: "",
    enabled: true,
    models: [],
    pricePerImage: 1000,
  });
  const [imageProviderModelsInput, setImageProviderModelsInput] = useState("");
  const [isSavingImageProvider, setIsSavingImageProvider] = useState(false);
  const [isFetchingImageModels, setIsFetchingImageModels] = useState(false);

  const [platformSummary, setPlatformSummary] = useState({
    totalUsers: 0,
    totalApiKeys: 0,
    totalRequests: 0,
    totalTokens: 0,
    todayTokens: 0,
    rpm: 0,
    tpm: 0,
  });
  const [platformTrend, setPlatformTrend] = useState<any[]>([]);
  const [expandedCodes, setExpandedCodes] = useState<Record<string, boolean>>({});
  const [lastGeneratedCodes, setLastGeneratedCodes] = useState<string[]>([]);
  const [userFilter, setUserFilter] = useState<(typeof USER_FILTERS)[number]["key"]>("all");

  const shouldCollapseCode = (code: string) => code.length > 18;
  const formatCodePreview = (code: string) => (shouldCollapseCode(code) ? `${code.slice(0, 10)}...${code.slice(-6)}` : code);
  const toggleCodeExpanded = (code: string) => setExpandedCodes((prev) => ({ ...prev, [code]: !prev[code] }));
  const generatedCodesText = useMemo(() => lastGeneratedCodes.join("\n"), [lastGeneratedCodes]);
  const allCodesText = useMemo(() => codes.map((item) => item.code).join("\n"), [codes]);
  const hasCollapsibleCodes = useMemo(() => codes.some((item) => shouldCollapseCode(item.code)), [codes]);
  const areAllCollapsibleCodesExpanded = useMemo(() => {
    const collapsibleCodes = codes.filter((item) => shouldCollapseCode(item.code));
    return collapsibleCodes.length > 0 && collapsibleCodes.every((item) => expandedCodes[item.code]);
  }, [codes, expandedCodes]);

  const formatTokensInMillions = (value: number) => {
    const millions = Number(value || 0) / 1_000_000;
    if (millions >= 100) return `${millions.toFixed(0)} M`;
    if (millions >= 10) return `${millions.toFixed(1)} M`;
    return `${millions.toFixed(2)} M`;
  };

  const safeCopy = async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}

    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  };

  const loadAdminData = () => {
    const quotaType = userFilter === "all" ? "" : userFilter;
    const unsubUsers = dataService.subscribeAllUsers((data) => setUsers(data as UserProfile[]), quotaType);
    const unsubCodes = dataService.subscribeAllCodes((data) => setCodes(data as RedemptionCode[]));
    const unsubSettings = dataService.subscribeSettings((data) => setSettings(data || { guideLink: "", announcement: "", announcementPopupEnabled: false, announcementPopupVersion: "" }));
    const unsubProviders = dataService.subscribeProviders((data) => {
      setProviders(data.providers || []);
      setDefaultModel(data.defaultModel || "");
    });
    const unsubImageProviders = dataService.subscribeImageProviders((data) => {
      setImageProviders(data.providers || []);
      setActiveImageProviderId(data.activeImageProviderId || "");
      setDefaultImageModel(data.defaultImageModel || "");
    });
    const unsubPlatformSummary = dataService.subscribePlatformSummary((data) => {
      setPlatformSummary(data || { totalUsers: 0, totalApiKeys: 0, totalRequests: 0, totalTokens: 0, todayTokens: 0, rpm: 0, tpm: 0 });
    });
    const unsubPlatformTrend = dataService.subscribePlatformTrend((data) => {
      setPlatformTrend(data || []);
    });
    return () => {
      unsubUsers();
      unsubCodes();
      unsubSettings();
      unsubProviders();
      unsubImageProviders();
      unsubPlatformSummary();
      unsubPlatformTrend();
    };
  };

  useEffect(() => loadAdminData(), [userFilter]);

  useEffect(() => {
    setNewCode((prev) => {
      if (prev.type === "permanent") return { ...prev, value: prev.value || 1000, durationDays: 0 };
      if (prev.type === "daily") return { ...prev, value: 150000000, durationDays: 1 };
      return { ...prev, value: 150000000, durationDays: 30 };
    });
  }, [newCode.type]);

  const saveGuideLink = async () => {
    setIsSavingGuideLink(true);
    try {
      await dataService.updateSettings({ guideLink: settings.guideLink });
    } finally {
      setIsSavingGuideLink(false);
    }
  };

  const saveAnnouncement = async () => {
    setIsSavingAnnouncement(true);
    try {
      await dataService.updateSettings({
        announcement: settings.announcement,
        announcementPopupEnabled: !!settings.announcementPopupEnabled,
        announcementPopupVersion: String(settings.announcementPopupVersion || "").trim(),
      });
    } finally {
      setIsSavingAnnouncement(false);
    }
  };

  const generateCode = async () => {
    setIsGenerating(true);
    try {
      const request = {
        type: newCode.type,
        value: newCode.value,
        durationDays: newCode.type === "permanent" ? 0 : newCode.durationDays,
        count: newCode.count,
      };
      const created = await dataService.addCode(request);
      const items = Array.isArray(created?.items) ? created.items : [created];
      const normalized = items.map((item: any) => ({
        code: item.code,
        type: item.type,
        value: Number(item.value),
        durationDays: Number(item.durationDays),
        isUsed: Boolean(item.isUsed),
        createdAt: item.createdAt || new Date().toISOString(),
        usedBy: item.usedBy || null,
      }));
      setCodes((prev) => [...normalized, ...prev.filter((item) => !normalized.some((n: any) => n.code === item.code))]);
      setLastGeneratedCodes(normalized.map((item: any) => item.code));
      if (normalized.length === 1) {
        const copied = await safeCopy(normalized[0].code);
        setCopiedCode(copied ? normalized[0].code : null);
        setTimeout(() => setCopiedCode(null), 2000);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteCode = async (code: string) => {
    await dataService.deleteCode(code);
    setCodes((prev) => prev.filter((item) => item.code !== code));
  };

  const copyCode = async (code: string) => {
    const copied = await safeCopy(code);
    if (!copied) return;
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const exportGeneratedCodes = () => {
    const sourceCodes = lastGeneratedCodes.length ? generatedCodesText : allCodesText;
    if (!sourceCodes) return;
    const blob = new Blob([sourceCodes], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `redeem-codes-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const toggleExpandAllCodes = () => {
    const collapsibleCodes = codes.filter((item) => shouldCollapseCode(item.code));
    if (!collapsibleCodes.length) return;
    const nextExpanded = !areAllCollapsibleCodesExpanded;
    setExpandedCodes((prev) => {
      const next = { ...prev };
      for (const item of collapsibleCodes) {
        next[item.code] = nextExpanded;
      }
      return next;
    });
  };

  const updateUserBalance = async () => {
    if (!editingUser) return;
    await dataService.updateUserBalance(editingUser.uid, newBalance);
    setEditingUser(null);
    loadAdminData();
  };

  const confirmDeleteUser = async () => {
    if (!pendingDeleteUser) return;
    setIsDeletingUser(true);
    try {
      await dataService.deleteUser(pendingDeleteUser.uid);
      setUsers((prev) => prev.filter((item) => item.uid !== pendingDeleteUser.uid));
      setPendingDeleteUser(null);
    } catch (error) {
      console.error(error);
    } finally {
      setIsDeletingUser(false);
    }
  };

  const saveProvider = async () => {
    setIsSavingProvider(true);
    try {
      await dataService.saveProvider({
        ...providerForm,
        models: providerModelsInput.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
      });
      setProviderForm({ id: "", name: "", baseUrl: "", apiKey: "", enabled: true, models: [] });
      setProviderModelsInput("");
      loadAdminData();
    } finally {
      setIsSavingProvider(false);
    }
  };

  const fetchProviderModels = async () => {
    if (!providerForm.baseUrl.trim()) return;
    setIsFetchingModels(true);
    try {
      const result = await dataService.fetchProviderModels(providerForm.baseUrl.trim(), providerForm.apiKey.trim());
      if (Array.isArray(result.models) && result.models.length > 0) {
        setProviderModelsInput(result.models.join("\n"));
      }
    } finally {
      setIsFetchingModels(false);
    }
  };

  const saveDefaultModel = async () => {
    await dataService.saveDefaultModel(defaultModel);
    loadAdminData();
  };

  const toggleProviderEnabled = async (id: string, enabled: boolean) => {
    await dataService.setProviderEnabled(id, enabled);
    setProviders((prev) => prev.map((p) => p.id === id ? { ...p, enabled } : p));
  };

  const removeProvider = async (id: string) => {
    await dataService.deleteProvider(id);
    loadAdminData();
  };

  const saveImageProvider = async () => {
    setIsSavingImageProvider(true);
    try {
      await dataService.saveImageProvider({
        ...imageProviderForm,
        models: imageProviderModelsInput.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
      });
      setImageProviderForm({ id: "", name: "", baseUrl: "", apiKey: "", enabled: true, models: [], pricePerImage: 1000 });
      setImageProviderModelsInput("");
      loadAdminData();
    } finally {
      setIsSavingImageProvider(false);
    }
  };

  const fetchImageProviderModels = async () => {
    if (!imageProviderForm.baseUrl.trim()) return;
    setIsFetchingImageModels(true);
    try {
      const result = await dataService.fetchImageProviderModels(imageProviderForm.baseUrl.trim(), imageProviderForm.apiKey.trim());
      if (Array.isArray(result.models) && result.models.length > 0) {
        setImageProviderModelsInput(result.models.join("\n"));
      }
    } finally {
      setIsFetchingImageModels(false);
    }
  };

  const saveDefaultImageModel = async () => {
    await dataService.saveDefaultImageModel(defaultImageModel);
    loadAdminData();
  };

  const selectActiveImageProvider = async (id: string) => {
    setActiveImageProviderId(id);
    await dataService.setActiveImageProvider(id);
    loadAdminData();
  };

  const toggleImageProviderEnabled = async (id: string, enabled: boolean) => {
    await dataService.setImageProviderEnabled(id, enabled);
    setImageProviders((prev) => prev.map((p) => p.id === id ? { ...p, enabled } : p));
  };

  const removeImageProvider = async (id: string) => {
    await dataService.deleteImageProvider(id);
    loadAdminData();
  };

  return (
    <div className="space-y-12 pb-20">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-4">
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
          <div className="text-xs text-zinc-500">平台总用户</div>
          <div className="text-2xl font-bold tracking-tight">{platformSummary.totalUsers.toLocaleString()}</div>
        </div>
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
          <div className="text-xs text-zinc-500">活跃密钥</div>
          <div className="text-2xl font-bold tracking-tight">{platformSummary.totalApiKeys.toLocaleString()}</div>
        </div>
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
          <div className="text-xs text-zinc-500">总请求数</div>
          <div className="text-2xl font-bold tracking-tight">{platformSummary.totalRequests.toLocaleString()}</div>
        </div>
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
          <div className="text-xs text-zinc-500">平台总消耗</div>
          <div className="text-2xl font-bold tracking-tight">{formatTokensInMillions(platformSummary.totalTokens)}</div>
          <div className="text-[10px] text-zinc-400 mt-1">单位：M</div>
        </div>
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
          <div className="text-xs text-zinc-500">今日消耗</div>
          <div className="text-2xl font-bold tracking-tight">{formatTokensInMillions(platformSummary.todayTokens)}</div>
          <div className="text-[10px] text-zinc-400 mt-1">单位：M</div>
        </div>
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
          <div className="text-xs text-zinc-500">实时 RPM</div>
          <div className="text-2xl font-bold tracking-tight">{Number(platformSummary.rpm || 0).toLocaleString()}</div>
          <div className="text-[10px] text-zinc-400 mt-1">最近 1 分钟请求数</div>
        </div>
        <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
          <div className="text-xs text-zinc-500">实时 TPM</div>
          <div className="text-2xl font-bold tracking-tight">{Number(platformSummary.tpm || 0).toLocaleString()}</div>
          <div className="text-[10px] text-zinc-400 mt-1">最近 1 分钟 Token</div>
        </div>
      </div>

      <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold tracking-tight">平台请求与消耗趋势</h3>
          <div className="text-xs text-zinc-500">最近 14 天</div>
        </div>
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={platformTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" className="dark:stroke-zinc-800" />
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#888" }} dy={10} />
              <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#888" }} />
              <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#888" }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="requests" name="请求数" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="right" dataKey="tokens" name="Token 消耗" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

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
              className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
              value={settings.guideLink}
              onChange={(e) => setSettings({ ...settings, guideLink: e.target.value })}
              placeholder="https://..."
            />
            <button onClick={saveGuideLink} disabled={isSavingGuideLink} className="px-6 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl">
              {isSavingGuideLink ? "保存中..." : "单独保存指南链接"}
            </button>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">公告内容</label>
            <textarea
              className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 min-h-[120px]"
              value={settings.announcement}
              onChange={(e) => setSettings({ ...settings, announcement: e.target.value })}
              placeholder="这里填写用户页展示的公告内容"
            />
            <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
              <label className="text-sm text-zinc-600 dark:text-zinc-300 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!settings.announcementPopupEnabled}
                  onChange={(e) => setSettings({ ...settings, announcementPopupEnabled: e.target.checked })}
                />
                登录后弹出公告 UI
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
                value={settings.announcementPopupVersion || ""}
                onChange={(e) => setSettings({ ...settings, announcementPopupVersion: e.target.value })}
                placeholder="公告版本号（可选，不填默认跟随公告内容）"
              />
              <div className="text-xs text-zinc-500">用户弹窗默认勾选“不再弹出”；同一版本公告用户只会确认一次。</div>
            </div>
            <button onClick={saveAnnouncement} disabled={isSavingAnnouncement} className="px-6 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl">
              {isSavingAnnouncement ? "保存中..." : "保存公告与弹窗设置"}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Database className="w-5 h-5 text-zinc-500" />
          <h2>上游渠道 / 模型管理</h2>
        </div>
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-4">
            <div className="grid gap-3">
              <input className="px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" placeholder="渠道名称" value={providerForm.name} onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })} />
              <input className="px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" placeholder="上游 Base URL，如 https://api.openai.com/v1" value={providerForm.baseUrl} onChange={(e) => setProviderForm({ ...providerForm, baseUrl: e.target.value })} />
              <input className="px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" placeholder="上游 API Key" value={providerForm.apiKey} onChange={(e) => setProviderForm({ ...providerForm, apiKey: e.target.value })} />
              <textarea className="px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 min-h-[100px]" placeholder="模型列表，一行一个或逗号分隔" value={providerModelsInput} onChange={(e) => setProviderModelsInput(e.target.value)} />
              <div className="flex gap-2">
                <button type="button" onClick={fetchProviderModels} disabled={isFetchingModels || !providerForm.baseUrl.trim()} className="px-4 py-2 text-sm font-medium rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-center gap-2">
                  <RefreshCw className={`w-4 h-4 ${isFetchingModels ? "animate-spin" : ""}`} />
                  {isFetchingModels ? "获取中..." : "获取模型"}
                </button>
                <button onClick={saveProvider} disabled={isSavingProvider} className="px-6 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl flex items-center justify-center gap-2">
                  <Save className="w-4 h-4" />
                  保存渠道
                </button>
              </div>
            </div>
          </div>
          <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-4">
            <div className="space-y-3">
              <input className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" placeholder="默认模型，如 gpt-4o-mini" value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} />
              <button onClick={saveDefaultModel} className="px-6 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl">保存默认模型</button>
            </div>
            <div className="space-y-3">
              {providers.map((p) => (
                <div key={p.id} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {p.name}
                        {p.enabled ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">已启用</span> : <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500">已禁用</span>}
                      </div>
                      <div className="text-xs text-zinc-500 break-all">{p.baseUrl}</div>
                      <div className="text-xs text-zinc-500">模型：{(p.models || []).join(", ") || "未填写"}</div>
                    </div>
                    <div className="flex gap-2 items-center">
                      <label className="text-xs text-zinc-500 flex items-center gap-2">
                        <input type="checkbox" checked={p.enabled} onChange={(e) => toggleProviderEnabled(p.id, e.target.checked)} />
                        启用
                      </label>
                      <button onClick={() => { setProviderForm(p); setProviderModelsInput((p.models || []).join("\n")); }} className="text-xs text-zinc-500 hover:text-zinc-900">编辑</button>
                      <button onClick={() => removeProvider(p.id)} className="text-xs text-red-500">删除</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Sparkles className="w-5 h-5 text-zinc-500" />
          <h2>图片 API 渠道</h2>
        </div>
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-4">
            <div className="grid gap-3">
              <input className="px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" placeholder="生图渠道名称" value={imageProviderForm.name} onChange={(e) => setImageProviderForm({ ...imageProviderForm, name: e.target.value })} />
              <input className="px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" placeholder="图片 API Base URL，例如 https://api.openai.com/v1" value={imageProviderForm.baseUrl} onChange={(e) => setImageProviderForm({ ...imageProviderForm, baseUrl: e.target.value })} />
              <input className="px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" placeholder="图片 API Key" value={imageProviderForm.apiKey} onChange={(e) => setImageProviderForm({ ...imageProviderForm, apiKey: e.target.value })} />
              <input type="number" className="px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" placeholder="每张图片扣费额度" value={imageProviderForm.pricePerImage} onChange={(e) => setImageProviderForm({ ...imageProviderForm, pricePerImage: Math.max(0, Number(e.target.value || 0)) })} />
              <textarea className="px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 min-h-[100px]" placeholder="图片模型列表，一行一个或逗号分隔" value={imageProviderModelsInput} onChange={(e) => setImageProviderModelsInput(e.target.value)} />
              <div className="flex gap-2">
                <button type="button" onClick={fetchImageProviderModels} disabled={isFetchingImageModels || !imageProviderForm.baseUrl.trim()} className="px-4 py-2 text-sm font-medium rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center justify-center gap-2">
                  <RefreshCw className={`w-4 h-4 ${isFetchingImageModels ? "animate-spin" : ""}`} />
                  {isFetchingImageModels ? "获取中..." : "获取图片模型"}
                </button>
                <button onClick={saveImageProvider} disabled={isSavingImageProvider} className="px-6 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl flex items-center justify-center gap-2">
                  <Save className="w-4 h-4" />
                  保存图片渠道
                </button>
              </div>
            </div>
          </div>
          <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-4">
            <div className="space-y-3">
              <input className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" placeholder="默认生图模型，例如 gpt-image-1" value={defaultImageModel} onChange={(e) => setDefaultImageModel(e.target.value)} />
              <button onClick={saveDefaultImageModel} className="px-6 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl">保存默认生图模型</button>
            </div>
            <div className="space-y-3">
              {imageProviders.map((p) => (
                <div key={p.id} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-medium flex items-center gap-2">
                        {p.name}
                        {activeImageProviderId === p.id && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">当前生图渠道</span>}
                        {p.enabled ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">已启用</span> : <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500">已禁用</span>}
                      </div>
                      <div className="text-xs text-zinc-500 break-all">{p.baseUrl}</div>
                      <div className="text-xs text-zinc-500">模型：{(p.models || []).join(", ") || "未填写"}</div>
                      <div className="text-xs text-zinc-500">每张扣费：{Number(p.pricePerImage || 0).toLocaleString()}</div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <label className="text-xs text-zinc-500 flex items-center gap-2">
                        <input type="checkbox" checked={p.enabled} onChange={(e) => toggleImageProviderEnabled(p.id, e.target.checked)} />
                        启用
                      </label>
                      <button type="button" onClick={() => selectActiveImageProvider(p.id)} className="text-xs text-blue-500 hover:text-blue-600">设为当前</button>
                      <button onClick={() => { setImageProviderForm(p); setImageProviderModelsInput((p.models || []).join("\n")); }} className="text-xs text-zinc-500 hover:text-zinc-900">编辑</button>
                      <button onClick={() => removeImageProvider(p.id)} className="text-xs text-red-500">删除</button>
                    </div>
                  </div>
                </div>
              ))}
              {imageProviders.length === 0 && (
                <div className="text-sm text-zinc-500 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 p-4">
                  还没有配置图片 API 渠道。在线生图和 `/v1/images/*` 会一直不可用，直到这里至少启用并选中一个渠道。
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <details className="space-y-6" open>
        <summary className="flex items-center justify-between gap-4 flex-wrap cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <div className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Key className="w-5 h-5 text-zinc-500" />
            <h2>兑换码管理</h2>
          </div>
          <div className="px-3 py-1.5 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center gap-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all">
            <ChevronDown className="w-4 h-4 details-open:hidden" />
            <ChevronUp className="w-4 h-4 hidden details-open:block" />
            <span className="details-open:hidden">展开兑换码列表</span>
            <span className="hidden details-open:inline">收起兑换码列表</span>
          </div>
        </summary>
        <div className="space-y-4 pt-2">
          <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">类型</label>
              <select className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" value={newCode.type} onChange={(e) => setNewCode({ ...newCode, type: e.target.value as any })}>
                <option value="permanent">额度直冲 (永久)</option>
                <option value="daily">天卡</option>
                <option value="monthly">月卡</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{newCode.type === "permanent" ? "额度" : "每日额度"}</label>
              <input type="number" className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" value={newCode.value} onChange={(e) => setNewCode({ ...newCode, value: parseInt(e.target.value || "0") })} />
            </div>
            {newCode.type !== "permanent" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">持续天数</label>
                <input type="number" className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" value={newCode.durationDays} onChange={(e) => setNewCode({ ...newCode, durationDays: parseInt(e.target.value || "0") })} />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">批量数量</label>
              <input type="number" min="1" max="200" className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" value={newCode.count} onChange={(e) => setNewCode({ ...newCode, count: Math.max(1, Math.min(200, parseInt(e.target.value || "1"))) })} />
            </div>
            <button onClick={generateCode} disabled={isGenerating} className="px-6 py-2 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl">
              {isGenerating ? "生成中..." : "生成兑换码"}
            </button>
            {hasCollapsibleCodes && (
              <button type="button" onClick={toggleExpandAllCodes} className="px-6 py-2 text-sm font-medium rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
                {areAllCollapsibleCodesExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {areAllCollapsibleCodesExpanded ? "收起全部" : "展开全部"}
              </button>
            )}
            <button type="button" onClick={exportGeneratedCodes} disabled={!codes.length} className="px-6 py-2 text-sm font-medium rounded-xl border border-zinc-200 dark:border-zinc-800 flex items-center gap-2 disabled:opacity-50">
              <Download className="w-4 h-4" />
              下载 TXT
            </button>
          </div>
          {!!lastGeneratedCodes.length && <div className="text-xs text-zinc-500">最近批量生成 {lastGeneratedCodes.length} 个兑换码；下载 TXT 默认优先导出最近生成的兑换码，否则导出当前列表。</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {codes.map((code) => {
              const expanded = Boolean(expandedCodes[code.code]);
              const collapsed = shouldCollapseCode(code.code) && !expanded;
              return (
                <div key={code.code} className={cn("p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 flex items-start justify-between gap-3 group", code.isUsed && "opacity-50")}>
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <span className="font-mono font-bold text-sm break-all">{collapsed ? formatCodePreview(code.code) : code.code}</span>
                      {code.isUsed && <span className="px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">已使用</span>}
                    </div>
                    {shouldCollapseCode(code.code) && (
                      <button type="button" onClick={() => toggleCodeExpanded(code.code)} className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center gap-1">
                        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {expanded ? "收起" : "展开"}
                      </button>
                    )}
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">{code.type} • {code.value.toLocaleString()} Tokens</div>
                    <div className="text-[10px] text-zinc-400">{code.usedBy ? `使用者: ${code.usedBy}` : "未使用"}</div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button type="button" onClick={() => copyCode(code.code)} className="p-1.5 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
                      {copiedCode === code.code ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button type="button" onClick={() => deleteCode(code.code)} className="p-1.5 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </details>

      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Users className="w-5 h-5 text-zinc-500" />
            <h2>用户管理</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {USER_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setUserFilter(filter.key)}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-full border transition-all",
                  userFilter === filter.key
                    ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
                    : "border-zinc-200 dark:border-zinc-800 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
          <table className="w-full text-left text-xs min-w-[1080px]">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                <th className="px-3 py-2 font-medium text-zinc-500">用户</th>
                <th className="px-3 py-2 font-medium text-zinc-500">角色</th>
                <th className="px-3 py-2 font-medium text-zinc-500">永久额度</th>
                <th className="px-3 py-2 font-medium text-zinc-500">卡类型</th>
                <th className="px-3 py-2 font-medium text-zinc-500">每日额度</th>
                <th className="px-3 py-2 font-medium text-zinc-500">今日已用</th>
                <th className="px-3 py-2 font-medium text-zinc-500">到期时间（北京时间）</th>
                <th className="px-3 py-2 font-medium text-zinc-500">累计消耗</th>
                <th className="px-3 py-2 font-medium text-zinc-500">活跃密钥</th>
                <th className="px-3 py-2 font-medium text-zinc-500">注册时间</th>
                <th className="px-3 py-2 font-medium text-zinc-500 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {users.map((user) => (
                <tr key={user.uid} className="group hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors align-top">
                  <td className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <div className="w-7 h-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 mt-0.5">
                        <UserIcon className="w-3.5 h-3.5 text-zinc-500" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate max-w-[140px]">{user.email}</div>
                        <div className="text-[10px] text-zinc-500 font-mono truncate max-w-[160px]">{user.uid}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      {user.role === "admin" ? <Shield className="w-3.5 h-3.5 text-amber-500" /> : <UserIcon className="w-3.5 h-3.5 text-zinc-400" />}
                      <span className={cn("capitalize", user.role === "admin" ? "text-amber-600 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-400")}>{user.role}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px]">{Number(user.balance || 0).toLocaleString()}</td>
                  <td className="px-3 py-2">{user.quotaType || "none"}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{Number(user.dailyQuota || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{Number(user.usedToday || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-[11px] text-zinc-500 whitespace-nowrap">{user.quotaExpiresAt ? new Date(new Date(user.quotaExpiresAt).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ") : "-"}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{Number(user.totalUsedTokens || 0).toLocaleString()}</td>
                  <td className="px-3 py-2">{Number(user.apiKeyCount || 0)}</td>
                  <td className="px-3 py-2 text-[11px] text-zinc-500 whitespace-nowrap">{user.createdAt ? new Date(new Date(user.createdAt).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ") : "-"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2 whitespace-nowrap">
                      <button onClick={() => { setEditingUser(user); setNewBalance(user.balance); }} className="text-[11px] font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">编辑余额</button>
                      <button onClick={() => setPendingDeleteUser(user)} className="text-[11px] font-medium text-red-500 hover:text-red-600 transition-colors">删除账号</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl space-y-6">
            <div className="space-y-2">
              <h3 className="text-xl font-bold tracking-tight">编辑用户余额</h3>
              <p className="text-sm text-zinc-500">修改 {editingUser.email} 的永久额度。</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">当前余额: {editingUser.balance.toLocaleString()}</label>
              <input type="number" className="w-full px-4 py-3 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 font-mono" value={newBalance} onChange={(e) => setNewBalance(parseInt(e.target.value || "0"))} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditingUser(null)} className="flex-1 py-3 text-sm font-medium rounded-xl border border-zinc-200 dark:border-zinc-800">取消</button>
              <button onClick={updateUserBalance} className="flex-1 py-3 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl">保存修改</button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteUser && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xl space-y-6">
            <div className="space-y-3 text-center">
              <div className="w-14 h-14 mx-auto rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                <AlertTriangle className="w-7 h-7 text-red-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold tracking-tight">确认删除账号</h3>
                <p className="text-sm text-zinc-500 mt-2">
                  将要删除：<span className="font-medium text-zinc-900 dark:text-zinc-100">{pendingDeleteUser.email}</span>
                </p>
                <p className="text-xs text-zinc-400 mt-1 break-all">{pendingDeleteUser.uid}</p>
              </div>
              <p className="text-sm text-red-500">删除后该用户的密钥和使用记录也会一并清理，不可恢复。</p>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setPendingDeleteUser(null)} className="flex-1 py-3 text-sm font-medium rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all">取消</button>
              <button type="button" onClick={confirmDeleteUser} disabled={isDeletingUser} className="flex-1 py-3 text-sm font-medium text-white bg-red-600 rounded-xl hover:opacity-90 disabled:opacity-50 transition-all">
                {isDeletingUser ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
