import katex from "katex";

export type ExportFormat = "LATEX" | "OVERLEAF" | "WORD_MATHML" | "MARKDOWN" | "TYPST";

export interface ComplexityResult {
  complexityScore: number;
  recommendedRoute: "EDGE_ONNX" | "CLOUD_VLM";
  reason: string;
}

export function cleanupOcrSpaces(latex: string): string {
  let t = latex;
  t = t.replace(/\\(mathrm|mathcal|mathbb|mathbf|operatorname|text)\s*\{\s*([^}]*?)\s*\}/g, (_m, cmd, content) => {
    const cleaned = content.replace(/\s+/g, "");
    return `\\${cmd}{${cleaned}}`;
  });
  t = t.replace(/\s*_\s*\{\s*/g, "_{");
  t = t.replace(/\s*\^\s*\{\s*/g, "^{");
  t = t.replace(/\{\s*([^{}]*?)\s*\}/g, (match, content) => {
    if (content.length > 2 && /^[a-zA-Z0-9\s+\-.]+$/.test(content) && /\s{2,}/.test(content)) {
      return `{${content.replace(/\s+/g, "")}}`;
    }
    return match;
  });
  t = t.replace(/\s+([=+])\s*/g, " $1 ");
  return t;
}

function latexTableToMarkdown(latex: string): string {
  const match = latex.match(/\\begin\{tabular\}\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/);
  if (!match) return `$$\n${latex}\n$$`;
  const content = match[2];
  const rawRows = content.split("\\\\").map((r) => r.trim());
  let header: string[] | null = null;
  const bodyRows: string[][] = [];
  let inHeader = true;
  let firstHlineSeen = false;

  for (let row of rawRows) {
    if (row.match(/^\\(toprule|midrule|bottomrule|hline|cmidrule)/)) {
      if (row.includes("\\midrule")) inHeader = false;
      else if (row.includes("\\hline")) {
        if (firstHlineSeen) inHeader = false;
        else firstHlineSeen = true;
      }
      continue;
    }
    row = row.replace(/\\(toprule|midrule|bottomrule|hline|cmidrule\([^)]*\))/g, "").trim();
    if (!row) continue;
    const cells = row.split("&").map((c) => {
      let cell = c.trim();
      cell = cell.replace(/\\textbf\{([^}]*)\}/g, "**$1**");
      cell = cell.replace(/\\underline\{([^}]*)\}/g, "$1");
      cell = cell.replace(/\\multirow\{[^}]*\}\{[^}]*\}\{([^}]*)\}/g, "$1");
      cell = cell.replace(/\\multicolumn\{[^}]*\}\{[^}]*\}\{([^}]*)\}/g, "$1");
      cell = cell.replace(/\\text\{([^}]*)\}/g, "$1");
      cell = cell.replace(/\\mathrm\{([^}]*)\}/g, "$1");
      cell = cell.replace(/\\operatorname[\{ ]?([^}]*)\}?/g, "$1");
      cell = cell.replace(/\\[a-zA-Z]+(?![a-zA-Z])/g, "");
      cell = cell.replace(/[{}$]/g, "");
      return cell.trim();
    });
    if (inHeader) header = cells;
    else bodyRows.push(cells);
  }

  if (!header) return `$$\n${latex}\n$$`;
  const colCount = header.length;
  return [
    `| ${header.join(" | ")} |`,
    `| ${Array(colCount).fill("---").join(" | ")} |`,
    ...bodyRows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function latexToTypst(latex: string, isTable: boolean): string {
  if (isTable && latex.includes("\\begin{tabular}")) {
    const match = latex.match(/\\begin\{tabular\}\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/);
    if (match) {
      const colSpec = match[1].replace(/\|/g, "");
      const colCount = colSpec.length;
      const content = match[2];
      const rows = content.split("\\\\").map((r) => r.trim()).filter((r) => r && !r.match(/^\\(toprule|midrule|bottomrule|hline|cmidrule)/));
      const tableRows = rows.map((row) => {
        const cells = row.split("&").map((c) => {
          let cell = c.trim();
          cell = cell.replace(/\\textbf\{([^}]*)\}/g, "*$1*");
          cell = cell.replace(/\\underline\{([^}]*)\}/g, "_$1_");
          cell = cell.replace(/\\multirow\{[^}]*\}\{[^}]*\}\{([^}]*)\}/g, "$1");
          cell = cell.replace(/\\multicolumn\{[^}]*\}\{[^}]*\}\{([^}]*)\}/g, "$1");
          cell = cell.replace(/\\[a-zA-Z]+(?![a-zA-Z])/g, "");
          cell = cell.replace(/[{}$]/g, "");
          return cell.trim();
        });
        return cells.join(", ");
      });
      return `#table(\n  columns: ${colCount},\n${tableRows.map((r) => `  ${r}`).join(",\n")}\n)`;
    }
  }

  let t = cleanupOcrSpaces(latex);
  t = t.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)");
  t = t.replace(/\\sum_\{([^}]*)\}\^\{([^}]*)\}/g, "sum_($1)^($2)");
  t = t.replace(/\\sum_\{([^}]*)\}/g, "sum_($1)");
  t = t.replace(/\\sum(?![a-zA-Z])/g, "sum");
  t = t.replace(/\\operatorname\{([^}]*)\}/g, "$1");
  t = t.replace(/\\textbf\{([^}]*)\}/g, "*$1*");
  t = t.replace(/\\text\{([^}]*)\}/g, "$1");
  t = t.replace(/\\mathrm\{([^}]*)\}/g, "$1");
  t = t.replace(/\\sqrt\{([^}]*)\}/g, "sqrt($1)");
  t = t.replace(/\\left\(/g, "(");
  t = t.replace(/\\right\)/g, ")");
  t = t.replace(/\\times/g, "times");
  t = t.replace(/\\cdot/g, "dot");
  t = t.replace(/\\pm/g, "plus.minus");
  t = t.replace(/\\leq/g, "<=");
  t = t.replace(/\\geq/g, ">=");
  t = t.replace(/\\neq/g, "!=");
  t = t.replace(/\\approx/g, "approx");
  t = t.replace(/\\infty/g, "infinity");
  t = t.replace(/\\alpha(?![a-zA-Z])/g, "alpha");
  t = t.replace(/\\beta(?![a-zA-Z])/g, "beta");
  t = t.replace(/\\gamma(?![a-zA-Z])/g, "gamma");
  t = t.replace(/\\delta(?![a-zA-Z])/g, "delta");
  t = t.replace(/\\epsilon(?![a-zA-Z])/g, "epsilon");
  t = t.replace(/\\theta(?![a-zA-Z])/g, "theta");
  t = t.replace(/\\lambda(?![a-zA-Z])/g, "lambda");
  t = t.replace(/\\mu(?![a-zA-Z])/g, "mu");
  t = t.replace(/\\sigma(?![a-zA-Z])/g, "sigma");
  t = t.replace(/\\pi(?![a-zA-Z])/g, "pi");
  t = t.replace(/\\begin\{([^}]*)\}/g, "");
  t = t.replace(/\\end\{([^}]*)\}/g, "");
  t = t.replace(/\\[a-zA-Z]+(?![a-zA-Z])/g, "");
  t = t.replace(/[{}]/g, "");
  return t.trim();
}

