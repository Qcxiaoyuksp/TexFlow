"use client";

import { useState, useRef, useEffect, useCallback, useMemo, type DragEvent } from "react";
import katex from "katex";
import {
  Upload,
  Clipboard as ClipboardIcon,
  Copy,
  Loader2,
  Sparkles,
  Table as TableIcon,
  Sigma,
  Layers,
  Check,
  type LucideIcon,
} from "lucide-react";

type InputType = "FORMULA" | "TABLE" | "MIXED";

interface OcrRecord {
  recordId: string;
  inputType: string;
  routeMode: string;
  rawLatex: string;
  healedLatex: string;
  requiredPackages: string[];
  confidenceScore: number;
}

interface ApiResponse {
  code: number;
  message: string;
  data: OcrRecord;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/internal/v1/ocr/recognize";

export default function Home() {
  const [inputType, setInputType] = useState<InputType>("FORMULA");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<OcrRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latexText, setLatexText] = useState("");
  const [copiedPackage, setCopiedPackage] = useState(false);
  const [copiedLatex, setCopiedLatex] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const readerResult = reader.result as string;
      const base64 = readerResult.split(",")[1];
      setImageBase64(base64);
    };
    reader.readAsDataURL(file);
  }, []);

  useEffect(() => {
    const handlePaste = (e: Event) => {
      const ce = e as ClipboardEvent;
      const items = ce.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile();
          if (file) {
            handleImageFile(file);
            e.preventDefault();
            break;
          }
        }
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleImageFile]);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  };

  const handleRecognize = async () => {
    if (!imageBase64) return;
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, inputType, projectId: null }),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const body: ApiResponse = await resp.json();
      if (body.code === 200) {
        setResult(body.data);
        setLatexText(body.data.healedLatex || body.data.rawLatex);
      } else {
        setError(body.message || "识别失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络请求失败");
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const renderedHtml = useMemo(() => {
    try {
      const html = katex.renderToString(latexText, {
        displayMode: true,
        throwOnError: false,
      });
      return { __html: html };
    } catch {
      return { __html: '<span style="color:#ef4444">渲染失败</span>' };
    }
  }, [latexText]);

  const isTable = latexText.includes("\\begin{tabular}");

  const modeOptions: { value: InputType; label: string; icon: LucideIcon }[] = [
    { value: "FORMULA", label: "数学公式", icon: Sigma },
    { value: "TABLE", label: "三线表", icon: TableIcon },
    { value: "MIXED", label: "图文混排", icon: Layers },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              TexFlow 学术公式与三线表智能工作台
            </h1>
            <p className="text-xs text-slate-500">v0.1 · 端云协同多智能体学术重构</p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5">
            <span className="h-2 w-2 rounded-full bg-blue-600"></span>
            <span className="text-xs font-medium text-blue-700">
              CLOUD_VLM · 移动云多模态引擎
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <label className="mb-3 block text-sm font-medium text-slate-700">
                识别模式
              </label>
              <div className="flex gap-2">
                {modeOptions.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setInputType(opt.value)}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        inputType === opt.value
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
                  isDragging
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-300 hover:border-slate-400"
                }`}
              >
                {imageBase64 ? (
                  <div className="w-full">
                    <img
                      src={`data:image/png;base64,${imageBase64}`}
                      alt="预览"
                      className="mx-auto max-h-48 rounded"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setImageBase64(null);
                        setResult(null);
                        setLatexText("");
                      }}
                      className="mt-2 text-xs text-red-500 hover:underline"
                    >
                      移除图片
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-10 w-10 text-slate-400" />
                    <p className="mt-2 text-sm text-slate-600">
                      点击、拖拽或粘贴 (Cmd+V / Ctrl+V) 上传图片
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      支持 PNG / JPG 等常见图片格式
                    </p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageFile(file);
                  }}
                />
              </div>
            </div>

            <button
              onClick={handleRecognize}
              disabled={!imageBase64 || isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  智能识别中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  开始智能识别
                </>
              )}
            </button>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </section>

          <section className="space-y-4">
            {!result ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-12">
                <ClipboardIcon className="h-12 w-12 text-slate-300" />
                <p className="mt-3 text-sm text-slate-400">
                  上传图片并点击识别后，结果将在此展示
                </p>
              </div>
            ) : (
              <>
                {result.requiredPackages.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">
                        导言区宏包
                      </span>
                      <button
                        onClick={() => {
                          copyToClipboard(
                            `\\usepackage{${result.requiredPackages.join(", ")}}`
                          );
                          setCopiedPackage(true);
                          setTimeout(() => setCopiedPackage(false), 2000);
                        }}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                      >
                        {copiedPackage ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedPackage ? "已复制" : "复制 usepackage"}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {result.requiredPackages.map((pkg) => (
                        <span
                          key={pkg}
                          className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                        >
                          {"\\usepackage{" + pkg + "}"}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">
                      LaTeX 源码
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400">
                        置信度: {(result.confidenceScore * 100).toFixed(1)}%
                      </span>
                      <button
                        onClick={() => {
                          copyToClipboard(latexText);
                          setCopiedLatex(true);
                          setTimeout(() => setCopiedLatex(false), 2000);
                        }}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                      >
                        {copiedLatex ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copiedLatex ? "已复制" : "一键复制 LaTeX"}
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={latexText}
                    onChange={(e) => setLatexText(e.target.value)}
                    className="h-48 w-full resize-none rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    spellCheck={false}
                  />
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <span className="mb-3 block text-sm font-medium text-slate-700">
                    实时渲染预览
                  </span>
                  {isTable ? (
                    <div className="rounded-md bg-slate-50 p-4">
                      <pre className="whitespace-pre-wrap font-mono text-xs text-slate-700">
                        {latexText}
                      </pre>
                      <p className="mt-3 text-xs text-slate-400">
                        三线表源码结构预览 · 可视化网格渲染将在第 2 阶段实现
                      </p>
                    </div>
                  ) : (
                    <div
                      className="flex min-h-[80px] items-center justify-center overflow-x-auto rounded-md bg-slate-50 p-4"
                      dangerouslySetInnerHTML={renderedHtml}
                    />
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
