"""Deterministic model for tests and explicitly configured troubleshooting."""

from __future__ import annotations

import json
import re
from collections.abc import Callable

from .client import FollowUpRequest, ModelRequest
from .models import (
    AnswerDraft,
    FollowUpResolutionOutput,
    FollowUpResult,
    ModelResult,
    TokenUsage,
)


class DeterministicModel:
    """In-memory model double; production wiring must opt into it explicitly."""

    def __init__(
        self,
        answer: AnswerDraft | None = None,
        responder: Callable[[ModelRequest], AnswerDraft] | None = None,
        follow_up: FollowUpResolutionOutput | None = None,
        follow_up_responder: (
            Callable[[FollowUpRequest], FollowUpResolutionOutput] | None
        ) = None,
    ) -> None:
        self._answer = answer or AnswerDraft(
            answer="The supplied graph evidence supports this answer.",
            confidence="high",
            citation_ids=["evidence-1"],
        )
        self._responder = responder
        self._follow_up = follow_up
        self._follow_up_responder = follow_up_responder
        self.requests: list[ModelRequest] = []
        self.follow_up_requests: list[FollowUpRequest] = []

    async def generate(self, request: ModelRequest) -> ModelResult:
        self.requests.append(request.model_copy(deep=True))
        output = self._responder(request) if self._responder else self._answer
        if self._responder is None and output.citation_ids == ["evidence-1"]:
            prompt = "\n".join(message.content for message in request.messages)
            evidence_ids = re.findall(r'"evidenceId"\s*:\s*"([^"]+)"', prompt)
            if evidence_ids:
                labels = re.findall(r'"label"\s*:\s*"([^"]+)"', prompt)
                excerpts = re.findall(r'"excerpt"\s*:\s*"([^"]+)"', prompt)
                spanish = "respóndela en español" in prompt
                relationship = (
                    re.search(
                        r'"kind":"relationship","evidenceId":"([^"]+)",'
                        r'"sourceLabel":"([^"]+)","targetLabel":"([^"]+)".*?'
                        r'"relationship":"([^"]+)"',
                        prompt,
                    )
                    if '"questionCategory":"relationship"' in prompt
                    else None
                )
                path = (
                    re.search(
                        r'"kind":"path","evidenceId":"([^"]+)",'
                        r'"nodeLabels":(\[[^\]]*\])',
                        prompt,
                    )
                    if relationship is None
                    and '"questionCategory":"relationship"' in prompt
                    else None
                )
                citation_id = evidence_ids[0]
                if relationship:
                    citation_id, source, target, relation = relationship.groups()
                    answer = _relationship_answer(source, target, relation, spanish)
                elif path:
                    citation_id = path.group(1)
                    path_labels = json.loads(path.group(2))
                    joined = " → ".join(str(item) for item in path_labels)
                    answer = _path_answer(joined, spanish)
                elif labels and excerpts:
                    prefix = "Según" if spanish else "According to"
                    label = labels[0]
                    excerpt = " ".join(excerpts[0].split())
                    answer = _node_answer(prefix, label, excerpt, citation_id, spanish)
                else:
                    answer = (
                        "La evidencia suministrada respalda esta respuesta."
                        if spanish
                        else output.answer
                    )
                output = output.model_copy(
                    update={"answer": answer, "citation_ids": [citation_id]}
                )
        return ModelResult(
            output=output.model_copy(deep=True),
            model="deterministic-test-model",
            usage=TokenUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20),
            finish_reason="stop",
        )

    async def resolve_follow_up(self, request: FollowUpRequest) -> FollowUpResult:
        self.follow_up_requests.append(request.model_copy(deep=True))
        if self._follow_up_responder:
            output = self._follow_up_responder(request)
        elif self._follow_up:
            output = self._follow_up
        else:
            output = _deterministic_follow_up(request)
        return FollowUpResult(
            output=output.model_copy(deep=True),
            model="deterministic-test-model",
            usage=TokenUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20),
            finish_reason="stop",
        )


