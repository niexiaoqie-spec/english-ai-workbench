import os
import json
from openai import AsyncOpenAI
import database


async def _get_api_key():
    """Get Kimi API key from settings table or environment variable."""
    key = await database.get_setting("kimi_api_key", "")
    if key:
        return key
    return os.environ.get("KIMI_API_KEY", "")


def _get_client(api_key: str) -> AsyncOpenAI:
    """Create an AsyncOpenAI client configured for Kimi API."""
    return AsyncOpenAI(
        api_key=api_key,
        base_url="https://api.moonshot.cn/v1",
    )


async def chat(prompt: str, system_prompt: str = "", model: str = "kimi-k3", temperature: float = 1.0) -> str:
    """Send a chat completion request to Kimi API.

    Note: For kimi-k3, temperature MUST be 1.0 (only valid value).
    """
    api_key = await _get_api_key()
    if not api_key:
        raise ValueError("Kimi API key not configured. Set it via /api/settings or KIMI_API_KEY env var.")

    client = _get_client(api_key)
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    # kimi-k3 only supports temperature=1.0
    if model == "kimi-k3":
        temperature = 1.0

    response = await client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
    )
    return response.choices[0].message.content or ""


async def chat_json(prompt: str, system_prompt: str = "") -> dict:
    """Send a chat request and parse the response as JSON."""
    json_system = (
        "You are a helpful assistant. Always respond with valid JSON only. "
        "Do not include markdown code fences or any text outside the JSON object."
    )
    if system_prompt:
        json_system = system_prompt + "\n\n" + json_system

    result = await chat(prompt, system_prompt=json_system)

    # Strip markdown code fences if present
    result = result.strip()
    if result.startswith("```"):
        lines = result.split("\n")
        # Remove first line (```json or ```) and last line (```)
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        result = "\n".join(lines)

    try:
        return json.loads(result)
    except json.JSONDecodeError:
        # Fallback: extract outermost JSON object from surrounding prose
        start = result.find("{")
        end = result.rfind("}")
        if start != -1 and end > start:
            return json.loads(result[start:end + 1])
        raise


async def analyze_text(text: str, level: str = "intermediate") -> dict:
    """Analyze English text and return structured learning content.

    Returns: {summary, vocabulary: [{word, phonetic, definition, definition_cn, example, difficulty}],
              comprehension_questions: [str], grammar_points: [str]}
    """
    prompt = f"""Analyze the following English text for a {level}-level English learner.

Text:
\"\"\"
{text}
\"\"\"

Provide a JSON response with exactly this structure:
{{
  "summary": "A brief summary of the text in English (2-3 sentences)",
  "vocabulary": [
    {{
      "word": "the word",
      "phonetic": "IPA phonetic transcription",
      "definition": "English definition",
      "definition_cn": "Chinese definition",
      "example": "An example sentence using this word",
      "difficulty": 3
    }}
  ],
  "comprehension_questions": ["Question 1?", "Question 2?", "Question 3?"],
  "grammar_points": ["Grammar point 1", "Grammar point 2"]
}}

Rules:
- Extract 5-10 vocabulary words appropriate for a {level} learner
- difficulty should be 1-5 (1=easy, 5=very hard)
- Include 3-5 comprehension questions
- Include 2-4 grammar points found in the text
- All text values should be strings, difficulty should be an integer
- Respond ONLY with the JSON object, no other text"""

    return await chat_json(prompt)


async def evaluate_speaking(scenario: str, user_message: str, conversation_history: list) -> dict:
    """Evaluate a user's speaking/writing in a conversation scenario.

    Returns: {response, correction, score, tips}
    """
    history_text = ""
    if conversation_history:
        history_text = "\n".join(
            f"{msg.get('role', 'user')}: {msg.get('content', '')}"
            for msg in conversation_history
        )

    prompt = f"""You are an English conversation partner helping a Chinese speaker practice English.

Scenario: {scenario}

Conversation so far:
{history_text}

User's latest message: "{user_message}"

Provide a JSON response with exactly this structure:
{{
  "response": "Your natural conversational reply to the user (in English, as the conversation partner)",
  "correction": "If the user made errors, provide the corrected version of their message. If no errors, say 'No corrections needed.'",
  "score": 85,
  "tips": ["Tip 1 for improvement", "Tip 2"]
}}

Rules:
- score is 0-100 based on grammar, vocabulary, fluency, and appropriateness
- response should be natural and keep the conversation going
- correction should show the corrected version if there are errors
- tips should be 1-3 actionable suggestions
- Respond ONLY with the JSON object, no other text"""

    return await chat_json(prompt)


