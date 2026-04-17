"""Client for the Dynamic Workers Agent Orchestrator API.

Submits analysis tasks to the orchestrator and polls for results.
The orchestrator spins up sandboxed Dynamic Workers that run AI agents
to perform the requested analysis.
"""

import httpx

from .config import settings
from .models import TaskStatus


class OrchestratorClient:
    """Thin async wrapper around the orchestrator's REST API."""

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.orchestrator_url).rstrip("/")
        self._http = httpx.AsyncClient(base_url=self.base_url, timeout=30.0)

    async def health(self) -> dict:
        resp = await self._http.get("/health")
        resp.raise_for_status()
        return resp.json()

    async def create_analysis_task(
        self,
        coin_id: str,
        price_data: dict,
        analysis_type: str = "summary",
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

        # The agent source code is a small JS module that the orchestrator
        # bundles and runs inside a Dynamic Worker.  The agent uses the LLM
        # binding (env.LLM) injected by the orchestrator — credentials never
        # touch the agent.
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

        resp = await self._http.post("/tasks", json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data["taskIds"][0]

    async def get_task(self, task_id: str) -> TaskStatus:
        """Poll the orchestrator for task status."""
        resp = await self._http.get(f"/tasks/{task_id}")
        resp.raise_for_status()
        data = resp.json()["task"]

        summary = None
        cost_usd = None

        # Extract summary from completed agent results
        if data.get("results"):
            for result in data["results"].values():
                if result.get("output", {}).get("summary"):
                    summary = result["output"]["summary"]
                    break

        if data.get("cost"):
            cost_usd = data["cost"].get("estimatedCostUsd")

        return TaskStatus(
            id=data["id"],
            status=data["status"],
            summary=summary,
            error=data.get("error"),
            cost_usd=cost_usd,
        )

    async def get_usage(self) -> dict:
        """Fetch aggregate cost/usage from the orchestrator."""
        resp = await self._http.get("/usage")
        resp.raise_for_status()
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
