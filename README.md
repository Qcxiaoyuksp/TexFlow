# TexFlow：基于端云协同与多智能体的学术公式与三线表智能重构工作台

> **An Edge-Cloud Collaborative & Multi-Agent Workbench for Academic Formula & Booktabs Table Reconstruction**

## 核心特性 (Key Features)
- **端云协同双引擎路由 (`EdgeCloudRouter`)**：浏览器端基于 WebAssembly (`onnxruntime-web`) 运行 20M 轻量级公式识别模型实现 `<150ms` 零成本响应；复杂跨行矩阵与合并单元格三线表自动路由至云端多模态智能体。
- **双向可视化微调与 AST 语法自愈 (`AstValidationResult`)**：集成 `MathLive` 与 `KaTeX` 所见即所得编辑，内置 LaTeX AST 语法树校验器，自动诊断缺失宏包（如 `booktabs`、`multirow`、`amsmath`）并修复未闭合括号。
- **论文全局符号体系一键对齐 (`NotationAlignTask`)**：预设论文项目级符号字典（`NotationMap`），一键将参考文献公式无损映射为自身论文符号体系，并支持一键转换为可运行的 **PyTorch / NumPy** 张量代码。
- **顶会三线表骨架剥离与 CSV 实验数据注入 (`TableDataInjection`)**：从顶会论文表格截图中抽离纯净 `booktabs` 排版骨架（`TableSkeleton`），导入实验 CSV 数据自动填表，并自动识别每列最优值加粗（`\textbf{}`）与次优值下划线（`\underline{}`）。

## 系统架构与工程目录 (Project Structure)
- `texflow-web/`：`Next.js 14` + `TypeScript` + `TailwindCSS` + `MathLive` + `KaTeX` + `ONNX Runtime Web`
- `texflow-gateway/`：`Spring Boot 3.3` + `Java 21 (Virtual Threads)` + `Spring Security (JWT)` + `MyBatis-Plus` + `MySQL 8.0` + `Redis`
- `texflow-agent/`：`Python 3.11` + `FastAPI` + `LangGraph` + `Pandas` + 自研 `LaTeX-Validator-MCP`
- `.zhanlu/`：移动云湛卢原生 IDE 专属工程规则与领域 Skills
