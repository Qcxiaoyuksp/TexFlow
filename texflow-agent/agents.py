#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TexFlow 智能体工作流模块 (agents.py)
基于 LangGraph 实现两大核心工作流：
1. run_notation_align_agent: 符号体系对齐 + 生成英文解释 + 转 PyTorch 代码
2. run_table_inject_agent: 三线表骨架剥离 + CSV 实验数据极值注入
"""

import os
import re
import io
import csv
import json
from typing import List, Optional
from typing_extensions import TypedDict
from langgraph.graph import START, END, StateGraph
from mcp_latex_validator import build_table_skeleton


def _is_mock_mode() -> bool:
    api_key = os.getenv("ECLOUD_API_KEY", "").strip()
    return not api_key or api_key == "your_ecloud_api_key_here"


_PROTECTED_PATTERN = re.compile(
    r"\\(?:mathcal|mathbb|mathrm|mathbf|mathsf|mathtt|operatorname|text)\{[^}]*\}"
)


def _safe_latex_replace(latex: str, source: str, target: str) -> str:
    protected: List[str] = []

    def _protect(m):
        protected.append(m.group(0))
        return f"\x00P{len(protected) - 1}\x00"

    text = _PROTECTED_PATTERN.sub(_protect, latex)

    if source.startswith("\\"):
        pattern = re.escape(source) + r"(?![a-zA-Z])"
    else:
        pattern = r"(?<![a-zA-Z\\])" + re.escape(source) + r"(?![a-zA-Z])"
    text = re.sub(pattern, lambda _: target, text)

    for i, cmd in enumerate(protected):
        text = text.replace(f"\x00P{i}\x00", cmd)
    return text


def _extract_main_value(cell_str: str) -> float:
    s = str(cell_str).strip()
    match = re.match(r"([0-9]+\.?[0-9]*(?:[eE][-+]?[0-9]+)?)", s)
    if match:
        return float(match.group(1))
    return 0.0


def _format_cell_value(cell_str: str, decimal_places: int, is_best: bool, is_second: bool) -> str:
    s = str(cell_str).strip()
    main_match = re.match(r"([0-9]+\.?[0-9]*(?:[eE][-+]?[0-9]+)?)", s)
    if not main_match:
        return s
    main_val = float(main_match.group(1))
    formatted_main = f"{main_val:.{decimal_places}f}"

    std_match = re.search(r"(?:±|\\pm)\s*([0-9]+\.?[0-9]*)", s)
    if std_match:
        std_val = float(std_match.group(1))
        formatted_std = f"{std_val:.{decimal_places}f}"
        formatted = f"{formatted_main} ± {formatted_std}"
    else:
        formatted = formatted_main

    if is_best:
        return f"\\textbf{{{formatted}}}"
    elif is_second:
        return f"\\underline{{{formatted}}}"
    return formatted


class NotationAlignState(TypedDict):
    raw_latex: str
    notation_map: List[dict]
    custom_instruction: Optional[str]
    aligned_latex: str
    notation_explanation: str
    pytorch_code: str


def _safe_replace_node(state: NotationAlignState) -> dict:
    aligned = state["raw_latex"]
    for entry in state["notation_map"]:
        aligned = _safe_latex_replace(
            aligned, entry["sourceSymbol"], entry["targetSymbol"]
        )
    return {"aligned_latex": aligned}


def _vlm_explain_node(state: NotationAlignState) -> dict:
    aligned_latex = state["aligned_latex"]
    notation_map = state["notation_map"]

    if _is_mock_mode():
        parts = []
        for entry in notation_map:
            target = entry["targetSymbol"]
            meaning = entry["semanticMeaning"]
            parts.append(f"${target}$ denotes the {meaning}")
        explanation = "where " + ", ".join(parts) + "."

        code_lines = ["import torch", ""]
        for entry in notation_map:
            target = entry["targetSymbol"]
            meaning = entry["semanticMeaning"]
            var_name = re.sub(r"[\\{}]", "", target)
            code_lines.append(f"# {meaning}")
            code_lines.append(f"{var_name} = torch.randn(64, 128)")
            code_lines.append("")
        pytorch_code = "\n".join(code_lines).strip()
    else:
        from openai import OpenAI

        api_key = os.getenv("ECLOUD_API_KEY", "")
        base_url = os.getenv("ECLOUD_BASE_URL", "")
        model_name = os.getenv("ECLOUD_MODEL_NAME", "")
        if base_url.endswith("/chat/completions"):
            base_url = base_url[: -len("/chat/completions")]

        client = OpenAI(api_key=api_key, base_url=base_url)
        symbols_desc = "\n".join([
            f"- {e['sourceSymbol']} -> {e['targetSymbol']} ({e['semanticMeaning']})"
            for e in notation_map
        ])
        prompt = (
            f"Given the LaTeX formula: {aligned_latex}\n\n"
            f"Symbol mappings:\n{symbols_desc}\n\n"
            f"Generate JSON with two keys:\n"
            f'1. "notationExplanation": a concise English notation explanation starting with "where"\n'
            f'2. "pytorchCode": corresponding executable PyTorch tensor computation code\n'
        )
        response = client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=4096,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        raw = response.choices[0].message.content or "{}"
        try:
            parsed = json.loads(raw)
            explanation = parsed.get("notationExplanation", "")
            pytorch_code = parsed.get("pytorchCode", "")
        except json.JSONDecodeError:
            explanation = raw
            pytorch_code = ""

    return {"notation_explanation": explanation, "pytorch_code": pytorch_code}


def run_notation_align_agent(
    raw_latex: str,
    notation_map: List[dict],
    custom_instruction: Optional[str] = None,
) -> dict:
    workflow = StateGraph(NotationAlignState)
    workflow.add_node("safe_replace", _safe_replace_node)
    workflow.add_node("vlm_explain", _vlm_explain_node)
    workflow.add_edge(START, "safe_replace")
    workflow.add_edge("safe_replace", "vlm_explain")
    workflow.add_edge("vlm_explain", END)

    app = workflow.compile()
    result = app.invoke({
        "raw_latex": raw_latex,
        "notation_map": notation_map,
        "custom_instruction": custom_instruction,
        "aligned_latex": "",
        "notation_explanation": "",
        "pytorch_code": "",
    })
    return {
        "alignedLatex": result["aligned_latex"],
        "notationExplanation": result["notation_explanation"],
        "pytorchCode": result["pytorch_code"],
    }


class TableInjectState(TypedDict):
    skeleton_latex: str
    csv_content: str
    metric_directions: List[str]
    decimal_places: int
    injected_latex: str
    summary: dict


def _extract_skeleton_node(state: TableInjectState) -> dict:
    skeleton = state["skeleton_latex"]
    if "{{R" not in skeleton:
        result = build_table_skeleton(skeleton)
        skeleton = result["skeleton_latex"]
    return {"skeleton_latex": skeleton}


def _inject_data_node(state: TableInjectState) -> dict:
    skeleton = state["skeleton_latex"]
    csv_content = state["csv_content"]
    metric_directions = state["metric_directions"]
    decimal_places = state["decimal_places"]

    reader = csv.reader(io.StringIO(csv_content.strip()))
    csv_data = [row for row in reader if row]
    n_rows = len(csv_data)
    n_cols = len(csv_data[0]) if n_rows > 0 else 0

    col_values: List[List[float]] = [[] for _ in range(n_cols)]
    for row in csv_data:
        for j, cell in enumerate(row):
            col_values[j].append(_extract_main_value(cell))

    best_indices: List[int] = []
    second_indices: List[int] = []
    for j in range(n_cols):
        direction = metric_directions[j] if j < len(metric_directions) else "MAX"
        values = col_values[j]
        indexed = list(enumerate(values))
        if direction == "MIN":
            sorted_idx = sorted(indexed, key=lambda x: x[1])
        else:
            sorted_idx = sorted(indexed, key=lambda x: x[1], reverse=True)
        best_indices.append(sorted_idx[0][0] if len(sorted_idx) > 0 else -1)
        second_indices.append(sorted_idx[1][0] if len(sorted_idx) > 1 else -1)

    injected = skeleton
    for i, row in enumerate(csv_data):
        for j, cell in enumerate(row):
            slot = f"{{{{R{i+1}_C{j+1}}}}}"
            is_best = i == best_indices[j]
            is_second = i == second_indices[j]
            formatted = _format_cell_value(cell, decimal_places, is_best, is_second)
            injected = injected.replace(slot, formatted)

    summary = {
        "dataRows": n_rows,
        "dataCols": n_cols,
        "bestIndices": best_indices,
        "secondIndices": second_indices,
        "metricDirections": metric_directions,
    }
    return {"injected_latex": injected, "summary": summary}


def run_table_inject_agent(
    skeleton_latex: str,
    csv_content: str,
    metric_directions: List[str],
    decimal_places: int = 2,
) -> dict:
    workflow = StateGraph(TableInjectState)
    workflow.add_node("extract_skeleton", _extract_skeleton_node)
    workflow.add_node("inject_data", _inject_data_node)
    workflow.add_edge(START, "extract_skeleton")
    workflow.add_edge("extract_skeleton", "inject_data")
    workflow.add_edge("inject_data", END)

    app = workflow.compile()
    result = app.invoke({
        "skeleton_latex": skeleton_latex,
        "csv_content": csv_content,
        "metric_directions": metric_directions,
        "decimal_places": decimal_places,
        "injected_latex": "",
        "summary": {},
    })
    return {
        "injectedLatex": result["injected_latex"],
        "skeletonLatex": result["skeleton_latex"],
        "summary": result["summary"],
    }
