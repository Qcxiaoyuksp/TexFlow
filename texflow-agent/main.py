import os
import re
import uuid
from pathlib import Path
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_PATH)

from mcp_latex_validator import check_latex_syntax_and_packages, heal_and_normalize_latex
from agents import run_notation_align_agent, run_table_inject_agent

app = FastAPI(title="TexFlow Agent", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class OcrRequest(BaseModel):
    imageBase64: str
    inputType: Literal["FORMULA", "TABLE", "MIXED"] = "FORMULA"
    projectId: Optional[str] = None


class OcrRecord(BaseModel):
    recordId: str
    inputType: str
    routeMode: str
    rawLatex: str
    healedLatex: str
    requiredPackages: list[str]
    confidenceScore: float


class ApiResponse(BaseModel):
    code: int
    message: str
    data: Optional[OcrRecord] = None


class HealRequest(BaseModel):
    latexCode: str
    convertToBooktabs: bool = False


class AstValidationResult(BaseModel):
    isValid: bool
    errors: list[str]
    warnings: list[str]


class HealData(BaseModel):
    healedLatex: str
    astValidationResult: AstValidationResult
    requiredPackages: list[str]


class HealResponse(BaseModel):
    code: int
    message: str
    data: Optional[HealData] = None


class NotationEntry(BaseModel):
    sourceSymbol: str
    targetSymbol: str
    semanticMeaning: str


class AlignNotationRequest(BaseModel):
    rawLatex: str
    notationMap: list[NotationEntry]
    customInstruction: Optional[str] = None


class AlignNotationData(BaseModel):
    alignedLatex: str
    notationExplanation: str
    pytorchCode: str


class AlignNotationResponse(BaseModel):
    code: int
    message: str
    data: Optional[AlignNotationData] = None


class TableInjectRequest(BaseModel):
    skeletonLatex: str
    csvContent: str
    metricDirections: list[str]
    decimalPlaces: int = 2


class TableInjectData(BaseModel):
    injectedLatex: str
    skeletonLatex: str
    summary: dict


class TableInjectResponse(BaseModel):
    code: int
    message: str
    data: Optional[TableInjectData] = None


MOCK_FORMULA_LATEX = (
    r"\begin{aligned}"
    r"\text{Attention}(Q, K, V) &= \text{softmax}\left(\frac{Q K^{\mathrm{T}}}{\sqrt{d_k}}\right) V"
    r"\end{aligned}"
)

MOCK_TABLE_LATEX = (
    r"\begin{tabular}{lccc}"
    "\n" + r"\toprule"
    "\n" + r"Method & Accuracy & F1 & Params \\"
    "\n" + r"\midrule"
    "\n" + r"Baseline & 85.20 & 84.10 & 12.3 \\"
    "\n" + r"TexFlow & \textbf{92.45} & \underline{91.80} & 10.5 \\"
    "\n" + r"\bottomrule"
    "\n" + r"\end{tabular}"
)


def _is_mock_mode() -> bool:
    api_key = os.getenv("ECLOUD_API_KEY", "").strip()
    return not api_key or api_key == "your_ecloud_api_key_here"


def _strip_latex_wrappers(raw: str) -> str:
    text = raw.strip()
    fence_pattern = r"^```(?:latex|tex)?\s*\n?(.*?)\n?```\s*$"
    m = re.match(fence_pattern, text, re.DOTALL)
    if m:
        text = m.group(1).strip()
    if text.startswith("$$") and text.endswith("$$") and len(text) > 4:
        text = text[2:-2].strip()
    if text.startswith(r"\[") and text.endswith(r"\]") and len(text) > 4:
        text = text[2:-2].strip()
    text = re.sub(r"^```\w*\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


def _build_record(raw_latex: str, input_type: str, route_mode: str, confidence: float) -> OcrRecord:
    result = check_latex_syntax_and_packages(raw_latex)
    return OcrRecord(
        recordId=str(uuid.uuid4()),
        inputType=input_type,
        routeMode=route_mode,
        rawLatex=raw_latex,
        healedLatex=raw_latex,
        requiredPackages=result["required_packages"],
        confidenceScore=confidence,
    )


async def _call_vlm(image_base64: str, input_type: str) -> str:
    from openai import AsyncOpenAI

    api_key = os.getenv("ECLOUD_API_KEY", "")
    base_url = os.getenv("ECLOUD_BASE_URL", "")
    model_name = os.getenv("ECLOUD_MODEL_NAME", "")

    if base_url.endswith("/chat/completions"):
        base_url = base_url[: -len("/chat/completions")]

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    prompt_map = {
        "FORMULA": "请识别图片中的数学公式，仅输出 LaTeX 源码，不要输出任何解释文字。",
        "TABLE": "请识别图片中的三线表，仅输出 LaTeX 源码（使用 booktabs 宏包），不要输出任何解释文字。",
        "MIXED": "请识别图片中的公式和表格，仅输出 LaTeX 源码，不要输出任何解释文字。",
    }

    response = await client.chat.completions.create(
        model=model_name,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt_map.get(input_type, prompt_map["FORMULA"])},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{image_base64}"},
                    },
                ],
            }
        ],
        max_tokens=4096,
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    )

    msg = response.choices[0].message
    raw_text = msg.content or ""
    if not raw_text:
        reasoning = getattr(msg, "reasoning_content", None) or ""
        latex_match = re.search(r"(\\begin\{[a-z*]+\}.*?\\end\{[a-z*]+\})", reasoning, re.DOTALL)
        if latex_match:
            raw_text = latex_match.group(1)
    return _strip_latex_wrappers(raw_text)


