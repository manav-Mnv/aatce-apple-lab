"""
backend_client.py — Minimal client for the Supabase backend (pipeline role).

Every call is a POST to <project>/rest/v1/rpc/api with { secret, action, ...params }
as the JSON body (supabase/API_CONTRACT.md) and the publishable key in `apikey`.

Configuration comes from the environment, never from the repo (NFR-8):
    SUPABASE_URL              https://<ref>.supabase.co
    SUPABASE_PUBLISHABLE_KEY  sb_publishable_…  (public project key)
    PIPELINE_SECRET           the pipeline role's secret
"""

import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict


class BackendError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code


class BackendClient:
    def __init__(self, url: str, publishable_key: str, secret: str, timeout: float = 120):
        self.endpoint = url.rstrip("/") + "/rest/v1/rpc/api"
        self.publishable_key = publishable_key
        self.secret = secret
        self.timeout = timeout

    @classmethod
    def from_env(cls) -> "BackendClient":
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
        secret = os.environ.get("PIPELINE_SECRET", "")
        if not url or not key or not secret:
            raise BackendError("not_configured", "SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and PIPELINE_SECRET must be set")
        return cls(url, key, secret)

    def call(self, action: str, **params: Any) -> Dict[str, Any]:
        body = json.dumps({**params, "secret": self.secret, "action": action}).encode("utf-8")
        request = urllib.request.Request(self.endpoint, data=body, method="POST", headers={
            "Content-Type": "application/json",
            "apikey": self.publishable_key,
        })
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as e:
            raise BackendError(f"http_{e.code}", e.read()[:200].decode("utf-8", "replace")) from None
        try:
            result = json.loads(raw)
        except json.JSONDecodeError:
            raise BackendError("bad_response", f"Expected JSON, got: {raw[:200]!r}") from None
        if not result.get("success"):
            raise BackendError(result.get("error_code", "unknown"), result.get("error", ""))
        return result