async def generate_listening_comprehension(text: str) -> dict:
    """Generate listening comprehension questions from text.

    Returns: {questions: [{question, options: [str], answer}], key_phrases: [str]}
    """
    prompt = f"""Generate listening comprehension questions for the following text.

Text:
\"\"\"
{text}
\"\"\"

Provide a JSON response with exactly this structure:
{{
  "questions": [
    {{
      "question": "What is the main topic?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answer": 0
    }}
  ],
  "key_phrases": ["phrase 1", "phrase 2", "phrase 3"]
}}

Rules:
- Generate 3-5 multiple choice questions
- Each question has exactly 4 options
- answer is the 0-based index of the correct option
- key_phrases should be 3-6 important phrases from the text
- Questions should test comprehension, not just memory
- Respond ONLY with the JSON object, no other text"""

    return await chat_json(prompt)


async def generate_daily_words(count: int = 30, category: str = "business") -> dict:
    """Generate daily vocabulary words focused on business/work English.

    Returns: {words: [{word, phonetic, pos, definition, definition_cn, collocations: [str],
             example, example_cn, mnemonic, category, difficulty}],
             quiz: [{word, question_type, question, options: [str], answer}]}
    """
    prompt = f"""You are an expert business English curriculum designer for Chinese professionals.

Generate exactly {count} business/work English vocabulary words at an intermediate-advanced level (CEFR B2-C1). These should be words a Chinese professional would encounter in meetings, emails, reports, and presentations — NOT common basic words (avoid words like "meeting", "work", "important", "good").

For EACH word, provide:
- "word": the English word
- "phonetic": IPA phonetic transcription (e.g. "/ˈleɪ.ər.ɪdʒ/")
- "pos": part of speech (e.g. "n.", "v.", "adj.", "adv.")
- "definition": concise English definition
- "definition_cn": accurate Chinese definition
- "collocations": an array of 2-3 common collocations/phrases using this word
- "example": a natural example sentence in a business context (meetings, emails, reports, presentations)
- "example_cn": Chinese translation of the example sentence
- "mnemonic": a creative memory tip in Chinese — you may use 谐音 (homophone), 联想 (association), or 词根词缀 (root/affix analysis)
- "category": a sub-category, rotating among: 商务策略, 职场沟通, 金融财务, 市场营销, 项目管理, 人力资源, 商务写作, 谈判技巧
- "difficulty": integer 1-5 (1=easy, 5=very hard); most should be 3-5

Distribute the words across the categories above so they rotate evenly.

Also generate exactly 10 quiz questions based on the words you generated. Use a mix of these question_type values:
- "meaning": e.g. "What does 'leverage' mean?"
- "fill_blank": e.g. "Complete the sentence: We need to ___ our resources more effectively."
- "collocation": e.g. "Which phrase is correct?"

For EACH quiz question provide:
- "word": the target word being tested
- "question_type": one of "meaning", "fill_blank", "collocation"
- "question": the question text
- "options": an array of exactly 4 option strings
- "answer": the 0-based index of the correct option (0, 1, 2, or 3)

Respond with a JSON object of EXACTLY this structure:
{{
  "words": [
    {{
      "word": "leverage",
      "phonetic": "/ˈlev.ər.ɪdʒ/",
      "pos": "v.",
      "definition": "to use something to maximum advantage",
      "definition_cn": "充分利用，发挥……的作用",
      "collocations": ["leverage resources", "leverage expertise", "leverage an opportunity"],
      "example": "We should leverage our existing partnerships to enter new markets.",
      "example_cn": "我们应该利用现有的合作伙伴关系来开拓新市场。",
      "mnemonic": "lever(杠杆)+age → 像杠杆一样撬动资源 → 充分利用",
      "category": "商务策略",
      "difficulty": 4
    }}
  ],
  "quiz": [
    {{
      "word": "leverage",
      "question_type": "meaning",
      "question": "What does 'leverage' mean in a business context?",
      "options": ["To ignore", "To use to maximum advantage", "To reduce", "To postpone"],
      "answer": 1
    }}
  ]
}}

Rules:
- Generate EXACTLY {count} words and EXACTLY 10 quiz questions.
- All quiz options arrays must have exactly 4 items.
- "answer" must be a valid 0-based index (0-3).
- Quiz questions must reference words that appear in the "words" array.
- CRITICAL: Never use the double-quote character (") inside any string value. For inner quotations use 「」 or 『』 instead. Every string must be on a single line with no unescaped quotes.
- Respond ONLY with valid JSON. No markdown code fences, no explanations, no text outside the JSON object."""

    try:
        return await chat_json(prompt)
    except json.JSONDecodeError:
        # One retry with explicit repair instruction
        repair = (
            prompt
            + "\n\nIMPORTANT: Your previous response was NOT valid JSON (likely unescaped double quotes inside string values). "
            "Regenerate the response now as STRICTLY valid JSON, replacing all inner double quotes with 「」."
        )
        return await chat_json(repair)