export function exportLatexToFormat(
  latex: string,
  format: ExportFormat,
  requiredPackages: string[] = [],
  isTable: boolean = false
): string {
  switch (format) {
    case "LATEX":
      return latex;

    case "OVERLEAF": {
      const usepackageComment = requiredPackages.length > 0
        ? `% 导言区依赖: \\usepackage{${requiredPackages.join(", ")}}\n`
        : "";
      if (isTable) {
        return `${usepackageComment}\\begin{table}[htbp]\n  \\centering\n  \\caption{Experimental Results}\n  \\label{tab:results}\n${latex.split("\n").map((l) => `  ${l}`).join("\n")}\n\\end{table}`;
      }
      return `${usepackageComment}\\begin{equation}\n${latex}\n\\end{equation}`;
    }

    case "WORD_MATHML": {
      try {
        const html = katex.renderToString(latex, {
          output: "mathml",
          displayMode: true,
          throwOnError: false,
        });
        const mathmlMatch = html.match(/<math[^>]*>[\s\S]*<\/math>/);
        return mathmlMatch ? mathmlMatch[0] : html;
      } catch {
        return "<!-- MathML 渲染失败 -->";
      }
    }

    case "MARKDOWN": {
      if (isTable) return latexTableToMarkdown(latex);
      return `$$\n${latex}\n$$`;
    }

    case "TYPST":
      return latexToTypst(latex, isTable);

    default:
      return latex;
  }
}

export async function analyzeImageComplexity(imageBase64: string, inputType?: string): Promise<ComplexityResult> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve({ complexityScore: 0.5, recommendedRoute: "CLOUD_VLM", reason: "Canvas 不可用" });
        return;
      }
      const size = 100;
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);
      const imageData = ctx.getImageData(0, 0, size, size);
      const data = imageData.data;

      let inkPixels = 0;
      const rowInkCounts = new Array(size).fill(0);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = (y * size + x) * 4;
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          if (brightness < 200) {
            inkPixels++;
            rowInkCounts[y]++;
          }
        }
      }
      const inkRatio = inkPixels / (size * size);

      let rowCount = 0;
      let inRow = false;
      const threshold = size * 0.05;
      for (let y = 0; y < size; y++) {
        if (rowInkCounts[y] > threshold) {
          if (!inRow) {
            rowCount++;
            inRow = true;
          }
        } else {
          inRow = false;
        }
      }

      const aspectRatio = img.width / img.height;
      const complexityScore = Math.min(1.0, inkRatio * 5 + (rowCount > 3 ? 0.3 : 0));
      const isFormula = inputType === "FORMULA" || !inputType;
      const isSimple = isFormula
        ? (aspectRatio > 1.8 || rowCount <= 4)
        : (rowCount <= 2 && inkRatio < 0.15 && aspectRatio > 0.5);

      resolve({
        complexityScore: parseFloat(complexityScore.toFixed(3)),
        recommendedRoute: isSimple ? "EDGE_ONNX" : "CLOUD_VLM",
        reason: isSimple
          ? `单行/分式公式（墨迹占比 ${(inkRatio * 100).toFixed(1)}%，估计 ${rowCount} 行，宽高比 ${aspectRatio.toFixed(2)}），推荐端侧极速识别`
          : `复杂内容（墨迹占比 ${(inkRatio * 100).toFixed(1)}%，估计 ${rowCount} 行，宽高比 ${aspectRatio.toFixed(2)}），推荐云端大模型`,
      });
    };
    img.onerror = () => {
      resolve({ complexityScore: 0.5, recommendedRoute: "CLOUD_VLM", reason: "图片加载失败" });
    };
    img.src = `data:image/png;base64,${imageBase64}`;
  });
}
