"""
AATCE Apple Lab - Multi-Agent Build Orchestrator (LangGraph skeleton)

Supervisor + specialist-subgraph pattern. Each specialist node runs its own
internal build -> test -> review -> fix loop, then reports back to the
Supervisor, which decides what runs next.

This is a STARTING SKELETON, not a finished tool:
- Fill in `call_llm()` with a real Anthropic API call.
- Fill in `write_files()` / `run_tests()` with real repo-write + test-run logic
  (e.g. shell out to `git`, `swift build`, `clasp push`, `npm test`, etc).
- The SRS/PRD text should be loaded once and passed into every agent's context.

Install: pip install langgraph langchain-anthropic --break-system-packages
"""

from typing import TypedDict, Literal, Optional
from langgraph.graph import StateGraph, END


# ---------------------------------------------------------------------------
# Shared state passed between every node in the graph
# ---------------------------------------------------------------------------
class BuildState(TypedDict):
    srs_text: str
    prd_text: str
    phase: int                     # current SRS section-8 phase number (1-5)
    completed_tasks: list[str]     # human-readable log of what's been done
    backend_contract: Optional[str]  # API shapes Backend Agent reports back
    embeddings_schema: Optional[str] # schema ML Agent reports back
    next_agent: Optional[str]      # set by supervisor, consumed by router
    agent_report: Optional[str]    # most recent specialist's report
    done: bool


# ---------------------------------------------------------------------------
# Placeholder LLM call - replace with a real Anthropic API call
# ---------------------------------------------------------------------------
def call_llm(system_prompt: str, user_context: str) -> str:
    """
    Replace this with e.g.:

        import anthropic
        client = anthropic.Anthropic()
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4000,
            system=system_prompt,
            messages=[{"role": "user", "content": user_context}],
        )
        return resp.content[0].text
    """
    raise NotImplementedError("Wire this up to the Anthropic API")


def write_files(diff_description: str) -> None:
    """Apply the agent's proposed file changes to the actual repo clone."""
    raise NotImplementedError


def run_tests(scope: str) -> tuple[bool, str]:
    """Run the relevant test/build command for this scope. Returns (passed, output)."""
    raise NotImplementedError


# ---------------------------------------------------------------------------
# Specialist agent factory - same build/test/review/fix loop, different scope
# ---------------------------------------------------------------------------
SPECIALIST_PROMPTS = {
    "backend": "You own /backend only. ... (full prompt from the design doc)",
    "kiosk": "You own /macos-app only. ... (full prompt from the design doc)",
    "ml": "You own /ml-training only. ... (full prompt from the design doc)",
    "admin_portal": "You own /admin-portal only. ... (full prompt from the design doc)",
}

REVIEWER_PROMPT = (
    "Compare this agent's diff against its assigned SRS requirement IDs. "
    "List any requirement not satisfied, any NFR violated, and any scope "
    "violation (files touched outside the agent's owned folder). Output "
    "PASS or FAIL with a specific, actionable reason list if FAIL."
)


def make_specialist_node(agent_name: str, max_fix_loops: int = 3):
    def node(state: BuildState) -> BuildState:
        context = (
            f"SRS:\n{state['srs_text']}\n\nPRD:\n{state['prd_text']}\n\n"
            f"Backend contract so far: {state.get('backend_contract')}\n"
            f"Embeddings schema so far: {state.get('embeddings_schema')}\n"
        )
        report = ""
        for attempt in range(max_fix_loops):
            diff = call_llm(SPECIALIST_PROMPTS[agent_name], context + report)
            write_files(diff)
            passed, test_output = run_tests(scope=agent_name)
            review = call_llm(REVIEWER_PROMPT, diff + "\n\nTest output:\n" + test_output)
            if passed and review.strip().startswith("PASS"):
                report = f"{agent_name} done. Summary:\n{diff}"
                break
            report = f"Previous attempt failed review/tests:\n{review}\n{test_output}"
        state["agent_report"] = report
        state["completed_tasks"] = state["completed_tasks"] + [f"{agent_name}: done"]
        return state
    return node


# ---------------------------------------------------------------------------
# Supervisor node - decides what runs next
# ---------------------------------------------------------------------------
def supervisor_node(state: BuildState) -> BuildState:
    supervisor_prompt = (
        "You are the build supervisor for the AATCE Apple Lab Attendance System. "
        f"Current phase: {state['phase']}. Completed so far: {state['completed_tasks']}. "
        "Decide the single next agent to run (backend, kiosk, ml, admin_portal) "
        "or 'END' if this phase's goals are met. Respond with just the agent name or END."
    )
    decision = call_llm(supervisor_prompt, state.get("agent_report") or "No agents run yet.")
    state["next_agent"] = decision.strip().lower()
    if state["next_agent"] == "end":
        state["done"] = True
    return state


def route(state: BuildState) -> Literal["backend", "kiosk", "ml", "admin_portal", "__end__"]:
    if state["done"]:
        return END
    return state["next_agent"]  # type: ignore


# ---------------------------------------------------------------------------
# Build the graph
# ---------------------------------------------------------------------------
def build_graph():
    graph = StateGraph(BuildState)

    graph.add_node("supervisor", supervisor_node)
    for name in ("backend", "kiosk", "ml", "admin_portal"):
        graph.add_node(name, make_specialist_node(name))
        graph.add_edge(name, "supervisor")  # specialists always report back

    graph.add_conditional_edges("supervisor", route)
    graph.set_entry_point("supervisor")

    return graph.compile()


if __name__ == "__main__":
    app = build_graph()

    initial_state: BuildState = {
        "srs_text": open("docs/SRS.md").read(),
        "prd_text": open("docs/PRD.md").read(),
        "phase": 1,
        "completed_tasks": [],
        "backend_contract": None,
        "embeddings_schema": None,
        "next_agent": None,
        "agent_report": None,
        "done": False,
    }

    final_state = app.invoke(initial_state)
    print("Build run finished:", final_state["completed_tasks"])
