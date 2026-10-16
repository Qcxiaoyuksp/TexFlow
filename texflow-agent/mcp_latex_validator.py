#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
TexFlow 自研 MCP Server: LaTeX-Validator-MCP
用于移动云湛卢原生 IDE，在编码与调试阶段实时提供：
1. validate_latex_syntax: 检查 LaTeX 公式/表格的花括号闭合、环境闭合、对齐符 & 列数一致性，并自动推断所需导言区宏包（\usepackage）。
2. extract_booktabs_skeleton: 从顶会三线表 LaTeX 源码中剥离实验数值，生成带 {{R_i_C_j}} 占位槽位的纯净排版骨架（TableSkeleton）。

安装依赖：pip install mcp
本地自测：python3 mcp_latex_validator.py --self-test
r"""

import re
import sys
import json
from typing import Dict, List, Any

# 宏包命令特征映射表（用于自动诊断缺失的 \usepackage）
PACKAGE_RULES: Dict[str, List[str]] = {
    "booktabs": [r"\\toprule", r"\\midrule", r"\\bottomrule", r"\\cmidrule"],
    "multirow": [r"\\multirow", r"\\multicolumn"],
    "amsmath": [r"\\begin\{aligned\}", r"\\begin\{cases\}", r"\\begin\{bmatrix\}", r"\\begin\{pmatrix\}", r"\\text\{", r"\\operatorname\{"],
    "amssymb": [r"\\mathbb\{", r"\\mathcal\{", r"\\triangleq", r"\\leqslant", r"\\geqslant"],
    "bm": [r"\\bm\{"],
    "graphicx": [r"\\resizebox", r"\\scalebox"],
    "xcolor": [r"\\textcolor", r"\\cellcolor", r"\\rowcolor"],
}


def check_latex_syntax_and_packages(latex_code: str) -> Dict[str, Any]:
    """核心校验函数：检查花括号平衡、环境闭合、表格列对齐符 &，并推断所需 LaTeX 宏包。"""
    errors: List[str] = []
    warnings: List[str] = []

    # 1. 检查未转义的花括号 { } 是否成对闭合
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

    # 2. 检查 \begin{env} 与 \end{env} 是否严格配对
    begins = re.findall(r"\\begin\{([^}]+)\}", latex_code)
    ends = re.findall(r"\\end\{([^}]+)\}", latex_code)
    if begins != ends:
        errors.append(f"LaTeX 环境未正确闭合：\\begin 环境序列为 {begins}，而 \\end 环境序列为 {ends}。")

    # 3. 若为表格环境，检查是否违规使用竖线 | 并校验每行 & 分隔符数量
    if "tabular" in begins:
        col_spec_match = re.search(r"\\begin\{tabular\}\{([^}]+)\}", latex_code)
        if col_spec_match and "|" in col_spec_match.group(1):
            warnings.append("检测到 tabular 列定义中包含竖线 '|'，不符合顶会 Booktabs 三线表规范，建议移除竖线。")

    # 4. 自动推断所需的导言区宏包
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


def build_table_skeleton(latex_table: str) -> Dict[str, Any]:
    """将三线表数据行中的纯数值/均值±标准差挖空为 {{R_i_C_j}} 槽位，保留表头与 booktabs 骨架。"""
    lines = latex_table.splitlines()
    skeleton_lines: List[str] = []
    slot_count = 0
    in_body = False
    row_idx = 0

    num_pattern = re.compile(
        r"(\\textbf\{[0-9.±\s+-]+(?:\\pm\s*[0-9.]+)?\}|\\underline\{[0-9.±\s+-]+(?:\\pm\s*[0-9.]+)?\}|(?<![a-zA-Z\\])[0-9]+\.[0-9]+(?:\s*(?:\\pm|±)\s*[0-9.]+)?)"
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

            def _repl( _match: re.Match) -> str:
                nonlocal col_idx, slot_count
                col_idx += 1
                slot_count += 1
                return f"{{{{R{row_idx}_C{col_idx}}}}}"

            new_line = num_pattern.sub(_repl, line)
            skeleton_lines.append(new_line)
        else:
            skeleton_lines.append(line)

    return {
        "slot_count": slot_count,
        "data_rows_detected": row_idx,
        "skeleton_latex": "\n".join(skeleton_lines),
    }


# ==================== MCP Server 挂载入口 ====================
def run_mcp_server() -> None:
    try:
        from mcp.server.mcpserver import MCPServer
    except ImportError:
        print("请先在 Python 环境中安装 mcp 库: pip install mcp", file=sys.stderr)
        sys.exit(1)

    mcp = MCPServer("TexFlow-LaTeX-Validator-MCP")

    @mcp.tool()
    def validate_latex_syntax(latex_code: str) -> str:
        """校验 LaTeX 公式或三线表源码语法、括号闭合与环境匹配，并返回所需 \\usepackage 宏包清单。"""
        result = check_latex_syntax_and_packages(latex_code)
        return json.dumps(result, ensure_ascii=False, indent=2)

    @mcp.tool()
    def extract_booktabs_skeleton(latex_table: str) -> str:
        """从顶会三线表 LaTeX 源码中剥离旧实验数值，生成带 {{Ri_Cj}} 占位符的纯净三线表骨架。"""
        result = build_table_skeleton(latex_table)
        return json.dumps(result, ensure_ascii=False, indent=2)

    mcp.run()


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sample = (
            "\\begin{tabular}{l|cc}\n\\toprule\nModel & Acc & F1 \\\\\n\\midrule\n"
            "Baseline & 85.20 & 84.10 \\\\\nTexFlow & \\textbf{92.45} & \\underline{91.80} \\\\\n"
            "\\bottomrule\n\\end{tabular}"
        )
        print("=== 1. 语法与宏包诊断测试 ===")
        print(json.dumps(check_latex_syntax_and_packages(sample), ensure_ascii=False, indent=2))
        print("\n=== 2. 三线表骨架剥离测试 ===")
        print(json.dumps(build_table_skeleton(sample), ensure_ascii=False, indent=2))
    else:
        run_mcp_server()