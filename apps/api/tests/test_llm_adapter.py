from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.integrations.llm.client import FollowUpRequest, ModelRequest
from app.integrations.llm.errors import ModelResponseError
from app.integrations.llm.litellm_client import LiteLLMClient, _strict_response_format
from app.integrations.llm.models import (
    AnswerDraft,
    ChatMessage,
    FollowUpResolutionOutput,
)


@pytest.fixture
def client() -> LiteLLMClient:
    settings = SimpleNamespace(
        model="openai-compatible/model",
        api_base="http://provider.invalid/v1",
        api_key="secret",
        timeout=1.0,
        retries=0,
    )
    return LiteLLMClient(settings)


def test_valid_structured_response_and_usage(client: LiteLLMClient) -> None:
    response = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content='{"answer":"Grounded","confidence":"high",'
                    '"citation_ids":["c1"],"warnings":[]}'
                ),
                finish_reason="stop",
            )
        ],
        usage={"prompt_tokens": 4, "completion_tokens": 3, "total_tokens": 7},
        model="compatible",
    )
    result = client._normalize(response)
    assert result.output.citation_ids == ["c1"]
    assert result.usage.total_tokens == 7


@pytest.mark.parametrize(
    ("model", "name"),
    [
        (AnswerDraft, "answer_draft"),
        (FollowUpResolutionOutput, "follow_up_resolution"),
    ],
)
def test_strict_response_format_requires_the_complete_declared_shape(
    model: type[AnswerDraft] | type[FollowUpResolutionOutput], name: str
) -> None:
    response_format = _strict_response_format(model, name)
    definition = response_format["json_schema"]
    schema = definition["schema"]

    assert response_format["type"] == "json_schema"
    assert definition["name"] == name
    assert definition["strict"] is True
    assert set(schema["required"]) == set(schema["properties"])


async def test_operations_send_their_strict_schema(
    client: LiteLLMClient,
) -> None:
    answer_response = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content='{"answer":"Grounded","confidence":"high",'
                    '"citation_ids":[],"warnings":[]}'
                )
            )
        ]
    )
    complete = AsyncMock(return_value=answer_response)
    client._complete = complete  # type: ignore[method-assign]

    await client.generate(
        ModelRequest(messages=[ChatMessage(role="user", content="Question")])
    )

    answer_call = complete.await_args
    assert answer_call is not None
    answer_format = answer_call.kwargs["response_format"]
    assert answer_format["json_schema"]["name"] == "answer_draft"

    follow_up_response = SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content='{"kind":"standalone","standalone_query":"Question",'
                    '"clarification_question":null,"referenced_turn_ids":[]}'
                )
            )
        ]
    )
    complete.return_value = follow_up_response
    await client.resolve_follow_up(
        FollowUpRequest(messages=[ChatMessage(role="user", content="Question")])
    )

    follow_up_call = complete.await_args
    assert follow_up_call is not None
    follow_up_format = follow_up_call.kwargs["response_format"]
    assert follow_up_format["json_schema"]["name"] == "follow_up_resolution"


@pytest.mark.parametrize(
    "response",
    [
        # Gateways occasionally wrap JSON despite structured-output mode.
        SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content='```json\n{"answer":"Grounded","confidence":"medium",'
                        '"citation_ids":[],"warnings":[]}\n```'
                    )
                )
            ],
            model="compatible",
        ),
        SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="Here is the structured result:\n"
                        '{"answer":"Grounded","confidence":"medium",'
                        '"citation_ids":[],"warnings":[]}\n'
                    )
                )
            ]
        ),
        # Newer SDKs can expose parsed structured output directly.
        {
            "choices": [
                {
                    "message": {
                        "parsed": {
                            "answer": "Grounded",
                            "confidence": "high",
                            "citation_ids": ["c1"],
                            "warnings": [],
                        }
                    }
                }
            ],
            "model": "compatible",
        },
        # Some compatible endpoints return content parts rather than a string.
        {
            "choices": [
                {
                    "message": {
                        "content": [
                            {"type": "text", "text": '{"answer":"Grounded", '},
                            {
                                "type": "text",
                                "text": '"confidence":"low", "citation_ids":[]}',
                            },
                        ]
                    }
                }
            ]
        },
    ],
)
def test_common_structured_provider_shapes_are_normalized(
    client: LiteLLMClient, response: object
) -> None:
    result = client._normalize(response)
    assert result.output.answer == "Grounded"


@pytest.mark.parametrize(
    "response",
    [
        SimpleNamespace(choices=[]),
        SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="not-json"))]
        ),
        SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content='{"answer":"x","confidence":"high",'
                        '"citation_ids":["fabricated"],"unexpected":true}'
                    )
                )
            ]
        ),
    ],
)
def test_invalid_provider_response_is_sanitized(
    client: LiteLLMClient, response: object
) -> None:
    with pytest.raises(ModelResponseError) as caught:
        client._normalize(response)
    assert str(caught.value) == "The model returned an invalid structured response"
