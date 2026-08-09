"""
Checks the scraper's button classification against the real NC27 bot menu.

    python3 tests/test_buttons.py

This matters more than it looks: the bot is someone else's and holds real
user state. Pressing Reset wipes progress; Quiz and Polls submit answers
and votes. The walk enumerates every button it sees, so these predicates
are the only thing standing between a scrape and a mess.

Uses `ast` to pull the predicates out rather than importing the module,
so it runs without telethon installed.
"""

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRAPER = ROOT / "tools" / "mukhpath_scraper.py"

# The actual main menu, from a --dry-run against @nc27mukhpathguidebot.
LIVE_MAIN_MENU = ["Open Mukhpath Material", "Practice", "Quiz", "Polls",
                  "Progress", "Language", "Help", "Reset"]
LIVE_LANGUAGE_MENU = ["Transliteration", "English", "Gujarati"]

failures = []


def check(label, actual, expected):
    if actual != expected:
        failures.append(f"{label}\n    expected: {expected!r}\n    actual:   {actual!r}")


def load_predicates():
    tree = ast.parse(SCRAPER.read_text(encoding="utf-8"))
    wanted = {"NAV_BUTTON_RE", "DESTRUCTIVE_BUTTON_RE", "FEATURE_BUTTON_RE",
              "is_nav_button", "is_destructive_button", "is_feature_button"}
    body = [n for n in tree.body
            if (isinstance(n, ast.FunctionDef) and n.name in wanted)
            or (isinstance(n, ast.Assign)
                and any(getattr(t, "id", None) in wanted for t in n.targets))]
    namespace = {"re": __import__("re")}
    exec(compile(ast.Module(body, []), "<predicates>", "exec"), namespace)
    return namespace


def main():
    ns = load_predicates()
    destructive = ns["is_destructive_button"]
    feature = ns["is_feature_button"]
    nav = ns["is_nav_button"]

    # --- the ones that must never be pressed ---
    for label in ("Reset", "Quiz", "Polls", "reset", "🔴 Reset",
                  "Delete my data", "Clear progress", "Unsubscribe",
                  "Vote", "Submit answer"):
        check(f"destructive: {label!r}", destructive(label), True)

    # --- content buttons must survive all three filters ---
    for label in ("Open Mukhpath Material", "Satsang Diksha", "Nitya Niyam",
                  "Cheshta", "Shloks 1-10", "Basic Mukhpath"):
        check(f"content not destructive: {label!r}", destructive(label), False)
        check(f"content not feature: {label!r}", feature(label), False)
        check(f"content not nav: {label!r}", nav(label), False)

    # --- 'Practice' is a bot feature, but must not read as destructive ---
    check("Practice is a feature", feature("Practice"), True)
    check("Practice is not destructive", destructive("Practice"), False)

    # --- the live menu, classified end to end ---
    walked = [b for b in LIVE_MAIN_MENU
              if not destructive(b) and not feature(b) and not nav(b)]
    check("only the content branch is walked", walked, ["Open Mukhpath Material"])
    check("Reset/Quiz/Polls all refused",
          sorted(b for b in LIVE_MAIN_MENU if destructive(b)),
          ["Polls", "Quiz", "Reset"])

    # --- language options are plain buttons, not filtered ---
    for label in LIVE_LANGUAGE_MENU:
        check(f"language option pressable: {label!r}",
              destructive(label) or feature(label) or nav(label), False)

    # --- nav buttons still detected ---
    for label in ("Back", "⬅️ Back", "Main Menu", "🔙"):
        check(f"nav: {label!r}", nav(label), True)

    if failures:
        print(f"FAILED ({len(failures)})\n")
        for failure in failures:
            print(" ", failure)
        return 1
    print("all button-guard checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
