from app.integrations.llm.client import ModelRequest
from app.integrations.llm.mock import DeterministicModel
from app.integrations.llm.models import ChatMessage


def _request(*, spanish: bool) -> ModelRequest:
    language_instruction = "respóndela en español" if spanish else "answer in English"
    context = (
        '{"questionCategory":"knowledge","nodes":[{"kind":"node",'
        '"evidenceId":"c-ley-100","label":"Ley 100 de 1993",'
        '"excerpt":"El artículo 10 organiza la protección del sistema."}]}'
    )
    return ModelRequest(
        messages=[
            ChatMessage(role="system", content="Answer only from evidence."),
            ChatMessage(
                role="user",
                content=(
                    f"Question ({language_instruction})\n"
                    f"<graph_evidence>{context}</graph_evidence>"
                ),
            ),
        ],
        temperature=0,
    )


async def test_deterministic_spanish_answer_has_grounded_detail() -> None:
    result = await DeterministicModel().generate(_request(spanish=True))

    paragraphs = [part for part in result.output.answer.split("\n\n") if part]
    assert 2 <= len(paragraphs) <= 4
    assert 120 <= len(result.output.answer.split()) <= 280
    assert "Ley 100 de 1993" in result.output.answer
    assert "El artículo 10 organiza" in result.output.answer
    assert result.output.citation_ids == ["c-ley-100"]


async def test_deterministic_english_answer_has_grounded_detail() -> None:
    result = await DeterministicModel().generate(_request(spanish=False))

    paragraphs = [part for part in result.output.answer.split("\n\n") if part]
    assert 2 <= len(paragraphs) <= 4
    assert 120 <= len(result.output.answer.split()) <= 280
    assert "Pension" not in result.output.answer
    assert "Ley 100 de 1993" in result.output.answer
