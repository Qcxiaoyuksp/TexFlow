import os
import re
import uuid as uuid_mod

os.environ["ECLOUD_API_KEY"] = "your_ecloud_api_key_here"

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


class TestHealth:
    def test_health_returns_success(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 200
        assert body["message"] == "success"
        assert body["data"]["status"] == "ok"


class TestOcrRecognize:
    def test_formula_mock(self):
        resp = client.post(
            "/internal/v1/ocr/recognize",
            json={"imageBase64": "mock_base64_data", "inputType": "FORMULA"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 200
        assert body["message"] == "success"
        data = body["data"]
        assert data["inputType"] == "FORMULA"
        assert data["routeMode"] == "CLOUD_VLM"
        uuid_mod.UUID(data["recordId"])
        assert "aligned" in data["rawLatex"]
        assert data["healedLatex"] == data["rawLatex"]
        assert isinstance(data["requiredPackages"], list)
        assert "amsmath" in data["requiredPackages"]
        assert 0.0 <= data["confidenceScore"] <= 1.0

    def test_table_mock(self):
        resp = client.post(
            "/internal/v1/ocr/recognize",
            json={"imageBase64": "mock_base64_data", "inputType": "TABLE"},
        )
        assert resp.status_code == 200
        body = resp.json()
        data = body["data"]
        assert data["inputType"] == "TABLE"
        assert data["routeMode"] == "CLOUD_VLM"
        assert "\\toprule" in data["rawLatex"]
        assert "\\midrule" in data["rawLatex"]
        assert "\\bottomrule" in data["rawLatex"]
        col_spec = re.search(r"\\begin\{tabular\}\{([^}]+)\}", data["rawLatex"])
        assert col_spec is not None
        assert "|" not in col_spec.group(1)
        assert "booktabs" in data["requiredPackages"]

    def test_default_input_type_is_formula(self):
        resp = client.post(
            "/internal/v1/ocr/recognize",
            json={"imageBase64": "mock_base64_data"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["data"]["inputType"] == "FORMULA"

    def test_project_id_accepted(self):
        resp = client.post(
            "/internal/v1/ocr/recognize",
            json={
                "imageBase64": "mock_base64_data",
                "inputType": "TABLE",
                "projectId": "paper-001",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["code"] == 200
