"""Client for the Dynamic Workers Agent Orchestrator API.

Submits analysis tasks to the orchestrator and polls for results.
The orchestrator spins up sandboxed Dynamic Workers that run AI agents
to perform the requested analysis.
"""

import json
import logging
import re

import httpx

from .config import settings
from .models import SubtaskError, TaskStatus

logger = logging.getLogger(__name__)

_SECRET_HEADER_RE = re.compile(r"key|token|auth", re.IGNORECASE)
_SECRET_FIELD_RE = re.compile(r"apikey|api_key|githubpat|github_pat|token|secret", re.IGNORECASE)
_PAYLOAD_PREVIEW_LIMIT = 500


def _redact_headers(headers: dict | None) -> dict:
    if not headers:
        return {}
    return {k: ("***" if _SECRET_HEADER_RE.search(k) else v) for k, v in headers.items()}


def _redact_payload(payload) -> str:
    """Serialize payload to a truncated, secret-redacted string for logging."""
    try:
        def scrub(obj):
            if isinstance(obj, dict):
                return {
                    k: ("***" if _SECRET_FIELD_RE.search(k) else scrub(v))
                    for k, v in obj.items()
                }
            if isinstance(obj, list):
                return [scrub(v) for v in obj]
            return obj

        text = json.dumps(scrub(payload), default=str)
    except (TypeError, ValueError):
        text = str(payload)
    if len(text) > _PAYLOAD_PREVIEW_LIMIT:
        return text[:_PAYLOAD_PREVIEW_LIMIT] + f"...<truncated {len(text) - _PAYLOAD_PREVIEW_LIMIT} chars>"
    return text


