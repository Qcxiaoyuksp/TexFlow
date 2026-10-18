import os
os.environ["ECLOUD_API_KEY"] = "your_ecloud_api_key_here"

import re
from agents import (
    _safe_latex_replace,
    _extract_main_value,
    _format_cell_value,
    run_notation_align_agent,
    run_table_inject_agent,
)

SAMPLE_TABLE_LATEX = (
    "\\begin{tabular}{lccc}\n\\toprule\n"
    "Method & Acc & F1 & Params \\\\\n\\midrule\n"
    "Baseline & 85.20 & 84.10 & 12.3 \\\\\n"
    "TexFlow & 92.45 & 91.80 & 10.5 \\\\\n"
    "\\bottomrule\n\\end{tabular}"
)


class TestSafeReplace:
    def test_replace_N_preserves_mathcal(self):
        latex = r"\mathcal{N} + N \times 2"
        result = _safe_latex_replace(latex, "N", "M")
        assert r"\mathcal{N}" in result
        assert r"\mathcal{M}" not in result
        assert "M" in result
        assert "N + N" not in result.replace(r"\mathcal{N}", "")

    def test_replace_N_preserves_operatorname(self):
        latex = r"\operatorname{LN}(N) = N^2"
        result = _safe_latex_replace(latex, "N", "M")
        assert r"\operatorname{LN}" in result
        assert r"\operatorname{LM}" not in result
        assert "M" in result

    def test_replace_latex_command_theta(self):
        latex = r"\theta + \theta^2 = \alpha"
        result = _safe_latex_replace(latex, r"\theta", r"\mathbf{W}")
        assert r"\mathbf{W}" in result
        assert r"\theta" not in result or r"\theta" in r"\mathbf{W}"

    def test_replace_multiple_symbols(self):
        latex = r"\theta \times N + \beta"
        notation_map = [
            {"sourceSymbol": r"\theta", "targetSymbol": r"\mathbf{W}", "semanticMeaning": "weight"},
            {"sourceSymbol": "N", "targetSymbol": "d", "semanticMeaning": "dimension"},
        ]
        result = latex
        for entry in notation_map:
            result = _safe_latex_replace(result, entry["sourceSymbol"], entry["targetSymbol"])
        assert r"\mathbf{W}" in result
        assert r" d " in result or "d " in result
        assert r"\theta" not in result.replace(r"\mathbf{W}", "")
        assert r"\beta" in result


class TestExtractMainValue:
    def test_plain_float(self):
        assert _extract_main_value("92.45") == 92.45

    def test_with_pm_std(self):
        assert _extract_main_value("92.45 ± 0.12") == 92.45
        assert _extract_main_value("88.10\\pm 0.05") == 88.10

    def test_scientific_notation(self):
        assert _extract_main_value("3.79e-2") == 3.79e-2


class TestFormatCellValue:
    def test_best_gets_textbf(self):
        val = _format_cell_value("92.45", 2, True, False)
        assert r"\textbf{92.45}" == val

    def test_second_gets_underline(self):
        val = _format_cell_value("88.10", 2, False, True)
        assert r"\underline{88.10}" == val

    def test_preserves_std(self):
        val = _format_cell_value("92.45 ± 0.12", 2, True, False)
        assert r"\textbf{92.45 ± 0.12}" == val


class TestTableInjectAgent:
    def test_max_direction_bold_underline(self):
        skeleton = (
            "\\begin{tabular}{lcc}\n\\toprule\n"
            "Method & Acc & F1 \\\\\n\\midrule\n"
            "{{R1_C1}} & {{R1_C2}} \\\\\n"
            "{{R2_C1}} & {{R2_C2}} \\\\\n"
            "\\bottomrule\n\\end{tabular}"
        )
        csv_content = "85.20,84.10\n92.45,91.80"
        result = run_table_inject_agent(skeleton, csv_content, ["MAX", "MAX"])
        injected = result["injectedLatex"]
        assert r"\textbf{92.45}" in injected
        assert r"\underline{85.20}" in injected
        assert r"\textbf{91.80}" in injected
        assert r"\underline{84.10}" in injected

    def test_min_direction_bold_underline(self):
        skeleton = "{{R1_C1}} & {{R1_C2}} \\\\\n{{R2_C1}} & {{R2_C2}}"
        csv_content = "12.3,0.85\n10.5,0.92"
        result = run_table_inject_agent(skeleton, csv_content, ["MIN", "MIN"])
        injected = result["injectedLatex"]
        assert r"\textbf{10.50}" in injected
        assert r"\underline{12.30}" in injected
        assert r"\textbf{0.85}" in injected

    def test_csv_with_std_comparison(self):
        skeleton = "{{R1_C1}}\n{{R2_C1}}"
        csv_content = "92.45 ± 0.12\n88.10 ± 0.05"
        result = run_table_inject_agent(skeleton, csv_content, ["MAX"])
        injected = result["injectedLatex"]
        assert r"\textbf{92.45 ± 0.12}" in injected
        assert r"\underline{88.10 ± 0.05}" in injected

    def test_full_cycle_from_real_table(self):
        result = run_table_inject_agent(
            SAMPLE_TABLE_LATEX,
            "87.30,83.50,13.1\n95.12,93.40,9.8",
            ["MAX", "MAX", "MIN"],
            decimal_places=2,
        )
        assert "{{R" not in result["injectedLatex"]
        assert r"\textbf{95.12}" in result["injectedLatex"]
        assert r"\underline{87.30}" in result["injectedLatex"]
        assert r"\textbf{9.80}" in result["injectedLatex"]
        assert result["summary"]["dataRows"] == 2
        assert result["summary"]["dataCols"] == 3


class TestNotationAlignAgent:
    def test_mock_mode_align(self):
        result = run_notation_align_agent(
            r"\theta + N = \beta",
            [
                {"sourceSymbol": r"\theta", "targetSymbol": r"\mathbf{W}", "semanticMeaning": "weight matrix"},
                {"sourceSymbol": "N", "targetSymbol": "d", "semanticMeaning": "dimension"},
            ],
        )
        assert r"\mathbf{W}" in result["alignedLatex"]
        assert "where" in result["notationExplanation"].lower()
        assert "weight matrix" in result["notationExplanation"]
        assert "import torch" in result["pytorchCode"]
