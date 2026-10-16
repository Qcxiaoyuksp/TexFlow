# TexFlow 项目全局开发规则 (AGENTS.md)

> **适用范围**：本规则文件置于 `TexFlow/` 项目根目录（并同步至 `.zhanlu/rules/`），作为移动云湛卢原生 IDE 与所有 AI Coding Agent（GLM 5.2 / DeepSeek V4 Flash）的最高优先级工程准则。

---

## 一、 项目定位与目录边界（严禁跨目录乱放文件）

本项目为 **《TexFlow：基于端云协同与多智能体的学术公式与三线表智能重构工作台》**，仓库根目录固定包含以下三个核心工程子目录（`docs/` 为本地比赛申报文档目录，已被 `.gitignore` 忽略）：

1. `texflow-web/`：**前端交互与端侧推理层**
   - 技术栈：`Next.js 14 (App Router)` + `React 18` + `TypeScript 5` + `TailwindCSS` + `MathLive` + `KaTeX` + `onnxruntime-web`。
2. `texflow-agent/`：**AI Agent 协同与学术重构微服务（Python）**
   - 技术栈：`Python 3.11` + `FastAPI` + `LangGraph` + `Pydantic v2` + `Pandas` + `SymPy / pylatexenc`。
3. `texflow-gateway/`：**核心业务与高并发网关层（Java）**
   - 技术栈：`Spring Boot 3.3` + `Java 21 (Virtual Threads)` + `Spring Security (JWT)` + `MyBatis-Plus` + `MySQL 8.0` + `Redis` + `Resilience4j`。

---

## 二、 命名与领域模型强制约定

1. 在编写任何前后端接口、数据库表结构、JSON 字段或变量名前，**必须先读取根目录下的 `GLOSSARY.md`**。
2. 严禁自创同义词（例如：全局符号字典统一命名为 `NotationMap` / `notation_map`，严禁混用 `symbol_dict`、`var_mapping` 等不一致命名）。

---

## 三、 MCP 工具强制路由指令（防上下文撑爆与防 API 幻觉）

当前环境已挂载 4 个 MCP Server（`context7`、`firecrawl`、`playwright`、`latex-validator`），调用时必须严格遵守以下优先级：

1. **查开源库/框架用法 → 强制优先调用 `Context7` MCP**：
   - 当需要编写或排查 `Next.js 14`、`FastAPI`、`LangGraph`、`Spring Boot 3`、`MathLive`、`KaTeX`、`onnxruntime-web` 等第三方库代码时，**必须先调用 `Context7` MCP 获取最新官方文档与代码示例**，严禁凭训练记忆臆造过时或不存在的 API。
2. **抓取特定参考网页 → 仅在用户提供明确 URL 时调用 `Firecrawl` MCP**：
   - **严禁主动使用 `Firecrawl` 进行宽泛的全网搜索或整站爬取**（以免返回数万字无用网页内容撑爆上下文并浪费 Token）。仅当我明确提供某个具体 URL（如 GitHub README 链接）让你参考时，才允许调用 `Firecrawl` MCP，且必须设置 `onlyMainContent: true` 仅提取正文 Markdown。
3. **验证前端页面渲染与交互 → 调用 `Playwright` MCP**：
   - 每当完成 `texflow-web` 前端组件修改后，优先通过 `Playwright` MCP 访问本地开发服务器（如 `http://localhost:3000`），检查控制台（Console）是否有报错、KaTeX 公式与表格是否正常渲染。
4. **验证 LaTeX 语法正则与三线表骨架逻辑 → 调用自研 `LaTeX-Validator-MCP`**：
   - 在编写或调试涉及 LaTeX 语法修复、宏包推断或三线表数据挖空的代码与 Prompt 时，必须调用 `validate_latex_syntax` 或 `extract_booktabs_skeleton` 工具进行实测验证。

---

## 四、 结合 `addyosmani/agent-skills` 的切片式开发铁律

针对当前模型（GLM 5.2 / DeepSeek V4 Flash）特性，开发任何功能时必须遵循**“小步垂直切片（Thin Vertical Slices）”**原则：

1. **先报备方案，后动手写码（Spec & Plan First）**：
   - 收到开发需求后，**禁止直接生成大段代码**。必须先用不超过 8 行中文列出：① 本次拟创建/修改的文件路径（**单次绝不超过 3 个文件**）；② 接口入参/出参格式；③ 验证方式。经我确认“可以”后再生成代码。
2. **每次只改一个原子功能，强制附带验证命令（Prove It Works）**：
   - 每次交付代码后，必须在回复末尾给出明确的三项说明：
     - **文件路径**：代码保存在哪个具体文件；
     - **一键验证命令**：我在终端运行的测试命令（如 `pytest tests/test_xxx.py` 或 `curl` 命令）；
     - **核心原理解析**：用 3 句话向我讲清楚这段代码的核心设计（方便我理解并应对后续技术面试）。
3. **报错先定位，严禁盲目重写（Stop-the-Line Debugging）**：
   - 当遇到报错时，必须先分析堆栈原因并只修改出错的最小代码行，**严禁推翻已经跑通的其他函数或随意删减已有功能**。
4. **每跑通一个切片提醒我 Git 提交**：
   - 当测试通过后，主动提供一句规范的 Git Commit 命令（如 `git add . && git commit -m "feat(agent): implement booktabs skeleton extractor"`）。
