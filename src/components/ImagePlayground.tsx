import React, { useEffect, useMemo, useState } from "react";
import { dataService } from "../services/dataService";
import { useAuth } from "../contexts/AuthContext";
import { ImagePlus, Sparkles, RefreshCw, Download, ExternalLink, Wand2, History } from "lucide-react";

interface ImageConfig {
  enabled: boolean;
  activeProvider: {
    id: string;
    name: string;
    pricePerImage: number;
  } | null;
  defaultModel: string;
  models: string[];
}

interface ImageResult {
  url: string;
  file_id?: string | null;
  revised_prompt?: string | null;
}

interface RatioOption {
  label: string;
  ratio: string;
  size: string;
}

interface RecentImageItem extends ImageResult {
  id: string;
  prompt: string;
  model: string;
  createdAt: string;
}

const RATIO_OPTIONS: RatioOption[] = [
  { label: "方图", ratio: "1:1", size: "1024x1024" },
  { label: "横屏", ratio: "16:9", size: "1792x1024" },
  { label: "竖版", ratio: "9:16", size: "1024x1792" },
  { label: "海报", ratio: "4:5", size: "1024x1792" },
  { label: "宽幅", ratio: "21:9", size: "1792x1024" },
];

const PROMPT_EXAMPLES = [
  "赛博朋克城市夜景，雨夜霓虹，电影感光影，超高细节",
  "极简海报风，留白构图，一只白鹤掠过深蓝色湖面",
  "国风山水插画，晨雾、松林、远山、金色日出",
  "产品广告摄影，一瓶香水置于玻璃台面，柔和高光与倒影",
];

function applyRatioPrefix(prompt: string, ratio: string) {
  const prefix = `Make the aspect ratio ${ratio} , `;
  const pattern = /^\s*Make the aspect ratio\s+\S+\s*,\s*/i;
  if (pattern.test(prompt)) {
    return prompt.replace(pattern, prefix);
  }
  return prompt ? `${prefix}${prompt}` : prefix;
}

