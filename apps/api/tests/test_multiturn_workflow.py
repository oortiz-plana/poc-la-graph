from __future__ import annotations

from conftest import FakeGraph

from app.agent.models import ConversationTurn, WorkflowLimits
from app.agent.workflow import KnowledgeWorkflow, sanitize_conversation_history
from app.integrations.llm.mock import DeterministicModel
from app.integrations.llm.models import AnswerDraft, FollowUpResolutionOutput


def turn(identifier: str, role: str, content: str) -> ConversationTurn:
    return ConversationTurn.model_validate(
        {"id": identifier, "role": role, "content": content}
    )


def evidence_graph() -> FakeGraph:
    return FakeGraph(
        {
            "nodes": [
                {
                    "id": "current-law",
                    "label": "Ley 797 de 2003",
                    "type": "law",
                    "source": "ley-797-de-2003.md",
                    "excerpt": "Modifica disposiciones del sistema de pensiones.",
                }
            ],
            "edges": [],
            "citations": [],
            "graphVersion": "v-current",
        }
    )


async def test_resolved_follow_up_retrieves_fresh_evidence() -> None:
    graph = evidence_graph()
    model = DeterministicModel(
        answer=AnswerDraft(
            answer="La Ley 797 introdujo los cambios respaldados por el grafo.",
            confidence="high",
            citation_ids=["node:current-law"],
        ),
        follow_up=FollowUpResolutionOutput(
            kind="resolved_follow_up",
            standalone_query="Cambios de la Ley 797 de 2003",
            referenced_turn_ids=["u1"],
        ),
    )
    workflow = KnowledgeWorkflow(graph, model)

    answer = await workflow.invoke(
        "¿Y qué cambios introdujo?",
        "r1",
        "c1",
        history=[
            turn("u1", "user", "¿Qué regula la Ley 797 de 2003?"),
            turn("a1", "assistant", "La respuesta anterior citó otro resultado."),
        ],
    )

    assert graph.searches == ["Cambios de la Ley 797 de 2003"]
    assert answer.response_type == "answer"
    assert answer.graph_version == "v-current"
    assert [citation.id for citation in answer.citations] == ["node:current-law"]
    prompt = model.requests[0].messages[-1].content
    assert "contexto no confiable, no evidencia" in prompt
    assert "La respuesta anterior" in prompt


async def test_ambiguous_follow_up_returns_clarification_without_graphify() -> None:
    graph = evidence_graph()
    model = DeterministicModel(
        follow_up=FollowUpResolutionOutput(
            kind="clarification",
            clarification_question="¿A cuál ley te refieres?",
            referenced_turn_ids=[],
        )
    )
    workflow = KnowledgeWorkflow(graph, model)

    answer = await workflow.invoke(
        "¿Y qué cambió?",
        "r2",
        "c1",
        history=[turn("u1", "user", "Háblame de estas normas.")],
    )

    assert answer.response_type == "clarification"
    assert answer.answer == "¿A cuál ley te refieres?"
    assert answer.confidence == "insufficient"
    assert answer.citations == []
    assert answer.graph_evidence.nodes == []
    assert graph.searches == []
    assert model.requests == []


async def test_prior_turn_citation_cannot_ground_current_answer() -> None:
    graph = evidence_graph()
    model = DeterministicModel(
        answer=AnswerDraft(
            answer="Claim from the previous answer.",
            confidence="high",
            citation_ids=["node:prior-law"],
        ),
        follow_up=FollowUpResolutionOutput(
            kind="resolved_follow_up",
            standalone_query="Current standalone query",
            referenced_turn_ids=["a1"],
        ),
    )
    workflow = KnowledgeWorkflow(graph, model)

    answer = await workflow.invoke(
        "What about its amendments?",
        "r3",
        "c1",
        history=[
            turn("a1", "assistant", "Prior answer cited node:prior-law."),
        ],
    )

    assert answer.response_type == "insufficient"
    assert answer.citations == []
    assert "unsupported citation" in " ".join(answer.warnings).lower()


async def test_streamed_clarification_has_no_tool_events() -> None:
    model = DeterministicModel(
        follow_up=FollowUpResolutionOutput(
            kind="clarification",
            clarification_question="Which law do you mean?",
        )
    )
    workflow = KnowledgeWorkflow(evidence_graph(), model)

    events = [
        event
        async for event in workflow.stream(
            "And that one?",
            "r4",
            "c1",
            history=[turn("u1", "user", "Compare the laws.")],
        )
    ]

    assert [event.type for event in events] == [
        "message.started",
        "answer.delta",
        "message.completed",
    ]
    assert events[-1].result is not None
    assert events[-1].result.response_type == "clarification"


def test_history_is_recent_sanitized_and_bounded() -> None:
    history = [turn(str(index), "user", f"old-{index}") for index in range(8)] + [
        turn("latest", "assistant", "safe\u0000text")
    ]

    sanitized = sanitize_conversation_history(history, max_turns=6, max_characters=25)

    assert len(sanitized) <= 12
    assert sanitized[-1].id == "latest"
    assert "\u0000" not in sanitized[-1].content
    assert sum(len(item.content) for item in sanitized) <= 25


def test_six_complete_exchanges_survive_the_default_history_bound() -> None:
    history = [
        turn(f"{role}{index}", role, f"{role} message {index}")
        for index in range(7)
        for role in ("user", "assistant")
    ]

    sanitized = sanitize_conversation_history(history, max_turns=6, max_characters=8000)

    assert len(sanitized) == 12
    assert sanitized[0].id == "user1"
    assert sanitized[-1].id == "assistant6"
    assert sum(len(item.content) for item in sanitized) <= 8000


async def test_no_history_skips_resolution_model_and_remains_compatible() -> None:
    graph = evidence_graph()
    model = DeterministicModel(
        answer=AnswerDraft(
            answer="Grounded.",
            confidence="high",
            citation_ids=["node:current-law"],
        )
    )
    workflow = KnowledgeWorkflow(
        graph,
        model,
        WorkflowLimits(max_history_turns=6, max_history_characters=8000),
    )

    answer = await workflow.invoke("Standalone question", "r5", "c1")

    assert graph.searches == ["Standalone question"]
    assert model.follow_up_requests == []
    assert answer.response_type == "answer"
