---
name: academic-latex-booktabs
description: 学术论文 LaTeX 公式清洗、符号体系对齐(NotationMap)与顶会 Booktabs 三线表生成及 CSV 实验数据极值注入规范。在编写 OCR Prompt、LaTeX 后处理正则、AST 校验及表格转换逻辑时自动触发。
---

# 学术公式与顶会三线表重构规范 (academic-latex-booktabs)

## 一、 触发时机 (When to Use)
当开发或调试以下任一模块时必须启用本技能：
1. 公式/三线表多模态识别 Prompt 与后处理清洗逻辑；
2. LaTeX AST 语法校验与宏包推断逻辑；
3. 论文全局符号体系对齐（`NotationAlignTask`）与公式转 PyTorch 代码逻辑；
4. 顶会三线表骨架剥离（`TableSkeleton`）与 CSV 实验数据自动填表加粗（`TableDataInjection`）逻辑。

## 二、 学术公式清洗与符号对齐硬性规范
1. **输出纯净度规范**：
   - 从大模型返回结果中提取 LaTeX 时，必须自动剥离外层的 ` ```latex ... ``` `、`$$...$$` 或 `\[...\]` 包裹符，仅保留核心数学表达式源码。
   - 多行对齐公式统一使用 `\begin{aligned} ... \end{aligned}`（配合外层 `equation` 环境），严禁生成已淘汰的 `\begin{eqnarray}`。
2. **符号体系对齐（Notation Alignment）规范**：
   - 在根据用户的 `NotationMap` 替换公式变量时，**必须基于 LaTeX Token 边界（如正则负向零宽断言 `(?<![a-zA-Z\\])`）或 AST 节点进行替换**。
   - **绝对禁止暴力字符串 `str.replace()`**（例如：把变量 `N` 替换为 `M` 时，绝不能把 `\mathcal{N}` 或 `\operatorname{LN}` 里的字母 `N` 误替换掉！）。
3. **宏包自动诊断规范**：
   - 凡输出包含 `\bm{}` 必须提示 `\usepackage{bm}`；包含 `\mathbb{}` 或 `\mathcal{}` 必须提示 `\usepackage{amssymb}`；包含 `\text{}` 或 `\begin{aligned}` 必须提示 `\usepackage{amsmath}`。

## 三、 顶会 Booktabs 三线表与 CSV 极值注入硬性规范
1. **顶会三线表排版铁律（IEEE / ACM / CVPR / NeurIPS 标准）**：
   - **竖线（`|`）处理规范**：CCF-A 论文表格常使用竖线分隔多组实验列。检测到竖线时给出友好提示（可选择保留原图竖线，或调用 `heal_and_normalize_latex(convert_to_booktabs=True)` 一键转换为无竖线 Booktabs 三线表）。顶会最终排版建议去除竖线。
   - **`\hline` 处理规范**：CCF-A 论文表格常使用 `\hline` 分隔行。`build_table_skeleton` 已兼容 `\hline`（首尾自动转换为 `\toprule`/`\bottomrule`，中间转换为 `\midrule`）。顶会最终排版建议使用 `booktabs` 宏包的：
     - 顶部粗线：`\toprule`
     - 表头与数据区分隔线：`\midrule`（局部多列分组下划线使用 `\cmidrule(lr){start-end}`）
     - 底部粗线：`\bottomrule`
   - 跨行/跨列合并单元格必须规范使用 `\multirow{行数}{*}{内容}` 与 `\multicolumn{列数}{c}{内容}`，并自动提示导言区引入 `\usepackage{booktabs, multirow}`。
2. **CSV 实验数据注入与最优/次优值自动标注算法规范**：
   - **支持“均值±标准差”解析**：科学实验表格常见 `92.45 ± 0.12` 或 `92.45\pm 0.12` 格式。在比较每列数值大小时，**必须先用正则提取 `±` 或 `\pm` 左侧的主均值浮点数进行比较**，严禁直接把整串字符串转 `float()` 导致崩溃！
   - **极值标注规则**：
     - 当该列指标方向为 `"MAX"`（越大越好，如 Accuracy、F1、PSNR）时：该列最大值包裹 `\textbf{...}`，次大值包裹 `\underline{...}`。
     - 当该列指标方向为 `"MIN"`（越小越好，如 Loss、MAE、RMSE、Params）时：该列最小值包裹 `\textbf{...}`，次小值包裹 `\underline{...}`。

## 四、 验证门禁 (Verification Gate)
编写完任何涉及 LaTeX 公式或三线表处理的代码后，**必须调用 `LaTeX-Validator-MCP` 中的 `validate_latex_syntax` 和 `extract_booktabs_skeleton` 工具进行实测**，确保生成的 LaTeX 花括号 100% 闭合且宏包提示完整。
