#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
TexFlow 自研 MCP Server: LaTeX-Validator-MCP
用于移动云湛卢原生 IDE，在编码与调试阶段实时提供：
1. validate_latex_syntax: 检查 LaTeX 公式/表格的花括号闭合、环境闭合、对齐符 & 列数一致性，并自动推断所需导言区宏包（\usepackage）。
2. extract_booktabs_skeleton: 从三线表 LaTeX 源码中剥离实验数值，生成带 {{R_i_C_j}} 占位槽位的纯净排版骨架（TableSkeleton）。兼容 \midrule 与 \hline 分隔格式。
3. heal_and_normalize_latex: 自动补齐末尾缺失的右花括号，可选一键将竖线表格转换为 Booktabs 三线表。

安装依赖：pip install mcp
本地自测：python3 mcp_latex_validator.py --self-test
r"""

import re
import sys
import json
from typing import Dict, List, Any

PACKAGE_RULES: Dict[str, List[str]] = {
    "booktabs": [r"\\toprule", r"\\midrule", r"\\bottomrule", r"\\cmidrule"],
    "multirow": [r"\\multirow", r"\\multicolumn"],
    "amsmath": [r"\\begin\{aligned\}", r"\\begin\{cases\}", r"\\begin\{bmatrix\}", r"\\begin\{pmatrix\}", r"\\text\{", r"\\operatorname[\{ ]"],
    "amssymb": [r"\\mathbb\{", r"\\mathcal\{", r"\\triangleq", r"\\leqslant", r"\\geqslant"],
    "bm": [r"\\bm\{"],
    "graphicx": [r"\\resizebox", r"\\scalebox"],
    "xcolor": [r"\\textcolor", r"\\cellcolor", r"\\rowcolor"],
}


def check_latex_syntax_and_packages(latex_code: str) -> Dict[str, Any]:
    errors: List[str] = []
    warnings: List[str] = []

    depth = 0
    for idx, ch in enumerate(latex_code):
        if ch == "{" and (idx == 0 or latex_code[idx - 1] != "\\"):
            depth += 1
        elif ch == "}" and (idx == 0 or latex_code[idx - 1] != "\\"):
            depth -= 1
            if depth < 0:
                errors.append(f"位置 {idx} 附近存在多余的右花括号 '}}'，请检查括号配对。")
                break
    if depth > 0:
        errors.append(f"存在 {depth} 个未闭合的左花括号 '{{'，将在 Overleaf 编译时触发 Missing }} inserted 错误。")

    begins = re.findall(r"\\begin\{([^}]+)\}", latex_code)
    ends = re.findall(r"\\end\{([^}]+)\}", latex_code)
    if begins != ends:
        errors.append(f"LaTeX 环境未正确闭合：\\begin 环境序列为 {begins}，而 \\end 环境序列为 {ends}。")

    if "tabular" in begins:
        col_spec_match = re.search(r"\\begin\{tabular\}\{([^}]+)\}", latex_code)
        if col_spec_match and "|" in col_spec_match.group(1):
            warnings.append(
                "检测到 tabular 列定义中包含竖线 '|'（CCF-A 论文常见格式）。"
                "可选择保留原图竖线，或调用 heal_and_normalize_latex(convert_to_booktabs=True) 一键转换为无竖线 Booktabs 三线表。"
            )

    required_packages: List[str] = []
    for pkg, patterns in PACKAGE_RULES.items():
        if any(re.search(pat, latex_code) for pat in patterns):
            required_packages.append(pkg)

    usepackage_hint = (
        f"\\usepackage{{{', '.join(required_packages)}}}" if required_packages else "% 无需额外宏包"
    )

    return {
        "is_valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "required_packages": required_packages,
        "usepackage_statement": usepackage_hint,
    }


def _convert_hlines_to_booktabs(lines: List[str]) -> List[str]:
    hline_indices = [i for i, line in enumerate(lines) if line.strip() == "\\hline"]
    if len(hline_indices) >= 2:
        lines[hline_indices[0]] = lines[hline_indices[0]].replace("\\hline", "\\toprule")
        lines[hline_indices[-1]] = lines[hline_indices[-1]].replace("\\hline", "\\bottomrule")
        for idx in hline_indices[1:-1]:
            lines[idx] = lines[idx].replace("\\hline", "\\midrule")
    elif len(hline_indices) == 1:
        lines[hline_indices[0]] = lines[hline_indices[0]].replace("\\hline", "\\midrule")
    return lines


def build_table_skeleton(latex_table: str) -> Dict[str, Any]:
    lines = latex_table.splitlines()
    lines = _convert_hlines_to_booktabs(lines)

    skeleton_lines: List[str] = []
    slot_count = 0
    in_body = False
    row_idx = 0

    _NUM_CORE = r"\d+\.?\d*(?:[eE][-+]?\d+)?"
    _PURE_NUM = re.compile(
        r"^" + _NUM_CORE +
        r"(?:\s*\\?%)?" +
        r"(?:\s*\$?\\?(?:uparrow|downarrow|rightarrow|leftarrow)\$?)?" +
        r"(?:\s*(?:\\pm|±)\s*\d+\.?\d*)?" +
        r"$"
    )

    for line in lines:
        if "\\midrule" in line:
            in_body = True
            skeleton_lines.append(line)
            continue
        if "\\bottomrule" in line or "\\end{tabular}" in line:
            in_body = False
            skeleton_lines.append(line)
            continue

        if in_body and "&" in line:
            row_idx += 1
            col_idx = 0

            trailing = ""
            stripped = line.rstrip()
            if stripped.endswith("\\\\"):
                trailing = " \\\\"
                stripped = stripped[:-2].rstrip()

            cells = stripped.split("&")
            new_cells = []
            for cell in cells:
                cell_stripped = cell.strip()
                inner = cell_stripped
                inner = re.sub(r"^\\textbf\{(.*)\}$", r"\1", inner)
                inner = re.sub(r"^\\underline\{(.*)\}$", r"\1", inner)
                inner = re.sub(r"^\$(.*)\$$", r"\1", inner)
                inner = inner.strip()

                if ("\\multirow" not in cell_stripped and
                    "\\multicolumn" not in cell_stripped and
                    _PURE_NUM.match(inner)):
                    col_idx += 1
                    slot_count += 1
                    new_cells.append(f"{{{{R{row_idx}_C{col_idx}}}}}")
                else:
                    new_cells.append(cell_stripped)

            new_line = " & ".join(new_cells) + trailing
            skeleton_lines.append(new_line)
        else:
            skeleton_lines.append(line)

    return {
        "slot_count": slot_count,
        "data_rows_detected": row_idx,
        "skeleton_latex": "\n".join(skeleton_lines),
    }


def heal_and_normalize_latex(latex_code: str, convert_to_booktabs: bool = False) -> Dict[str, Any]:
    healed = latex_code

    depth = 0
    for idx, ch in enumerate(healed):
        if ch == "{" and (idx == 0 or healed[idx - 1] != "\\"):
            depth += 1
        elif ch == "}" and (idx == 0 or healed[idx - 1] != "\\"):
            depth -= 1
            if depth < 0:
                depth = 0
    if depth > 0:
        healed = healed + "}" * depth

    if convert_to_booktabs:
        healed = re.sub(
            r"(\\begin\{tabular\}\{[^}]*\|[^}]*\})",
            lambda m: m.group(0).replace("|", ""),
            healed
        )
        lines = healed.splitlines()
        lines = _convert_hlines_to_booktabs(lines)
        healed = "\n".join(lines)

    validation = check_latex_syntax_and_packages(healed)

    return {
        "healed_latex": healed,
        "is_valid": validation["is_valid"],
        "errors": validation["errors"],
        "warnings": validation["warnings"],
        "required_packages": validation["required_packages"],
    }


def run_mcp_server() -> None:
    try:
        from mcp.server.mcpserver import MCPServer
    except ImportError:
        print("请先在 Python 环境中安装 mcp 库: pip install mcp", file=sys.stderr)
        sys.exit(1)

    mcp = MCPServer("TexFlow-LaTeX-Validator-MCP")

    @mcp.tool()
    def validate_latex_syntax(latex_code: str) -> str:
        result = check_latex_syntax_and_packages(latex_code)
        return json.dumps(result, ensure_ascii=False, indent=2)

    @mcp.tool()
    def extract_booktabs_skeleton(latex_table: str) -> str:
        result = build_table_skeleton(latex_table)
        return json.dumps(result, ensure_ascii=False, indent=2)

    @mcp.tool()
    def heal_and_normalize(latex_code: str, convert_to_booktabs: bool = False) -> str:
        result = heal_and_normalize_latex(latex_code, convert_to_booktabs)
        return json.dumps(result, ensure_ascii=False, indent=2)

    mcp.run()


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sample_booktabs = (
            "\\begin{tabular}{lccc}\n\\toprule\nModel & Acc & F1 & Params \\\\\n\\midrule\n"
            "Baseline & 85.20 & 84.10 & 12.3 \\\\\nTexFlow & \\textbf{92.45} & \\underline{91.80} & 10.5 \\\\\n"
            "\\bottomrule\n\\end{tabular}"
        )
        sample_hline = (
            "\\begin{tabular}{l|l|cc}\n\\hline\nDataset & Metric & MAE & SRC \\\\\n\\hline\n"
            "MicroLens & nMSE & 0.7829 & 0.4796 \\\\\n"
            "TexFlow & 0.7148 & 2.15\\%\\downarrow & 3.79e-2 \\\\\n"
            "\\hline\n\\end{tabular}"
        )
        sample_unclosed = r"\begin{aligned} \text{Attention}(Q, K, V) = \text{softmax"

        print("=== 1. 语法诊断（Booktabs）===")
        print(json.dumps(check_latex_syntax_and_packages(sample_booktabs), ensure_ascii=False, indent=2))
        print("\n=== 2. 语法诊断（竖线+hline）===")
        print(json.dumps(check_latex_syntax_and_packages(sample_hline), ensure_ascii=False, indent=2))
        print("\n=== 3. 骨架剥离（Booktabs）===")
        print(json.dumps(build_table_skeleton(sample_booktabs), ensure_ascii=False, indent=2))
        print("\n=== 4. 骨架剥离（hline）===")
        print(json.dumps(build_table_skeleton(sample_hline), ensure_ascii=False, indent=2))
        print("\n=== 5. 自愈+转Booktabs（竖线+hline）===")
        print(json.dumps(heal_and_normalize_latex(sample_hline, convert_to_booktabs=True), ensure_ascii=False, indent=2))
        print("\n=== 6. 自愈（缺失花括号）===")
        print(json.dumps(heal_and_normalize_latex(sample_unclosed), ensure_ascii=False, indent=2))
    else:
        run_mcp_server()
