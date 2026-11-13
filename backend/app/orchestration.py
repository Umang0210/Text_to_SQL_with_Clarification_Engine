from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from .clarification import analyze_request


class IntentState(TypedDict):
    text: str
    schema: list[dict[str, Any]]
    prior_intent: dict[str, Any] | None
    intent: dict[str, Any] | None


def _understand_intent(state: IntentState) -> IntentState:
    return {**state, "intent": analyze_request(state["text"], state["schema"], state.get("prior_intent"))}


def _finish(state: IntentState) -> str:
    return "finish"


def _build_graph():
    graph = StateGraph(IntentState)
    graph.add_node("understand_intent", _understand_intent)
    graph.set_entry_point("understand_intent")
    graph.add_conditional_edges("understand_intent", _finish, {"finish": END})
    return graph.compile()


intent_graph = _build_graph()


def understand_intent(text: str, schema: list[dict[str, Any]], prior_intent: dict[str, Any] | None = None) -> dict[str, Any]:
    result = intent_graph.invoke({"text": text, "schema": schema, "prior_intent": prior_intent, "intent": None})
    return result["intent"] or {}
