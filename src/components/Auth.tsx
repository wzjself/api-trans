import React, { useState } from "react";
import { Zap, Key, BarChart3, Globe, Mail, Lock, UserPlus, LogIn, Loader2, AlertCircle, Ticket } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { apiClient, setAuthToken } from "../services/apiClient";

export const Auth: React.FC = () => {
  const { refreshProfile } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
      const result = await apiClient.post(endpoint, {
        email,
        password,
        ...(isLogin ? {} : { inviteCode }),
      });
      setAuthToken(result.token);
      await refreshProfile();
    } catch (err: any) {
      console.error("Auth Error:", err?.code, err?.message || err);
      setError(err.message);
      return;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 pt-8">
            wzjself中转站
          </h1>
          <p className="text-zinc-500 text-lg">
            {isLogin ? "欢迎回来，请登录你的账号" : "创建一个新账号开始使用，可选填写邀请码"}
          </p>
        </div>

        <div className="p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 shadow-xl space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                <Mail className="w-3 h-3" /> 账号
              </label>
              <input
                type="text"
                required
                className="w-full px-4 py-3 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all"
                placeholder="请输入账号"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                <Lock className="w-3 h-3" /> 密码
              </label>
              <input
                type="password"
                required
                className="w-full px-4 py-3 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {!isLogin && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                  <Ticket className="w-3 h-3" /> 邀请码
                </label>
                <input
                  type="text"
                  className="w-full px-4 py-3 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 transition-all"
                  placeholder="可选填写别人的邀请码"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                />
                <p className="text-xs text-zinc-500">
                  受邀用户首次兑换月卡或永久额度兑换码后，邀请人可获得 20M Token 奖励。
                </p>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-xl bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 text-base font-semibold text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-2xl hover:opacity-90 transition-all shadow-xl shadow-zinc-200 dark:shadow-none flex items-center justify-center gap-3"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isLogin ? (
                <>
                  <LogIn className="w-5 h-5" /> 立即登录
                </>
              ) : (
                <>
                  <UserPlus className="w-5 h-5" /> 注册账号
                </>
              )}
            </button>
          </form>

          <div className="pt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setIsLogin(!isLogin);
              }}
              className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              {isLogin ? "还没有账号？点击注册" : "已有账号？点击登录"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-left opacity-50">
          {[
            { icon: Key, title: "多密钥管理", desc: "灵活创建与撤销" },
            { icon: BarChart3, title: "实时统计", desc: "按小时/天监控" },
            { icon: Zap, title: "弹性额度", desc: "天卡/月卡/永久" },
            { icon: Globe, title: "标准兼容", desc: "OpenAI 接口格式" },
          ].map((feature, i) => (
            <div key={i} className="p-4 rounded-2xl border border-zinc-100 dark:border-zinc-900 bg-white dark:bg-zinc-950/50 space-y-1">
              <feature.icon className="w-5 h-5 text-zinc-400 mb-2" />
              <div className="font-semibold text-sm">{feature.title}</div>
              <div className="text-xs text-zinc-500">{feature.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
