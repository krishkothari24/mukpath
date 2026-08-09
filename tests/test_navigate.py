"""
Checks Scraper.navigate against a stubbed Telegram client.

    python3 tests/test_navigate.py

Regression tests for two real failures against @nc27mukhpathguidebot:

1. The bot answers /start with two messages at once — the language prompt
   and the main menu. Pressing a language button returns only a
   confirmation, so the main menu sits one message *behind* the newest
   reply. Searching just the newest reply made every walk die with
   "button 'Open Mukhpath Material' not offered here".

2. Replies were being dropped entirely, producing nodes with zero
   messages. telethon's Conversation.get_response() leaves a dead future
   behind when it times out; the next message lands on that future and is
   lost. The scraper now collects messages through a NewMessage handler,
   so a message can never arrive with nobody listening.

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
    def __init__(self, client, id, text, buttons=()):
        self.client = client
        self.id = id
        self.text = text
        self.buttons = [[FakeButton(b) for b in buttons]] if buttons else None
        self.media = None

    async def click(self, text=None):
        await self.client.act(("click", text))


class FakeEvent:
    def __init__(self, message):
        self.message = message


class FakeClient:
    """Replays a scripted bot: action label -> list of reply messages.

    Deliberately delivers replies the way telethon does — by invoking the
    registered NewMessage handler — so the test exercises the real
    collection path rather than a shortcut.
    """

    def __init__(self, script, delay_delivery=False):
        self.script = script
        self.actions = []
        self.handler = None
        self.delay_delivery = delay_delivery
        self._next_id = 100

    def on(self, event):
        def register(func):
            self.handler = func
            return func
        return register

    async def act(self, action):
        self.actions.append(action)
        label = action[1]
        for text, buttons in self.script.get(label, []):
            self._next_id += 1
            message = FakeMessage(self, self._next_id, text, buttons)
            if self.delay_delivery:
                # Arrive a beat late, after the caller has stopped waiting.
                await asyncio.sleep(0)
            await self.handler(FakeEvent(message))

    async def send_message(self, chat, text):
        await self.act(("send", text))


# Exactly what the real bot does.
SCRIPT = {
    "/start": [
        ("Jai Swaminarayan.\nChoose your preferred answer language.",
         ["Transliteration", "English", "Gujarati"]),
        ("Your main menu is ready.",
         ["Open Mukhpath Material", "Practice", "Quiz", "Polls",
          "Progress", "Language", "Help", "Reset"]),
    ],
    # Note: no main menu in this reply. That's the whole point of case 1.
    "Transliteration": [("Answer language set to Transliteration.", [])],
    "Open Mukhpath Material": [("Pick a text:", ["Satsang Diksha", "Back"])],
    "Satsang Diksha": [("1. Swaminarayanah Shriman", ["Back"])],
}


def make_scraper(tmp, client, **overrides):
    args = types.SimpleNamespace(
        output=str(Path(tmp) / "dump.json"), media_dir=str(Path(tmp) / "media"),
        mode="auto", language=None, branch=None, delay=0, first_timeout=0.5,
        idle_timeout=0.05, max_messages_per_step=25, skip_media=True,
        resume=False, bot="testbot", max_depth=6, max_nodes=100,
        follow_nav=False, include_features=False, dry_run=False,
    )
    for key, value in overrides.items():
        setattr(args, key, value)
    s = scraper.Scraper(client=client, args=args)
    s.listen()
    return s


async def run_checks(tmp):
    # --- case 1: menu is behind the language confirmation ---
    client = FakeClient(SCRIPT)
    s = make_scraper(tmp, client, language="Transliteration")
    messages = await s.navigate(["Open Mukhpath Material"])
    check("language button was pressed",
          ("click", "Transliteration") in client.actions, True)
    check("reached the content menu",
          [m.text for m in messages], ["Pick a text:"])
    check("returns only the final reply", len(messages), 1)

    # --- case 2: nothing is lost when replies arrive late ---
    client = FakeClient(SCRIPT, delay_delivery=True)
    s = make_scraper(tmp, client, language="Transliteration")
    messages = await s.navigate(["Open Mukhpath Material"])
    check("late replies still collected",
          [m.text for m in messages], ["Pick a text:"])

    # --- a full two-level walk captures content, not empty nodes ---
    client = FakeClient(SCRIPT)
    s = make_scraper(tmp, client, language="Transliteration",
                     branch="Open Mukhpath Material")
    await s.run()
    captured = {tuple(n["path"]): n for n in s.nodes.values()}
    check("walked both levels", sorted(captured), [
        ("Open Mukhpath Material",),
        ("Open Mukhpath Material", "Satsang Diksha"),
    ])
    check("no node came back empty",
          [p for p, n in captured.items() if not n.get("messages")], [])
    verse = captured[("Open Mukhpath Material", "Satsang Diksha")]
    check("verse text captured",
          [m["text"] for m in verse["messages"]], ["1. Swaminarayanah Shriman"])

    # --- language prompt absent (already set) is not an error ---
    script = dict(SCRIPT)
    script["/start"] = [("Your main menu is ready.",
                         ["Open Mukhpath Material", "Reset"])]
    client = FakeClient(script)
    s = make_scraper(tmp, client, language="Gujarati")
    messages = await s.navigate(["Open Mukhpath Material"])
    check("missing language prompt tolerated",
          [m.text for m in messages], ["Pick a text:"])
    check("no language click attempted",
          any(a == ("click", "Gujarati") for a in client.actions), False)

    # --- a genuinely missing button reports what was on offer ---
    client = FakeClient(SCRIPT)
    s = make_scraper(tmp, client)
    try:
        await s.navigate(["Nonexistent"])
        failures.append("missing button should have raised")
    except LookupError as exc:
        check("error names the button", "'Nonexistent'" in str(exc), True)
        check("error lists what was available",
              "Open Mukhpath Material" in str(exc), True)

    # --- Reset is unreachable even if something asks for it directly ---
    client = FakeClient(SCRIPT)
    s = make_scraper(tmp, client)
    await s.send("/start")
    seen = await s.drain()
    target = s.find_button(seen, "Reset")
    check("Reset is present in the menu", target is not None, True)
    try:
        await s.press(target, "Reset")
        failures.append("press('Reset') should have raised")
    except PermissionError:
        pass
    check("Reset was never clicked",
          any(a == ("click", "Reset") for a in client.actions), False)


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
