---
name: texflow-stack-guard
description: TexFlow 项目的技术栈版本锁定、目录隔离、MCP 文档查询与异构接口守卫技能。在编写或修改任何前端(Next.js)、网关(Spring Boot 3)或智能体(FastAPI)代码时自动触发。
---

# TexFlow 技术栈与红线守卫 (texflow-stack-guard)

## 一、 触发时机 (When to Use)
当你在 `TexFlow` 项目中创建新文件、安装依赖、编写前后端接口或修改配置时，必须严格执行本技能中的约束。

## 二、 核心技术栈与版本锁定 (Strict Stack Lock)
1. **`texflow-web/` (前端与端侧推理)**
   - 必须使用 `Next.js 14 (App Router)` + `TypeScript` + `TailwindCSS`。
   - 公式可视化编辑统一使用 `mathlive`；公式渲染统一使用 `katex`；端侧推理统一使用 `onnxruntime-web`。
   - **禁止事项**：严禁混用 Pages Router (`pages/` 目录)；严禁在 SSR 服务端组件中直接初始化 `window` 或 `mathlive` Web Component（必须加上 `"use client"` 并使用动态导入或 `useEffect` 挂载）。
2. **`texflow-agent/` (Python AI Agent 与学术重构层)**
   - 必须使用 `Python 3.11+` + `FastAPI` + `Pydantic v2` (`model_validate` / `model_dump`，**严禁使用已废弃的 Pydantic v1 `.dict()` 或 `.parse_obj()`**)。
   - 多智能体编排使用 `langgraph`；表格数值处理使用 `pandas`。
   - 模型调用统一使用 `openai` 官方 Python SDK (`AsyncOpenAI`) 对接移动云兼容 OpenAI 格式的 `base_url` 与 `api_key`（从 `.env` 读取 `ECLOUD_API_KEY`、`ECLOUD_BASE_URL`、`ECLOUD_MODEL_NAME`）。
3. **`texflow-gateway/` (Java 核心业务网关)**
   - 必须使用 `Spring Boot 3.3+` + `Java 21` + `MyBatis-Plus` + `MySQL 8.0` + `Redis`。
   - **禁止事项**：Spring Boot 3 必须全部使用 `jakarta.*` 包名（如 `jakarta.servlet.*`、`jakarta.validation.*`），**严禁出现 `javax.*` 旧包名**！

## 三、 防幻觉与 MCP 联动检查清单 (Anti-Hallucination Checklist)
1. **写码前查文档**：不确定 `LangGraph`、`MathLive` 或 `Spring Boot 3` 的某个类/属性名时，**必须先调用 `Context7` MCP 查询最新文档**，绝不允许猜测 API。
2. **命名对齐检查**：所有接口 JSON 字段必须与项目根目录的 `GLOSSARY.md` 完全一致：
   - Python FastAPI 的 Pydantic 模型支持 `alias_generator=to_camel` 或直接使用与 `GLOSSARY.md` 一致的字段名。
   - 统一响应包装结构：`{"code": 200, "message": "success", "data": ...}`。
3. **保护本地忽略目录**：严禁操作或将临时文件写入 `docs/` 目录。

## 四、 交付验证门禁 (Verification Gate)
- 修改 Python 代码后：必须确保无语法错误，并提供对应的 `pytest` 或 `curl` 验证命令。
- 修改前端代码后：必须通过 `Playwright` MCP 或 `npm run build` 检查是否存在 TypeScript 类型报错。
