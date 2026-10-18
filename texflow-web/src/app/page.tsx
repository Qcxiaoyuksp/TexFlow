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
  Wand2,
  ShieldCheck,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "math-field": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

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

interface AstValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface HealApiResponse {
  code: number;
  message: string;
  data: {
    healedLatex: string;
    astValidationResult: AstValidationResult;
    requiredPackages: string[];
  };
}

const API_BASE = (() => {
  const envUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/internal/v1/ocr/recognize";
  return envUrl.replace(/\/internal\/v1\/ocr\/.*$/, "");
})();
const API_URL = `${API_BASE}/internal/v1/ocr/recognize`;
const HEAL_URL = `${API_BASE}/internal/v1/ocr/heal`;
const ALIGN_URL = `${API_BASE}/internal/v1/agent/align-notation`;
const INJECT_URL = `${API_BASE}/internal/v1/agent/inject-table`;

interface NotationEntry {
  sourceSymbol: string;
  targetSymbol: string;
  semanticMeaning: string;
}

interface AlignApiResponse {
  code: number;
  message: string;
  data: { alignedLatex: string; notationExplanation: string; pytorchCode: string };
}

interface InjectApiResponse {
  code: number;
  message: string;
  data: { injectedLatex: string; skeletonLatex: string; summary: Record<string, unknown> };
}

const DEFAULT_NOTATION_MAP: NotationEntry[] = [
  { sourceSymbol: "w_t", targetSymbol: "\\alpha_t", semanticMeaning: "attention weight at step t" },
  { sourceSymbol: "x_t", targetSymbol: "h_t", semanticMeaning: "hidden state representation" },
];

const DEFAULT_CSV = `1.7520 ± 0.03,0.5890 ± 0.01
2.0201 ± 0.02,0.3240 ± 0.01
1.9323 ± 0.02,0.4104 ± 0.01
0.1272 ± 0.01,0.2813 ± 0.01
0.1324 ± 0.01,0.1885 ± 0.01
0.1501 ± 0.01,0.2454 ± 0.01`;

function renderLatexCell(cell: string): string {
  let h = cell.trim();
  h = h.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  h = h.replace(/\\textbf\{([^}]*)\}/g, "<strong>$1</strong>");
  h = h.replace(/\\underline\{([^}]*)\}/g, "<u>$1</u>");
  h = h.replace(/\\mathbf\{([^}]*)\}/g, "<strong>$1</strong>");
  h = h.replace(/\\mathrm\{([^}]*)\}/g, "$1");
  h = h.replace(/\\text\{([^}]*)\}/g, "$1");
  h = h.replace(/\\operatorname[\{ ]?([^}]*)\}?/g, "$1");
  h = h.replace(/\\uparrow/g, "↑");
  h = h.replace(/\\downarrow/g, "↓");
  h = h.replace(/\\rightarrow/g, "→");
  h = h.replace(/\\leftarrow/g, "←");
  h = h.replace(/\\pm/g, "±");
  h = h.replace(/\\%/g, "%");
  h = h.replace(/\\&/g, "&amp;");
  h = h.replace(/\$/g, "");
  h = h.replace(/\\multirow\{[^}]*\}\{[^}]*\}\{([^}]*)\}/g, "$1");
  h = h.replace(/\\multicolumn\{[^}]*\}\{[^}]*\}\{([^}]*)\}/g, "$1");
  const greek: Record<string, string> = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", theta: "θ", lambda: "λ", mu: "μ", sigma: "σ", omega: "ω", phi: "φ", pi: "π", rho: "ρ", tau: "τ", eta: "η", psi: "ψ" };
  h = h.replace(/\\(alpha|beta|gamma|delta|epsilon|theta|lambda|mu|sigma|omega|phi|pi|rho|tau|eta|psi)(?![a-zA-Z])/g, (_, n) => greek[n] || n);
  h = h.replace(/\\times/g, "×");
  h = h.replace(/\\leq/g, "≤");
  h = h.replace(/\\geq/g, "≥");
  h = h.replace(/\\neq/g, "≠");
  h = h.replace(/\\approx/g, "≈");
  h = h.replace(/\\sum/g, "Σ");
  h = h.replace(/\\sqrt\{([^}]*)\}/g, "√($1)");
  h = h.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)");
  h = h.replace(/\\[a-zA-Z]+/g, "");
  h = h.replace(/[{}]/g, "");
  return h.trim();
}

