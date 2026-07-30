from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.integrations.llm.errors import ModelResponseError
from app.integrations.llm.litellm_client import LiteLLMClient


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
    "response",
    [
        # Gateways occasionally wrap JSON despite response_format=json_object.
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