function downloadImage(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.download = "";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export const ImagePlayground: React.FC = () => {
  const { refreshProfile, profile } = useAuth();
  const [config, setConfig] = useState<ImageConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<RatioOption["ratio"]>("1:1");
  const [count, setCount] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<ImageResult[]>([]);
  const [recentImages, setRecentImages] = useState<RecentImageItem[]>([]);
  const [error, setError] = useState("");

  const activeRatio = useMemo(
    () => RATIO_OPTIONS.find((item) => item.ratio === ratio) || RATIO_OPTIONS[0],
    [ratio]
  );

  const recentStorageKey = useMemo(
    () => `api_trans_recent_images_${profile?.uid || "guest"}`,
    [profile?.uid]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingConfig(true);
      try {
        const data = await dataService.getImagePlaygroundConfig();
        if (cancelled) return;
        setConfig(data as ImageConfig);
        setModel(String((data as ImageConfig)?.defaultModel || (data as ImageConfig)?.models?.[0] || ""));
        setPrompt((prev) => prev || applyRatioPrefix("", ratio));
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "加载在线生图配置失败");
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(recentStorageKey);
      if (!raw) {
        setRecentImages([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecentImages(parsed.slice(0, 10));
      }
    } catch {
      setRecentImages([]);
    }
  }, [recentStorageKey]);

  useEffect(() => {
    localStorage.setItem(recentStorageKey, JSON.stringify(recentImages.slice(0, 10)));
  }, [recentImages, recentStorageKey]);

  const chooseRatio = (nextRatio: string) => {
    setRatio(nextRatio);
    setPrompt((prev) => applyRatioPrefix(prev, nextRatio));
  };

  const useExample = (value: string) => {
    setPrompt(applyRatioPrefix(value, ratio));
  };

  const appendRecentImages = (items: ImageResult[], sourcePrompt: string, sourceModel: string) => {
    const createdAt = new Date().toISOString();
    const nextItems: RecentImageItem[] = items.map((item, index) => ({
      ...item,
      id: `${createdAt}-${index}-${item.url}`,
      prompt: sourcePrompt,
      model: sourceModel,
      createdAt,
    }));
    setRecentImages((prev) => [...nextItems, ...prev].slice(0, 10));
  };

  const generate = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setError("请输入 prompt");
      return;
    }
    if (!model.trim()) {
      setError("请选择或填写一个生图模型");
      return;
    }

    setGenerating(true);
    setError("");
    setResults([]);
    try {
      const data: any = await dataService.generateImage({
        model: model.trim(),
        prompt: trimmedPrompt,
        n: count,
        size: activeRatio.size,
      });
      const nextResults = Array.isArray(data?.data) ? data.data : [];
      setResults(nextResults);
      appendRecentImages(nextResults, trimmedPrompt, model.trim());
      await Promise.resolve(refreshProfile());
    } catch (err: any) {
      setError(err?.message || "生图失败");
    } finally {
      setGenerating(false);
    }
  };

  const renderImageGrid = (items: Array<ImageResult | RecentImageItem>, showMeta = false) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {items.map((item, index) => (
        <article key={"id" in item ? item.id : `${item.url}-${index}`} className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/40">
          <img src={item.url} alt={`generated-${index}`} className="w-full h-auto block aspect-square object-cover bg-zinc-100 dark:bg-zinc-900" />
          <div className="p-4 space-y-3">
            {"prompt" in item && showMeta && (
              <div className="space-y-1">
                <div className="text-[11px] text-zinc-400">{formatTime(item.createdAt)}</div>
                <div className="text-xs text-zinc-500 line-clamp-2">{item.prompt}</div>
                <div className="text-[11px] text-zinc-400 font-mono">{item.model}</div>
              </div>
            )}
            {item.revised_prompt && (
              <p className="text-xs text-zinc-500 line-clamp-3">{item.revised_prompt}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
                className="flex-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm flex items-center justify-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <ExternalLink className="w-4 h-4" />
                预览
              </button>
              <button
                type="button"
                onClick={() => downloadImage(item.url)}
                className="flex-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm flex items-center justify-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <Download className="w-4 h-4" />
                下载
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );

  if (loadingConfig) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 text-sm text-zinc-500">
          正在加载在线生图配置...
        </div>
      </div>
    );
  }

  if (!config?.enabled) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-6">
        <section className="p-6 rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/80 dark:bg-amber-950/20">
          <div className="flex items-center gap-3 text-amber-700 dark:text-amber-300">
            <ImagePlus className="w-5 h-5" />
            <h2 className="text-lg font-semibold tracking-tight">在线生图未启用</h2>
          </div>
          <p className="mt-3 text-sm text-amber-700/80 dark:text-amber-300/80">
            管理员需要先在后台配置并启用一个专用的生图渠道，然后再选择当前使用的图片 API。
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-6 sm:p-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.12),_transparent_40%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.12),_transparent_45%)] pointer-events-none" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-500">
              <Sparkles className="w-3.5 h-3.5" />
              在线生图独立页面，扣费仍计入同一账户额度
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">在线生图</h1>
              <p className="mt-2 text-sm text-zinc-500">
                当前渠道：{config.activeProvider?.name || "-"}，单张扣费 {Number(config.activeProvider?.pricePerImage || 0).toLocaleString()}。
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/60 px-4 py-3">
              <div className="text-zinc-500">默认模型</div>
              <div className="mt-1 font-mono text-xs break-all">{config.defaultModel || model || "-"}</div>
            </div>
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/60 px-4 py-3">
              <div className="text-zinc-500">输出尺寸</div>
              <div className="mt-1 font-mono text-xs">{activeRatio.size}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-8">
        <aside className="space-y-6">
          <section className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-4">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">生成参数</h2>
              <p className="text-xs text-zinc-500">这部分状态只影响在线生图，不会干扰普通控制台请求。</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">模型</label>
              {config.models.length > 0 ? (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
                >
                  {config.models.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
                  placeholder="输入模型名，例如 gpt-image-1"
                />
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">比例</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {RATIO_OPTIONS.map((item) => (
                  <button
                    key={item.ratio}
                    type="button"
                    onClick={() => chooseRatio(item.ratio)}
                    className={`px-3 py-3 rounded-xl border text-sm transition-all ${
                      ratio === item.ratio
                        ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 text-zinc-600 dark:text-zinc-300"
                    }`}
                  >
                    <div className="font-medium">{item.label}</div>
                    <div className="text-xs opacity-70 mt-1">{item.ratio}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">数量</label>
              <select
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
              >
                {[1, 2, 3, 4].map((value) => (
                  <option key={value} value={value}>
                    {value} 张
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="w-full px-4 py-3 rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {generating ? "生成中..." : "开始生图"}
            </button>
          </section>

          <section className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-3">
            <div className="text-sm font-semibold tracking-tight">灵感示例</div>
            <div className="flex flex-wrap gap-2">
              {PROMPT_EXAMPLES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => useExample(item)}
                  className="px-3 py-2 text-xs rounded-full border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 text-zinc-600 dark:text-zinc-300 transition-all"
                >
                  {item}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="space-y-6">
          <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-3">
            <label className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={10}
              className="w-full px-4 py-3 text-sm rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 resize-none"
              placeholder="描述你想生成的画面..."
            />
            <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-zinc-500">
              <span>已自动注入比例前缀：{activeRatio.ratio}</span>
              <span>预计扣费：{(count * Number(config.activeProvider?.pricePerImage || 0)).toLocaleString()}</span>
            </div>
          </div>

          {error && (
            <div className="p-4 rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 text-sm text-red-600 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-6 min-h-[420px]">
            {generating ? (
              <div className="h-full min-h-[360px] flex flex-col items-center justify-center text-zinc-500">
                <RefreshCw className="w-8 h-8 animate-spin mb-4" />
                <div className="text-sm">请等待1-5分钟</div>
              </div>
            ) : results.length === 0 ? (
              <div className="h-full min-h-[360px] flex flex-col items-center justify-center text-center text-zinc-500">
                <ImagePlus className="w-10 h-10 mb-4" />
                <div className="text-base font-medium text-zinc-900 dark:text-zinc-100">还没有生成结果</div>
                <p className="mt-2 text-sm max-w-md">
                  选择模型、比例和数量后，输入 prompt 发起请求。这里的结果只属于在线生图页面，不会污染普通请求面板状态。
                </p>
              </div>
            ) : (
              renderImageGrid(results)
            )}
          </div>

          <section className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <History className="w-5 h-5 text-zinc-500" />
              <h2>最近生成</h2>
              <span className="text-xs text-zinc-500">保留最近 10 张</span>
            </div>
            {recentImages.length > 0 ? (
              renderImageGrid(recentImages, true)
            ) : (
              <div className="text-sm text-zinc-500 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 p-6">
                这里会显示你最近生成的图片记录。
              </div>
            )}
          </section>
        </section>
      </div>
    </div>
  );
};