function parseLatexTable(latex: string): string {
  const match = latex.match(/\\begin\{tabular\}\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/);
  if (!match) return "";
  const content = match[2];
  const rawRows = content.split("\\\\").map((r) => r.trim());
  let headerCells: string[] = [];
  const bodyRows: string[][] = [];
  let inHeader = true;
  let firstHlineSeen = false;

  for (let row of rawRows) {
    if (row.includes("\\midrule")) inHeader = false;
    else if (row.includes("\\hline")) {
      if (firstHlineSeen) inHeader = false;
      else firstHlineSeen = true;
    }
    row = row.replace(/\\(toprule|midrule|bottomrule|hline|cmidrule\([^)]*\))/g, "").trim();
    if (!row) continue;
    const cells = row.split("&").map((c) => renderLatexCell(c));
    if (inHeader) headerCells = cells;
    else bodyRows.push(cells);
  }

  const headerHtml =
    headerCells.length > 0
      ? `<thead><tr class="border-b-2 border-slate-400">${headerCells
          .map((c) => `<th class="px-3 py-2 text-center text-xs font-semibold text-slate-700">${c}</th>`)
          .join("")}</tr></thead>`
      : "";
  const bodyHtml = bodyRows
    .map(
      (row) =>
        `<tr class="border-b border-slate-200">${row
          .map((c) => `<td class="px-3 py-2 text-center text-xs text-slate-600">${c}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<table class="w-full border-collapse">${headerHtml}<tbody>${bodyHtml}</tbody></table>`;
}

export default function Home() {
  const [inputType, setInputType] = useState<InputType>("FORMULA");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isHealing, setIsHealing] = useState(false);
  const [result, setResult] = useState<OcrRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latexText, setLatexText] = useState("");
  const [healResult, setHealResult] = useState<AstValidationResult | null>(null);
  const [copiedPackage, setCopiedPackage] = useState(false);
  const [copiedLatex, setCopiedLatex] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [notationMap, setNotationMap] = useState<NotationEntry[]>(DEFAULT_NOTATION_MAP);
  const [customInstruction, setCustomInstruction] = useState("");
  const [alignResult, setAlignResult] = useState<AlignApiResponse["data"] | null>(null);
  const [isAligning, setIsAligning] = useState(false);
  const [csvContent, setCsvContent] = useState(DEFAULT_CSV);
  const [metricDirections, setMetricDirections] = useState<string[]>(["MIN", "MAX"]);
  const [injectResult, setInjectResult] = useState<InjectApiResponse["data"] | null>(null);
  const [isInjecting, setIsInjecting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mathFieldRef = useRef<HTMLElement>(null);
  const isUpdatingFromMathField = useRef(false);
  const modeSnapshots = useRef<Record<string, { imageBase64: string | null; result: OcrRecord | null; latexText: string; healResult: AstValidationResult | null; alignResult: AlignApiResponse["data"] | null; injectResult: InjectApiResponse["data"] | null }>>({});

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

  const handleModeSwitch = (newMode: InputType) => {
    if (newMode === inputType) return;
    modeSnapshots.current[inputType] = { imageBase64, result, latexText, healResult, alignResult, injectResult };
    const snap = modeSnapshots.current[newMode] || { imageBase64: null as string | null, result: null as OcrRecord | null, latexText: "", healResult: null as AstValidationResult | null, alignResult: null as AlignApiResponse["data"] | null, injectResult: null as InjectApiResponse["data"] | null };
    setInputType(newMode);
    setImageBase64(snap.imageBase64);
    setResult(snap.result);
    setLatexText(snap.latexText);
    setHealResult(snap.healResult);
    setAlignResult(snap.alignResult);
    setInjectResult(snap.injectResult);
    setError(null);
  };

  const handleRecognize = async () => {
    if (!imageBase64) return;
    setIsLoading(true);
    setError(null);
    setHealResult(null);
    try {
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, inputType, projectId: null }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
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

  const handleHeal = async (convertToBooktabs: boolean) => {
    if (!latexText) return;
    setIsHealing(true);
    setError(null);
    try {
      const resp = await fetch(HEAL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latexCode: latexText, convertToBooktabs }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const body: HealApiResponse = await resp.json();
      if (body.code === 200) {
        setLatexText(body.data.healedLatex);
        setHealResult(body.data.astValidationResult);
        if (result) {
          setResult({
            ...result,
            requiredPackages: body.data.requiredPackages,
            healedLatex: body.data.healedLatex,
          });
        }
      } else {
        setError(body.message || "语法自愈失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络请求失败");
    } finally {
      setIsHealing(false);
    }
  };

  const handleAlignNotation = async () => {
    if (!latexText) return;
    setIsAligning(true);
    setError(null);
    try {
      const resp = await fetch(ALIGN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawLatex: latexText, notationMap, customInstruction: customInstruction || null }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const body: AlignApiResponse = await resp.json();
      if (body.code === 200) {
        setAlignResult(body.data);
      } else {
        setError(body.message || "符号对齐失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络请求失败");
    } finally {
      setIsAligning(false);
    }
  };

  const handleInjectTable = async () => {
    if (!latexText) return;
    setIsInjecting(true);
    setError(null);
    try {
      const resp = await fetch(INJECT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skeletonLatex: latexText, csvContent, metricDirections, decimalPlaces: 2 }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const body: InjectApiResponse = await resp.json();
      if (body.code === 200) {
        setInjectResult(body.data);
      } else {
        setError(body.message || "数据注入失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络请求失败");
    } finally {
      setIsInjecting(false);
    }
  };

  useEffect(() => {
    if (!result || inputType !== "FORMULA") return;
    let mf: any = null;
    let handler: (() => void) | null = null;
    let mounted = true;
    import("mathlive").then(() => {
      if (!mounted) return;
      mf = mathFieldRef.current;
      if (!mf) return;
      mf.value = latexText;
      handler = () => {
        isUpdatingFromMathField.current = true;
        setLatexText(mf.value);
      };
      mf.addEventListener("input", handler);
    });
    return () => {
      mounted = false;
      if (mf && handler) mf.removeEventListener("input", handler);
    };
  }, [result, inputType]);

  useEffect(() => {
    if (isUpdatingFromMathField.current) {
      isUpdatingFromMathField.current = false;
      return;
    }
    const mf = mathFieldRef.current as any;
    if (mf) mf.value = latexText;
  }, [latexText]);

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

  const tableHtml = useMemo(() => {
    if (latexText.includes("\\begin{tabular}")) {
      return { __html: parseLatexTable(latexText) };
    }
    return null;
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
            <p className="text-xs text-slate-500">v0.3 · LangGraph 智能体：符号对齐 + CSV 极值注入</p>
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
              <label className="mb-3 block text-sm font-medium text-slate-700">识别模式</label>
              <div className="flex gap-2">
                {modeOptions.map((opt) => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleModeSwitch(opt.value)}
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
                  isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300 hover:border-slate-400"
                }`}
              >
                {imageBase64 ? (
                  <div className="w-full">
                    <img src={`data:image/png;base64,${imageBase64}`} alt="预览" className="mx-auto max-h-48 rounded" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setImageBase64(null);
                        setResult(null);
                        setLatexText("");
                        setHealResult(null);
                      }}
                      className="mt-2 text-xs text-red-500 hover:underline"
                    >
                      移除图片
                    </button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-10 w-10 text-slate-400" />
                    <p className="mt-2 text-sm text-slate-600">点击、拖拽或粘贴 (Cmd+V / Ctrl+V) 上传图片</p>
                    <p className="mt-1 text-xs text-slate-400">支持 PNG / JPG 等常见图片格式</p>
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
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {result && (
              <>
                {result.requiredPackages.length > 0 && (
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">导言区宏包</span>
                      <button onClick={() => { copyToClipboard(`\\usepackage{${result.requiredPackages.join(", ")}}`); setCopiedPackage(true); setTimeout(() => setCopiedPackage(false), 2000); }} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                        {copiedPackage ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copiedPackage ? "已复制" : "复制 usepackage"}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {result.requiredPackages.map((pkg) => (
                        <span key={pkg} className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">{"\\usepackage{" + pkg + "}"}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">LaTeX 源码</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400">置信度: {(result.confidenceScore * 100).toFixed(1)}%</span>
                      <button onClick={() => { copyToClipboard(latexText); setCopiedLatex(true); setTimeout(() => setCopiedLatex(false), 2000); }} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                        {copiedLatex ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copiedLatex ? "已复制" : "一键复制 LaTeX"}
                      </button>
                    </div>
                  </div>
                  <textarea value={latexText} onChange={(e) => setLatexText(e.target.value)} className="h-40 w-full resize-none rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500" spellCheck={false} />
                </div>

                {isTable && (
                  <div className="flex gap-2">
                    <button onClick={() => handleHeal(true)} disabled={isHealing} className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
                      {isHealing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                      一键转为纯 Booktabs 三线表
                    </button>
                    <button onClick={() => handleHeal(false)} disabled={isHealing} className="flex items-center gap-1.5 rounded-md bg-slate-700 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50">
                      {isHealing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                      AST 语法自愈检查
                    </button>
                  </div>
                )}

                {healResult && (
                  <div className={`rounded-lg border p-3 text-xs ${healResult.isValid ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                    <div className="flex items-center gap-1.5 font-medium">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {healResult.isValid ? "AST 校验通过" : "AST 校验发现问题"}
                    </div>
                    {healResult.errors.length > 0 && (
                      <ul className="mt-1.5 ml-5 list-disc space-y-0.5">
                        {healResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    )}
                    {healResult.warnings.length > 0 && (
                      <ul className="mt-1.5 ml-5 list-disc space-y-0.5">
                        {healResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="space-y-4">
            {!result ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-12">
                <ClipboardIcon className="h-12 w-12 text-slate-300" />
                <p className="mt-3 text-sm text-slate-400">上传图片并点击识别后，结果将在此展示</p>
              </div>
            ) : (
              <>
                {/* 渲染预览区 */}
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <span className="mb-3 block text-sm font-medium text-slate-700">实时渲染预览</span>
                  {isTable ? (
                    <div className="space-y-3">
                      {tableHtml && (
                        <div
                          className="overflow-x-auto rounded-md bg-slate-50 p-4"
                          dangerouslySetInnerHTML={tableHtml}
                        />
                      )}
                      <details className="text-xs text-slate-400">
                        <summary className="cursor-pointer hover:text-slate-600">查看 LaTeX 源码结构</summary>
                        <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-slate-600">{latexText}</pre>
                      </details>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <span className="mb-1 block text-xs text-slate-400">MathLive 可视化编辑器（双向同步）</span>
                        <math-field
                          ref={mathFieldRef}
                          className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2"
                          style={{ "--primary": "#2563eb" } as React.CSSProperties}
                        />
                      </div>
                      <div
                        className="flex min-h-[80px] items-center justify-center overflow-x-auto rounded-md bg-slate-50 p-4"
                        dangerouslySetInnerHTML={renderedHtml}
                      />
                    </div>
                  )}
                </div>

                {!isTable && latexText && (
                  <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 space-y-3">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-indigo-700">
                      <Sigma className="h-4 w-4" />
                      论文全局符号体系对齐 &amp; PyTorch 代码生成 (LangGraph Agent)
                    </div>
                    <div className="space-y-2">
                      {notationMap.map((entry, idx) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <input value={entry.sourceSymbol} onChange={(e) => { const u = [...notationMap]; u[idx] = { ...u[idx], sourceSymbol: e.target.value }; setNotationMap(u); }} placeholder="原符号" className="w-28 rounded border border-slate-300 px-2 py-1 text-xs font-mono" />
                          <span className="text-slate-400">→</span>
                          <input value={entry.targetSymbol} onChange={(e) => { const u = [...notationMap]; u[idx] = { ...u[idx], targetSymbol: e.target.value }; setNotationMap(u); }} placeholder="目标符号" className="w-28 rounded border border-slate-300 px-2 py-1 text-xs font-mono" />
                          <input value={entry.semanticMeaning} onChange={(e) => { const u = [...notationMap]; u[idx] = { ...u[idx], semanticMeaning: e.target.value }; setNotationMap(u); }} placeholder="语义含义" className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs" />
                          <button onClick={() => setNotationMap(notationMap.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                        </div>
                      ))}
                      <button onClick={() => setNotationMap([...notationMap, { sourceSymbol: "", targetSymbol: "", semanticMeaning: "" }])} className="text-xs text-indigo-600 hover:underline">+ 添加映射行</button>
                    </div>
                    <input value={customInstruction} onChange={(e) => setCustomInstruction(e.target.value)} placeholder="自定义指令（可选）" className="w-full rounded border border-slate-300 px-2 py-1 text-xs" />
                    <button onClick={handleAlignNotation} disabled={isAligning} className="flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                      {isAligning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      一键对齐符号 &amp; 生成 PyTorch 代码
                    </button>
                    {alignResult && (
                      <div className="space-y-2">
                        <div className="rounded-md bg-white p-2 border border-slate-200">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-slate-600">对齐后 LaTeX 公式</span>
                            <div className="flex gap-2">
                              <button onClick={() => setLatexText(alignResult.alignedLatex)} className="text-xs text-blue-600 hover:underline">应用到主编辑器</button>
                              <button onClick={() => copyToClipboard(alignResult.alignedLatex)} className="text-xs text-blue-600 hover:underline">复制</button>
                            </div>
                          </div>
                          <pre className="whitespace-pre-wrap font-mono text-xs text-slate-700">{alignResult.alignedLatex}</pre>
                        </div>
                        <div className="rounded-md bg-white p-2 border border-slate-200">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-slate-600">英文论文说明句</span>
                            <button onClick={() => copyToClipboard(alignResult.notationExplanation)} className="text-xs text-blue-600 hover:underline">复制论文说明句</button>
                          </div>
                          <p className="text-xs text-slate-700 italic">{alignResult.notationExplanation}</p>
                        </div>
                        <div className="rounded-md bg-slate-900 p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-slate-300">PyTorch 代码</span>
                            <button onClick={() => copyToClipboard(alignResult.pytorchCode)} className="text-xs text-blue-400 hover:underline">一键复制 PyTorch 代码</button>
                          </div>
                          <pre className="whitespace-pre-wrap font-mono text-xs text-emerald-300">{alignResult.pytorchCode}</pre>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {isTable && latexText && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                      <TableIcon className="h-4 w-4" />
                      顶会三线表骨架剥离 &amp; CSV 实验数据智能注入 (LangGraph Agent)
                    </div>
                    <div>
                      <span className="mb-1 block text-xs text-slate-500">CSV 实验数据（每行一组，逗号分隔）</span>
                      <textarea value={csvContent} onChange={(e) => setCsvContent(e.target.value)} className="h-24 w-full resize-none rounded border border-slate-300 bg-white p-2 font-mono text-xs" spellCheck={false} />
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs text-slate-500">指标方向:</span>
                      {metricDirections.map((dir, idx) => (
                        <button key={idx} onClick={() => { const u = [...metricDirections]; u[idx] = dir === "MAX" ? "MIN" : "MAX"; setMetricDirections(u); }} className={`rounded px-2 py-1 text-xs font-medium ${dir === "MAX" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
                          列{idx + 1}: {dir === "MAX" ? "MAX ↑" : "MIN ↓"}
                        </button>
                      ))}
                      <button onClick={() => setMetricDirections([...metricDirections, "MAX"])} className="text-xs text-emerald-600 hover:underline">+ 添加列</button>
                    </div>
                    <button onClick={handleInjectTable} disabled={isInjecting} className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                      {isInjecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                      一键剥离旧数据并注入 CSV（自动加粗最优值）
                    </button>
                    {injectResult && (
                      <div className="space-y-2">
                        <button onClick={() => setLatexText(injectResult.injectedLatex)} className="w-full rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
                          应用到上方表格预览
                        </button>
                        <div className="rounded-md bg-white p-2 border border-slate-200">
                          <span className="text-xs font-medium text-slate-600">注入后 LaTeX</span>
                          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-slate-700">{injectResult.injectedLatex}</pre>
                        </div>
                        <details>
                          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">查看骨架 (Ri_Cj 模板)</summary>
                          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs text-slate-600">{injectResult.skeletonLatex}</pre>
                        </details>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
