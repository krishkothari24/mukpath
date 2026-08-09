"""
Checks the .env loader in tools/mukhpath_scraper.py.

    python3 tests/test_dotenv.py

Extracts load_dotenv with `ast` rather than importing the module, so this
runs without telethon installed (the scraper exits at import time if it's
missing). Everything else in that file needs a Telegram session to
exercise; this function doesn't, so it's worth pinning down.
"""

import ast
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRAPER = ROOT / "tools" / "mukhpath_scraper.py"

failures = []


def check(label, actual, expected):
    if actual != expected:
        failures.append(f"{label}\n    expected: {expected!r}\n    actual:   {actual!r}")


def extract_load_dotenv():
    tree = ast.parse(SCRAPER.read_text(encoding="utf-8"))
    fn = next(n for n in tree.body
              if isinstance(n, ast.FunctionDef) and n.name == "load_dotenv")
    namespace = {"os": os, "Path": Path, "__file__": str(SCRAPER)}
    exec(compile(ast.Module([fn], []), "<load_dotenv>", "exec"), namespace)
    return namespace["load_dotenv"]


def main():
    load_dotenv = extract_load_dotenv()
    managed = ("API_ID", "API_HASH", "BOT", "EXPORTED", "SPACED", "EMPTY",
               "NOEQUALS", "DUPED", "PRESET")

    with tempfile.TemporaryDirectory() as tmp:
        env_file = Path(tmp) / ".env"
        env_file.write_text(
            "# a comment\n"
            "\n"
            "API_ID=1234567\n"
            'API_HASH="quoted_hash"\n'
            "BOT='single_quoted'\n"
            "export EXPORTED=yes\n"
            "  SPACED  =  padded  \n"
            "EMPTY=\n"
            "NOEQUALS\n"
            "DUPED=first\n"
            "DUPED=second\n"
            "PRESET=from_file\n",
            encoding="utf-8",
        )
        for key in managed:
            os.environ.pop(key, None)
        os.environ["PRESET"] = "from_environment"

        load_dotenv(env_file)

        check("plain value", os.environ.get("API_ID"), "1234567")
        check("double quotes stripped", os.environ.get("API_HASH"), "quoted_hash")
        check("single quotes stripped", os.environ.get("BOT"), "single_quoted")
        check("export prefix handled", os.environ.get("EXPORTED"), "yes")
        check("whitespace trimmed", os.environ.get("SPACED"), "padded")
        check("blank value left unset", os.environ.get("EMPTY"), None)
        check("malformed line skipped", os.environ.get("NOEQUALS"), None)
        # Appending an override to the bottom of .env should win.
        check("duplicate key: last wins", os.environ.get("DUPED"), "second")
        # So `API_ID=x python3 tools/...` still overrides the file.
        check("real environment beats .env",
              os.environ.get("PRESET"), "from_environment")

    # A missing .env is the normal case before setup; must not raise.
    load_dotenv(Path(tempfile.gettempdir()) / "definitely-not-here.env")

    # The committed template must parse, and must not set credentials.
    for key in ("TELEGRAM_API_ID", "TELEGRAM_API_HASH", "MUKHPATH_BOT"):
        os.environ.pop(key, None)
    load_dotenv(ROOT / ".env.example")
    check("template leaves API_ID blank", os.environ.get("TELEGRAM_API_ID"), None)
    check("template leaves API_HASH blank", os.environ.get("TELEGRAM_API_HASH"), None)
    check("template sets the bot name",
          os.environ.get("MUKHPATH_BOT"), "nc27mukhpathguidebot")

    if failures:
        print(f"FAILED ({len(failures)})\n")
        for failure in failures:
            print(" ", failure)
        return 1
    print("all .env loader checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
