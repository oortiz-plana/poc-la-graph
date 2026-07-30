from app.prompts import system_prompt


def test_english_system_prompt_explicitly_requests_json_mode() -> None:
    prompt = system_prompt("en")

    assert "JSON object" in prompt
    assert "AnswerDraft" in prompt
    assert "Copy evidenceId exactly" in prompt
    assert "2 to 4 substantive paragraphs" in prompt
    assert "120 to 280 words" in prompt
    assert "categories, beneficiaries, requirements" in prompt
    assert "concise Markdown headings" in prompt
    assert "square brackets" in prompt


def test_spanish_system_prompt_explicitly_requests_json_mode() -> None:
    prompt = system_prompt("es")

    assert "objeto JSON" in prompt
    assert "AnswerDraft" in prompt
    assert "Copia evidenceId literalmente" in prompt
    assert "2 a 4 párrafos sustantivos" in prompt
    assert "120 a 280 palabras" in prompt
    assert "categorías, beneficiarios, requisitos" in prompt
    assert "encabezados y viñetas" in prompt
    assert "corchetes" in prompt