def _node_answer(
    prefix: str,
    label: str,
    excerpt: str,
    citation_id: str,
    spanish: bool,
) -> str:
    """Return a multi-paragraph, evidence-only answer for deterministic tests."""
    if spanish:
        return (
            f"{prefix} {label}, la evidencia recuperada indica: {excerpt}.\n\n"
            f"Este pasaje aporta la base documental directamente relacionada con "
            f"la consulta y permite identificar el alcance de {label}. La respuesta "
            "se limita al contenido textual recuperado; no agrega consecuencias, "
            "excepciones ni interpretaciones que no estén representadas en el "
            "grafo.\n\n"
            f"La afirmación está respaldada por la evidencia {citation_id}. Para un "
            "análisis más amplio deben revisarse los demás artículos o relaciones "
            "que Graphify haya recuperado para esta misma pregunta. Esta síntesis "
            "no sustituye la lectura integral de la norma ni pretende resolver "
            "cuestiones que no aparecen en el pasaje citado. Cualquier conclusión "
            "adicional "
            "requiere recuperar evidencia específica de otros artículos relacionados."
            " El resultado depende del conjunto de fuentes actualmente indexado."
        )
    return (
        f"{prefix} {label}, the retrieved evidence states: {excerpt}.\n\n"
        f"This passage provides the documentary basis directly related to the "
        f"question and helps define the scope of {label}. The answer is limited "
        "to the retrieved text; it does not add consequences, exceptions, or "
        "interpretations that are not represented in the graph.\n\n"
        f"The claim is supported by evidence {citation_id}. A broader analysis "
        "should review any other articles or relationships Graphify retrieved "
        "for this question. This synthesis does not replace reading the full "
        "legal text and does not resolve issues absent from the cited passage. "
        "Any additional conclusion requires retrieving specific evidence from "
        "related articles. "
        "The result depends on the sources currently indexed."
    )


def _relationship_answer(source: str, target: str, relation: str, spanish: bool) -> str:
    if spanish:
        return (
            f"{source} se relaciona con {target} mediante {relation}.\n\n"
            f"La relación explícita del grafo conecta ambos conceptos con ese tipo "
            "de vínculo; por tanto, describe una relación registrada y no una "
            "inferencia adicional.\n\n"
            "La interpretación queda limitada a la arista y a su procedencia "
            "recuperadas para esta consulta."
        )
    return (
        f"{source} relates to {target} through {relation}.\n\n"
        "The graph explicitly connects both concepts with that relationship type; "
        "it therefore reports a recorded link rather than an additional inference.\n\n"
        "The interpretation is limited to the edge and provenance retrieved for "
        "this question."
    )


def _path_answer(joined: str, spanish: bool) -> str:
    if spanish:
        return (
            f"La ruta de evidencia es {joined}.\n\n"
            "Esta secuencia muestra los nodos que Graphify conectó para la consulta "
            "y describe únicamente los pasos presentes en la ruta recuperada.\n\n"
            "No se agregan relaciones intermedias que no aparezcan en la evidencia."
        )
    return (
        f"The evidence path is {joined}.\n\n"
        "This sequence shows the nodes Graphify connected for the question and "
        "describes only the steps present in the retrieved path.\n\n"
        "No intermediate relationships are added beyond the supplied evidence."
    )


def _deterministic_follow_up(request: FollowUpRequest) -> FollowUpResolutionOutput:
    """Small test double, not a production language-resolution algorithm."""
    prompt = request.messages[-1].content
    payload_match = re.search(
        r"<conversation_request>\s*(\{.*\})\s*</conversation_request>",
        prompt,
        re.DOTALL,
    )
    payload = json.loads(payload_match.group(1)) if payload_match else {}
    question = str(payload.get("question", "")).strip()
    history = payload.get("history", [])
    lowered = question.lower()
    ambiguous = lowered in {
        "¿y eso?",
        "y eso?",
        "what about that?",
        "and that?",
    }
    if ambiguous:
        spanish = bool(re.search(r"[¿ñáéíóú]|\b(?:y|eso)\b", lowered))
        return FollowUpResolutionOutput(
            kind="clarification",
            clarification_question=(
                "¿A qué norma o concepto te refieres?"
                if spanish
                else "Which law or concept are you referring to?"
            ),
        )
    if history:
        prior = next(
            (
                str(turn.get("content", ""))
                for turn in reversed(history)
                if turn.get("role") == "user"
            ),
            "",
        )
        return FollowUpResolutionOutput(
            kind="resolved_follow_up",
            standalone_query=f"{prior} — {question}"[:4000],
            referenced_turn_ids=[
                str(turn.get("id"))
                for turn in history[-2:]
                if turn.get("id") is not None
            ],
        )
    return FollowUpResolutionOutput(kind="standalone", standalone_query=question)
