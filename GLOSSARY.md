# TexFlow 领域词汇表与统一命名契约 (GLOSSARY.md)

> **设计目的（借鉴 Matt Pocock `grill-me` / `GLOSSARY.md` 最佳实践）**：
> 消除多模型（GLM 5.2 / DeepSeek V4 Flash）在跨会话、跨语言（TypeScript / Java / Python）开发时的“命名精神分裂”。前后端代码、数据库列名、API JSON 字段必须 **100% 严格复用本表定义的英文标识符**。

---

## 一、 核心业务领域概念（Ubiquitous Language）

| 中文标准术语 | 英文统一标识符 (PascalCase) | 代码变量/JSON字段 (camelCase / snake_case) | 精确定义与业务边界（AI 严禁混淆） |
| :--- | :--- | :--- | :--- |
| **端云路由引擎** | `EdgeCloudRouter` | `edgeCloudRouter` / `edge_cloud_router` | 根据上传图片的视觉复杂度，决定走浏览器端 ONNX (`EDGE_ONNX`) 还是云端大模型 Token (`CLOUD_VLM`) 的分流器。 |
| **端侧轻量识别** | `EdgeFormulaOcr` | `edgeFormulaOcr` / `edge_formula_ocr` | 在浏览器 WebWorker 中通过 `onnxruntime-web` 运行 20M 参数 `Texo` 模型，仅处理常规单行印刷公式。 |
| **语法自愈结果** | `AstValidationResult` | `astValidationResult` / `ast_validation_result` | 对识别出的 LaTeX 源码进行花括号、环境、`&` 对齐符检查及自动修复后的返回对象，含缺失宏包列表 `requiredPackages`。 |
| **论文项目空间** | `PaperProject` | `paperProject` / `paper_project` | 用户为某一篇具体论文创建的独立工作区，挂载该论文专属的“全局符号字典”与历史公式/表格记录。 |
| **全局符号字典** | `NotationMap` | `notationMap` / `notation_map` | 用户在 `PaperProject` 中定义的符号映射规则集合（例如将外部文献的 `\theta` 映射为本论文的 `W`）。 |
| **符号对齐任务** | `NotationAlignTask` | `notationAlignTask` / `notation_align_task` | 将原始公式 `rawLatex` 按照 `NotationMap` 批量无损替换变量，并生成英文上下文解释 `notationExplanation` 及 `pytorchCode` 的过程。 |
| **三线表骨架** | `TableSkeleton` | `tableSkeleton` / `table_skeleton` | 从参考论文三线表截图中剥离旧实验数值后，仅保留 `\toprule/\midrule/\bottomrule`、表头与 `{{Ri_Cj}}` 数据槽位的纯净模板。 |
| **实验数据注入** | `TableDataInjection` | `tableDataInjection` / `table_data_injection` | 将用户上传的 CSV/Excel 实验数值填入 `TableSkeleton` 槽位，并自动把每列最优值加粗（`\textbf`）、次优值加下划线（`\underline`）的操作。 |

---

## 二、 跨语言核心数据结构与字段契约（JSON / DB 对齐）

### 1. 公式/表格识别与自愈对象 (`OcrRecord`)
- `recordId` (`record_id`): 记录唯一 ID（UUID 或雪花 ID）
- `projectId` (`project_id`): 所属论文项目空间 ID
- `inputType` (`input_type`): 输入类型枚举，仅限 `"FORMULA"`（公式）、`"TABLE"`（三线表）、`"MIXED"`（图文混排）
- `routeMode` (`route_mode`): 实际执行的推理引擎，仅限 `"EDGE_ONNX"` 或 `"CLOUD_VLM"`
- `rawLatex` (`raw_latex`): 初始识别出的 LaTeX 源码字符串
- `healedLatex` (`healed_latex`): 经 AST 语法自愈后的合法 LaTeX 源码字符串
- `requiredPackages` (`required_packages`): 字符串数组，如 `["booktabs", "multirow", "amsmath"]`
- `confidenceScore` (`confidence_score`): 识别置信度（`0.0` ~ `1.0` 浮点数）

### 2. 全局符号字典项 (`NotationEntry`)
- `sourceSymbol` (`source_symbol`): 参考文献中的原符号（如 `"\\theta"`）
- `targetSymbol` (`target_symbol`): 用户自己论文中的目标符号（如 `"\\mathbf{W}"`）
- `semanticMeaning` (`semantic_meaning`): 该符号的物理/数学含义（如 `"learnable weight matrix"`）

### 3. 三线表实验数据注入请求 (`TableInjectPayload`)
- `skeletonLatex` (`skeleton_latex`): 带有 `{{Ri_Cj}}` 占位符的三线表骨架代码
- `csvContent` (`csv_content`): 用户粘贴或上传的 CSV 原始文本
- `metricDirections` (`metric_directions`): 字符串数组，标记每一列指标是越大越好（`"MAX"`）还是越小越好（`"MIN"`），用于决定哪个数加 `\textbf{}` 最优加粗和 `\underline{}` 次优下划线
- `decimalPlaces` (`decimal_places`): 统一保留的小数位数（默认 `2`）

---

## 三、 统一 API 路由前缀规范

1. **Spring Boot 3 业务网关 (`texflow-gateway`，端口 `8080`)**：
   - `/api/v1/auth/*`：用户登录、注册、JWT 刷新
   - `/api/v1/projects/*`：`PaperProject` 与 `NotationMap` 的增删改查
   - `/api/v1/workspace/*`：接收前端 AI 请求，校验并扣减 Redis Token 配额后转发给 Python 服务
2. **Python FastAPI 智能体服务 (`texflow-agent`，端口 `8000`)**：
   - `POST /internal/v1/ocr/recognize`：多模态公式/三线表识别与 AST 自愈
   - `POST /internal/v1/agent/align-notation`：符号体系一键对齐 + 生成 `where...` 英文解释 + 转 PyTorch 代码
   - `POST /internal/v1/agent/inject-table`：三线表骨架剥离 + CSV 实验数据自动填充与极值加粗
