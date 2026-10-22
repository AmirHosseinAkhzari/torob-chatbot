"""Settings, read from the repository's .env (git-ignored) with environment overrides."""
import os
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".env"


def _load_env_file() -> None:
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()


@dataclass(frozen=True)
class Settings:
    neo4j_uri: str = os.environ.get("NEO4J_URI", f"bolt://localhost:{os.environ.get('NEO4J_BOLT_PORT', '7688')}")
    neo4j_user: str = os.environ.get("NEO4J_USER", "neo4j")
    neo4j_password: str = os.environ.get("NEO4J_PASSWORD", "")
    neo4j_database: str = os.environ.get("NEO4J_DATABASE", "neo4j")

    openai_base_url: str = os.environ.get("OPENAI_BASE_URL", "https://ai.boxapi.ir/ai/v1")
    openai_api_key: str = os.environ.get("OPENAI_API_KEY", "")
    openai_model: str = os.environ.get("OPENAI_MODEL", "openai/gpt-6.1-sol")
    openai_reasoning_effort: str = os.environ.get("OPENAI_REASONING_EFFORT", "low")

    frontend_origin: str = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")


settings = Settings()