class OrchestratorClient:
    """Thin async wrapper around the orchestrator's REST API."""

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.orchestrator_url).rstrip("/")
        self._http = httpx.AsyncClient(base_url=self.base_url, timeout=30.0)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict | None = None,
        request_id: str | None = None,
    ) -> httpx.Response:
        rid = f" rid={request_id}" if request_id else ""
        if json_body is not None:
            logger.debug(
                "[orchestrator] %s %s%s payload=%s",
                method, path, rid, _redact_payload(json_body),
            )
        else:
            logger.debug("[orchestrator] %s %s%s", method, path, rid)

        resp = await self._http.request(method, path, json=json_body)
        if resp.status_code >= 400:
            logger.error(
                "[orchestrator] %s %s%s -> %d body=%s",
                method, path, rid, resp.status_code,
                resp.text[:_PAYLOAD_PREVIEW_LIMIT],
            )
        else:
            logger.debug(
                "[orchestrator] %s %s%s -> %d", method, path, rid, resp.status_code,
            )
        resp.raise_for_status()
        return resp

    async def health(self) -> dict:
        resp = await self._request("GET", "/health")
        return resp.json()

    async def create_analysis_task(
        self,
        coin_id: str,
        price_data: dict,
        analysis_type: str = "summary",
        request_id: str | None = None,
    ) -> str:
        """Submit a crypto analysis task to the orchestrator.

        The orchestrator decomposes this into subtasks (codegen -> test -> review),
        provisions Dynamic Workers for each agent, and executes them in sandboxed
        V8 isolates.

        Returns the task ID for polling.
        """
        description = (
            f"Analyze the cryptocurrency '{coin_id}' based on the following "
            f"live market data and produce a {analysis_type} analysis.\n\n"
            f"Current price: ${price_data.get('price_usd', 'N/A')}\n"
            f"24h change: {price_data.get('change_24h', 'N/A')}%\n"
            f"Market cap: ${price_data.get('market_cap', 'N/A')}\n"
            f"24h volume: ${price_data.get('volume_24h', 'N/A')}\n"
        )

        agent_source = _build_agent_source(coin_id, analysis_type, price_data)

        payload = {
            "tasks": [
                {
                    "description": description,
                    "agentType": "codegen",
                    "repo": {
                        "owner": settings.github_owner,
                        "repo": settings.github_repo,
                        "branch": f"analysis/{coin_id}",
                        "baseBranch": "main",
                        "files": {
                            "analysis/prompt.md": description,
                            "analysis/agent.js": agent_source,
                        },
                    },
                    "config": {
                        "provider": "anthropic",
                        "model": "claude-sonnet-4-20250514",
                        "maxTokens": 4096,
                        "temperature": 0.3,
                    },
                }
            ]
        }
        if request_id:
            payload["metadata"] = {"requestId": request_id}

        resp = await self._request("POST", "/tasks", json_body=payload, request_id=request_id)
        data = resp.json()
        task_id = data["taskIds"][0]
        logger.info(
            "[orchestrator] task created task_id=%s coin=%s type=%s rid=%s",
            task_id, coin_id, analysis_type, request_id,
        )
        return task_id

    async def get_task(self, task_id: str, request_id: str | None = None) -> TaskStatus:
        """Poll the orchestrator for task status."""
        resp = await self._request("GET", f"/tasks/{task_id}", request_id=request_id)
        data = resp.json()["task"]

        summary: str | None = None
        cost_usd: float | None = None
        subtask_errors: list[SubtaskError] = []

        if data.get("results"):
            for result in data["results"].values():
                output = result.get("output") or {}
                if output.get("summary") and not summary:
                    summary = output["summary"]
                if not result.get("success", True) and result.get("error"):
                    subtask_errors.append(
                        SubtaskError(
                            subtaskId=result.get("subtaskId", "?"),
                            agentType=result.get("agentType", "?"),
                            error=str(result["error"]),
                        )
                    )

        if data.get("cost"):
            cost_usd = data["cost"].get("estimatedCostUsd")

        raw_status = data.get("status", "unknown")
        top_level_error = data.get("error")
        composed_error: str | None = None

        if raw_status == "failed":
            for se in subtask_errors:
                logger.error(
                    "[orchestrator] subtask failed task_id=%s subtaskId=%s agent=%s error=%s",
                    task_id, se.subtaskId, se.agentType, se.error,
                )
            parts: list[str] = []
            if top_level_error:
                parts.append(f"orchestrator: {top_level_error}")
            for se in subtask_errors:
                parts.append(f"{se.agentType}[{se.subtaskId}]: {se.error}")
            if parts:
                composed_error = " | ".join(parts)
            elif top_level_error:
                composed_error = top_level_error
            else:
                composed_error = "Task failed with no error details reported by the orchestrator"

        return TaskStatus(
            id=data["id"],
            status=data["status"],
            summary=summary,
            error=composed_error or top_level_error,
            cost_usd=cost_usd,
            subtask_errors=subtask_errors or None,
            raw_status=raw_status,
        )

    async def get_usage(self) -> dict:
        """Fetch aggregate cost/usage from the orchestrator."""
        resp = await self._request("GET", "/usage")
        return resp.json()

    async def close(self):
        await self._http.aclose()


def _build_agent_source(coin_id: str, analysis_type: str, price_data: dict) -> str:
    """Generate the agent JavaScript that runs inside a Dynamic Worker.

    This code executes in a sandboxed V8 isolate provisioned by the orchestrator.
    It has access to:
      - env.LLM   (LLM binding — calls Claude/GPT with injected credentials)
      - env.CONFIG (task metadata injected by the orchestrator)
    """
    return f"""\
export default {{
  async run() {{
    const config = JSON.parse(env.CONFIG);
    const llm = env.LLM;

    const prompt = `You are a cryptocurrency analyst. Provide a concise
{analysis_type} analysis for {coin_id}.

Market data:
- Price: ${price_data.get("price_usd", "N/A")}
- 24h Change: {price_data.get("change_24h", "N/A")}%
- Market Cap: ${price_data.get("market_cap", "N/A")}
- 24h Volume: ${price_data.get("volume_24h", "N/A")}

Provide your analysis in 3-5 concise bullet points.`;

    const response = await llm.chat({{
      messages: [
        {{ role: "system", content: "You are a crypto market analyst." }},
        {{ role: "user", content: prompt }}
      ],
      maxTokens: 2048,
      temperature: 0.3,
    }});

    return JSON.stringify({{
      success: true,
      files: {{}},
      summary: response.content,
      cost: {{
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        totalTokens: response.inputTokens + response.outputTokens,
        estimatedCostUsd: 0,
        cpuTimeMs: 0,
        subrequests: 1,
      }},
    }});
  }}
}};
"""
