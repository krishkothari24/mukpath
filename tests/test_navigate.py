"""
Checks Scraper.navigate against a stubbed conversation.

    python3 tests/test_navigate.py

Regression test for a real failure: the NC27 bot answers /start with two
messages at once — the language prompt and the main menu. After pressing a
language button the bot replies with only a confirmation, so the main menu
is one message *behind* the newest reply. Searching just the newest reply
made every walk die with "button 'Open Mukhpath Material' not offered here".

Needs telethon importable (the scraper exits at import without it); skips
cleanly if it isn't. Run with .venv/bin/python after scripts/setup.sh.
"""

import asyncio
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

try:
    import mukhpath_scraper as scraper
except SystemExit:
    print("skipped: telethon not installed (run ./scripts/setup.sh)")
    sys.exit(0)

failures = []


def check(label, actual, expected):
    if actual != expected:
        failures.append(f"{label}\n    expected: {expected!r}\n    actual:   {actual!r}")


class FakeButton:
    def __init__(self, text):
        self.text = text


class FakeMessage:
    def __init__(self, conv, id, text, buttons=()):
        self.conv = conv
        self.id = id
        self.text = text
        self.buttons = [[FakeButton(b) for b in buttons]] if buttons else None
        self.media = None

    async def click(self, text=None):
        self.conv.record(("click", text))


class FakeConv:
    """Replays a scripted bot: action -> list of reply messages."""

    def __init__(self, script):
        self.script = script
        self.actions = []
        self.pending = []
        self._next_id = 100

    def record(self, action):
        self.actions.append(action)
        label = action[1]
        for text, buttons in self.script.get(label, []):
            self._next_id += 1
            self.pending.append(
                FakeMessage(self, self._next_id, text, buttons))

    async def send_message(self, text):
        self.record(("send", text))

    async def get_response(self, timeout=None):
        if not self.pending:
            raise asyncio.TimeoutError
        return self.pending.pop(0)


# Exactly what the real bot does.
SCRIPT = {
    "/start": [
        ("Jai Swaminarayan.\nChoose your preferred answer language.",
         ["Transliteration", "English", "Gujarati"]),
        ("Your main menu is ready.",
         ["Open Mukhpath Material", "Practice", "Quiz", "Polls",
          "Progress", "Language", "Help", "Reset"]),
    ],
    # Note: no main menu in this reply. That's the whole point.
    "Transliteration": [("Answer language set to Transliteration.", [])],
    "Open Mukhpath Material": [("Pick a text:", ["Satsang Diksha", "Back"])],
    "Satsang Diksha": [("1. Swaminarayanah Shriman", ["Back"])],
}


def make_scraper(tmp, **overrides):
    args = types.SimpleNamespace(
        output=str(Path(tmp) / "dump.json"), media_dir=str(Path(tmp) / "media"),
        mode="auto", language=None, branch=None, delay=0, first_timeout=0.01,
        idle_timeout=0.01, max_messages_per_step=25, skip_media=True,
        resume=False, bot="testbot", max_depth=6, max_nodes=100,
        follow_nav=False, include_features=False, dry_run=False,
    )
    for key, value in overrides.items():
        setattr(args, key, value)
    return scraper.Scraper(client=None, args=args)


async def run_checks(tmp):
    # --- the regression: menu is behind the language confirmation ---
    s = make_scraper(tmp, language="Transliteration")
    conv = FakeConv(SCRIPT)
    messages = await s.navigate(conv, ["Open Mukhpath Material"])
    check("language button was pressed",
          ("click", "Transliteration") in conv.actions, True)
    check("reached the content menu",
          [m.text for m in messages], ["Pick a text:"])
    check("returns only the final reply, not the walk-through",
          len(messages), 1)

    # --- two levels deep, same conversation ---
    s = make_scraper(tmp, language="Transliteration")
    conv = FakeConv(SCRIPT)
    messages = await s.navigate(conv, ["Open Mukhpath Material", "Satsang Diksha"])
    check("two levels deep", [m.text for m in messages],
          ["1. Swaminarayanah Shriman"])

    # --- language prompt absent (already set) is not an error ---
    script = dict(SCRIPT)
    script["/start"] = [("Your main menu is ready.",
                         ["Open Mukhpath Material", "Reset"])]
    s = make_scraper(tmp, language="Gujarati")
    conv = FakeConv(script)
    messages = await s.navigate(conv, ["Open Mukhpath Material"])
    check("missing language prompt tolerated",
          [m.text for m in messages], ["Pick a text:"])
    check("no language click attempted",
          any(a == ("click", "Gujarati") for a in conv.actions), False)

    # --- a genuinely missing button reports what was on offer ---
    s = make_scraper(tmp)
    conv = FakeConv(SCRIPT)
    try:
        await s.navigate(conv, ["Nonexistent"])
        failures.append("missing button should have raised")
    except LookupError as exc:
        check("error names the button", "'Nonexistent'" in str(exc), True)
        check("error lists what was available",
              "Open Mukhpath Material" in str(exc), True)

    # --- Reset is unreachable even if something asks for it directly ---
    s = make_scraper(tmp)
    conv = FakeConv(SCRIPT)
    await conv.send_message("/start")
    seen = await s.drain(conv)
    target = s.find_button(seen, "Reset")
    check("Reset button is present in the menu", target is not None, True)
    try:
        await s.press(conv, target, "Reset")
        failures.append("press('Reset') should have raised")
    except PermissionError:
        pass
    check("Reset was never clicked",
          any(a == ("click", "Reset") for a in conv.actions), False)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        asyncio.run(run_checks(tmp))
    if failures:
        print(f"FAILED ({len(failures)})\n")
        for failure in failures:
            print(" ", failure)
        return 1
    print("all navigate checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
