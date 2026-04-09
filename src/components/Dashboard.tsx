import React from "react";
import { useAuth } from "../contexts/AuthContext";
import { dataService } from "../services/dataService";
import { useEffect, useState } from "react";
import { ApiKeyManager } from "./ApiKeyManager";
import { UsageChart } from "./UsageChart";
import { Redemption } from "./Redemption";
import { Globe, Terminal, Copy, Check, Activity, RefreshCw, Wallet, CalendarClock } from "lucide-react";
import { format } from "date-fns";

const API_BASE_URL = import.meta.env.VITE_PUBLIC_API_BASE || window.location.origin;
const OPENAI_BASE_URL = `${API_BASE_URL.replace(/\/$/, "")}/v1`;

const UsageRecordsTable: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    const unsub = dataService.subscribeConsumeLogs((data) => setLogs(data || []), 20);
    return () => unsub();
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
            <th className="px-6 py-3 font-medium text-zinc-500">时间</th>
            <th className="px-6 py-3 font-medium text-zinc-500">模型</th>
            <th className="px-6 py-3 font-medium text-zinc-500 text-right">额度</th>
            <th className="px-6 py-3 font-medium text-zinc-500">状态</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {logs.map((log) => (
            <tr key={log.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30 transition-colors">
              <td className="px-6 py-4 text-zinc-500">{log.createdAt ? format(new Date(log.createdAt), 'MM-dd HH:mm:ss') : '-'}</td>
              <td className="px-6 py-4 font-medium">{log.model || '-'}</td>
              <td className="px-6 py-4 text-right font-mono text-xs">{Number(log.consumedQuota || 0).toLocaleString()}</td>
              <td className="px-6 py-4">
                <span className={log.success ? 'text-emerald-600' : 'text-red-500'}>{log.success ? `成功 (${log.statusCode})` : `失败 (${log.statusCode})`}</span>
                {!log.success && log.errorMessage && <div className="text-xs text-zinc-400 mt-1 max-w-[260px] truncate">{log.errorMessage}</div>}
              </td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={4} className="px-6 py-10 text-center text-zinc-400">暂无使用记录</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export const Dashboard: React.FC = () => {
  const { profile, refreshProfile } = useAuth();
  const [guideLink, setGuideLink] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  useEffect(() => {
    const unsub = dataService.subscribeSettings((data) => {
      setGuideLink(data?.guideLink || "");
      setAnnouncement(data?.announcement || "");
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      Promise.resolve(refreshProfile()).then(() => setLastSyncedAt(new Date()));
    }, 10000);
    return () => window.clearInterval(timer);
  }, [refreshProfile]);

  const [copiedUrl, setCopiedUrl] = useState(false);

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

  const copyUrl = async () => {
    const copied = await safeCopy(OPENAI_BASE_URL);
    if (!copied) return;
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const refreshData = async () => {
    if (!profile) return;
    try {
      setIsRefreshing(true);
      await refreshProfile();
      setLastSyncedAt(new Date());
    } catch (error) {
      console.error(error);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      <header className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">欢迎回来</h1>
          <p className="text-zinc-500">管理您的 API 密钥，查看使用统计并充值额度。</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
            <Wallet className="w-4 h-4" />
            当前余额：<span className="font-mono text-zinc-900 dark:text-zinc-100">{Number(profile?.balance || 0).toLocaleString()}</span>
          </div>
          {profile?.quotaType && profile.quotaType !== 'none' && profile?.quotaExpiresAt && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
              <CalendarClock className="w-4 h-4" />
              {profile.quotaType === 'daily' ? '天卡到期：' : '月卡到期：'}
              <span className="font-mono text-zinc-900 dark:text-zinc-100">{format(new Date(profile.quotaExpiresAt), 'yyyy-MM-dd HH:mm:ss')}</span>
            </div>
          )}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            最近同步：<span className="font-mono text-zinc-900 dark:text-zinc-100">{lastSyncedAt ? format(lastSyncedAt, 'MM-dd HH:mm:ss') : '未同步'}</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-10">
          <section className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Globe className="w-5 h-5 text-zinc-500" />
              <h3>API 接口地址</h3>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 font-mono text-sm group">
              <Terminal className="w-4 h-4 text-zinc-400" />
              <span className="flex-1 truncate">{OPENAI_BASE_URL}</span>
              <button 
                onClick={copyUrl}
                className="p-1 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all"
              >
                {copiedUrl ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-zinc-400" />}
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              使用此 URL 作为您的 API 基础地址。支持 OpenAI 兼容的请求格式。
            </p>
          </section>

          <section className="space-y-6">
            <ApiKeyManager />
          </section>

          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold tracking-tight">使用统计</h2>
              <button
                onClick={refreshData}
                disabled={isRefreshing}
                className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-1 transition-colors disabled:opacity-60"
              >
                <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? '刷新中...' : '刷新数据'}
              </button>
            </div>
            <UsageChart />
          </section>

          <section className="space-y-6">
            <div className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <Activity className="w-5 h-5 text-zinc-500" />
              <h2>使用记录</h2>
            </div>
            <UsageRecordsTable />
          </section>
        </div>

        <div className="space-y-8">
          <section className="space-y-6">
            <Redemption />
          </section>

          <section className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 space-y-4 overflow-hidden relative">
            <div className="relative z-10 space-y-4">
              <h3 className="text-lg font-semibold tracking-tight">使用指南</h3>
              <p className="text-sm opacity-70">
                查看详细的 API 接入文档、代码示例和常见问题解答。
              </p>
              <a 
                href={guideLink || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-2.5 text-center text-sm font-bold bg-white text-zinc-900 dark:bg-zinc-900 dark:text-white rounded-xl hover:opacity-90 transition-all"
              >
                查看文档
              </a>
            </div>
            <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-zinc-700/30 dark:bg-zinc-300/30 rounded-full blur-3xl" />
          </section>

          <section className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-4">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold tracking-tight">站点公告</h3>
              <p className="text-xs text-zinc-500">此内容可在管理员后台编辑。</p>
            </div>
            <div className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words min-h-[72px]">
              {announcement || '暂无公告'}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
