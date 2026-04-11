"""Groq client shared by all agent modules."""

import os
from openai import OpenAI

# Llama 3.3 70B on Groq — free tier, fast, reliable
PARSER_MODEL = "llama-3.3-70b-versatile"
DIGEST_MODEL  = "llama-3.3-70b-versatile"


def get_client() -> OpenAI:
    return OpenAI(
        api_key=os.environ["GROQ_API_KEY"],
        base_url="https://api.groq.com/openai/v1",
    )