@app.get("/health")
async def health():
    return {"code": 200, "message": "success", "data": {"status": "ok"}}


@app.post("/internal/v1/ocr/recognize", response_model=ApiResponse)
async def recognize(req: OcrRequest):
    if _is_mock_mode():
        if req.inputType == "TABLE":
            raw_latex = MOCK_TABLE_LATEX
        elif req.inputType == "MIXED":
            raw_latex = MOCK_FORMULA_LATEX + "\n\n" + MOCK_TABLE_LATEX
        else:
            raw_latex = MOCK_FORMULA_LATEX
        record = _build_record(raw_latex, req.inputType, "CLOUD_VLM", 0.95)
    else:
        raw_latex = await _call_vlm(req.imageBase64, req.inputType)
        record = _build_record(raw_latex, req.inputType, "CLOUD_VLM", 0.85)

    return ApiResponse(code=200, message="success", data=record)


@app.post("/internal/v1/ocr/heal", response_model=HealResponse)
async def heal(req: HealRequest):
    result = heal_and_normalize_latex(req.latexCode, req.convertToBooktabs)
    return HealResponse(
        code=200,
        message="success",
        data=HealData(
            healedLatex=result["healed_latex"],
            astValidationResult=AstValidationResult(
                isValid=result["is_valid"],
                errors=result["errors"],
                warnings=result["warnings"],
            ),
            requiredPackages=result["required_packages"],
        ),
    )


@app.post("/internal/v1/agent/align-notation", response_model=AlignNotationResponse)
async def align_notation(req: AlignNotationRequest):
    result = run_notation_align_agent(
        req.rawLatex,
        [e.model_dump() for e in req.notationMap],
        req.customInstruction,
    )
    return AlignNotationResponse(
        code=200,
        message="success",
        data=AlignNotationData(**result),
    )


@app.post("/internal/v1/agent/inject-table", response_model=TableInjectResponse)
async def inject_table(req: TableInjectRequest):
    result = run_table_inject_agent(
        req.skeletonLatex,
        req.csvContent,
        req.metricDirections,
        req.decimalPlaces,
    )
    return TableInjectResponse(
        code=200,
        message="success",
        data=TableInjectData(**result),
    )
