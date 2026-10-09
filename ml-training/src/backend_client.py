"""
backend_client.py — Minimal client for the Apps Script backend (pipeline role).

Every call is a POST with { secret, action, ...params } (backend/API_CONTRACT.md).
Apps Script answers a POST with a 302 to a googleusercontent.com URL that must
be fetched with GET; urllib does exactly that (it drops the body on 302).

Configuration comes from the environment, never from the repo (NFR-8):
    APPS_SCRIPT_URL   https://script.google.com/macros/s/<deployment>/exec
    PIPELINE_SECRET   the pipeline role's secret
"""

import json
import os
import urllib.request
from typing import Any, Dict


class BackendError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code


class BackendClient:
    def __init__(self, url: str, secret: str, timeout: float = 120):
        self.url = url
        self.secret = secret
        self.timeout = timeout

    @classmethod
    def from_env(cls) -> "BackendClient":
        url = os.environ.get("APPS_SCRIPT_URL", "")
        secret = os.environ.get("PIPELINE_SECRET", "")
        if not url or not secret:
            raise BackendError("not_configured", "APPS_SCRIPT_URL and PIPELINE_SECRET must be set")
        return cls(url, secret)

    def call(self, action: str, **params: Any) -> Dict[str, Any]:
        body = json.dumps({**params, "secret": self.secret, "action": action}).encode("utf-8")
        request = urllib.request.Request(self.url, data=body, method="POST",
                                         headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            raw = response.read()
        try:
            result = json.loads(raw)
        except json.JSONDecodeError:
            raise BackendError("bad_response", f"Expected JSON, got: {raw[:200]!r}") from None
        if not result.get("success"):
            raise BackendError(result.get("error_code", "unknown"), result.get("error", ""))
        return result
