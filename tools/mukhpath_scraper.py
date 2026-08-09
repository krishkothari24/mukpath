"""
Telegram bot content scraper for nc27mukhpathguidebot.

Walks the bot's menu tree and logs every text response, button label, and
media file so you can rebuild the mukhpath content structure locally.
Output feeds `scripts/parse_dump.py`.

This only automates clicking - it does not access anything you couldn't
see yourself as a normal user of the bot.

SETUP
  1. Get api_id / api_hash from https://my.telegram.org (log in with your
     own phone number -> API development tools -> create an app).
  2. pip install -r tools/requirements.txt
  3. export TELEGRAM_API_ID=... TELEGRAM_API_HASH=...
  4. Open the bot in Telegram yourself first and click around, so you know
     which --mode to use:
       inline    buttons attached under the bot's messages
       keyboard  buttons in a panel below the text box
       auto      (default) detect per message

USAGE
  python3 tools/mukhpath_scraper.py                    # full walk
  python3 tools/mukhpath_scraper.py --dry-run          # just /start, no walk
  python3 tools/mukhpath_scraper.py --max-depth 3

The walk is replay-based: for every menu path it re-sends /start and
re-clicks the path from the top. That is slower than clicking around from
wherever you happen to be, but it is the only approach that works for a
bot with conversation state, and it means an interrupted run can resume
(state is checkpointed to <output>.state.json after every node).
"""

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

try:
    from telethon import TelegramClient
    from telethon.errors import FloodWaitError
except ImportError:
    sys.exit(
        "telethon is not installed.\n"
        "  pip install -r tools/requirements.txt"
    )

DEFAULT_BOT = "nc27mukhpathguidebot"

# Buttons that navigate rather than reveal content. Following these just
# re-walks parts of the tree we already have, under a longer path.
NAV_BUTTON_RE = re.compile(
    r"^\W*(back|go back|main menu|menu|home|start|cancel|exit|previous|"
    r"next page|prev|«|»|⬅|➡|🔙|🏠)\W*$",
    re.IGNORECASE,
)


def is_nav_button(label: str) -> bool:
    return bool(NAV_BUTTON_RE.match(label.strip()))


def button_kind(btn) -> str:
    """'inline' if the button is attached to the message, else 'keyboard'."""
    name = type(getattr(btn, "button", btn)).__name__
    return "keyboard" if name in ("KeyboardButton", "KeyboardButtonRow") else "inline"


class Scraper:
    def __init__(self, client, args):
        self.client = client
        self.args = args
        self.out_path = Path(args.output)
        self.state_path = self.out_path.with_suffix(".state.json")
        self.media_dir = Path(args.media_dir)
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.nodes = {}          # path-key -> node dict
        self.done = set()        # path-keys already captured
        self.queue = []          # list[list[str]] paths still to visit
        self.media_seen = {}     # telegram file id -> local path

    # ---------- persistence ----------

    def load_state(self):
        if not (self.args.resume and self.state_path.exists()):
            return False
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.nodes = state["nodes"]
        self.done = set(state["done"])
        self.queue = state["queue"]
        self.media_seen = state.get("media_seen", {})
        print(f"resumed: {len(self.done)} nodes captured, {len(self.queue)} queued")
        return True

    def save(self):
        self.state_path.write_text(
            json.dumps(
                {
                    "nodes": self.nodes,
                    "done": sorted(self.done),
                    "queue": self.queue,
                    "media_seen": self.media_seen,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        self.out_path.write_text(
            json.dumps(
                {
                    "bot": self.args.bot,
                    "nodes": [self.nodes[k] for k in sorted(self.nodes)],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    # ---------- telegram plumbing ----------

    async def drain(self, conv):
        """Collect every message the bot sends in response to one action.

        Bots routinely reply with several messages (header, verse, audio).
        Waiting for exactly one would silently drop most of the content.
        """
        messages = []
        timeout = self.args.first_timeout
        while True:
            try:
                msg = await conv.get_response(timeout=timeout)
            except asyncio.TimeoutError:
                break
            messages.append(msg)
            timeout = self.args.idle_timeout
            if len(messages) >= self.args.max_messages_per_step:
                break
        return messages

    async def capture(self, msg, path):
        entry = {
            "id": msg.id,
            "text": msg.text,
            "buttons": [],
            "button_kind": None,
        }
        if msg.buttons:
            for row in msg.buttons:
                for btn in row:
                    entry["buttons"].append(btn.text)
                    entry["button_kind"] = button_kind(btn)
        if msg.media:
            entry["media"] = await self.download(msg, path)
        return entry

    async def download(self, msg, path):
        if self.args.skip_media:
            return {"skipped": True}
        # Dedupe: the bot may attach the same audio under several paths.
        file_id = getattr(getattr(msg, "file", None), "id", None)
        if file_id and file_id in self.media_seen:
            return {"path": self.media_seen[file_id], "deduped": True}
        slug = slugify(" ".join(path)) or "root"
        prefix = self.media_dir / f"{slug}-{msg.id}"
        try:
            local = await msg.download_media(file=str(prefix))
        except Exception as exc:                        # noqa: BLE001
            print(f"  ! media download failed at {' > '.join(path)}: {exc}")
            return {"error": str(exc)}
        if local:
            # Store a repo-relative path when we can, so the dump stays
            # portable; fall back to whatever telethon gave us.
            try:
                local = str(Path(local).resolve().relative_to(Path.cwd()))
            except ValueError:
                local = str(local)
        if file_id and local:
            self.media_seen[file_id] = local
        return {
            "path": local,
            "mime": getattr(getattr(msg, "file", None), "mime_type", None),
            "duration": getattr(getattr(msg, "file", None), "duration", None),
        }

    async def navigate(self, conv, path):
        """Replay `path` from /start. Returns the messages at the end of it."""
        await conv.send_message("/start")
        messages = await self.drain(conv)
        for label in path:
            target = next(
                (m for m in reversed(messages) if m.buttons
                 and any(b.text == label for row in m.buttons for b in row)),
                None,
            )
            if target is None:
                raise LookupError(f"button '{label}' not offered here")
            kind = self.args.mode
            if kind == "auto":
                kind = next(
                    button_kind(b)
                    for row in target.buttons for b in row if b.text == label
                )
            if kind == "inline":
                await target.click(text=label)
            else:
                await conv.send_message(label)
            await asyncio.sleep(self.args.delay)
            messages = await self.drain(conv)
        return messages

    # ---------- the walk ----------

    async def run(self, conv):
        if not self.load_state():
            self.queue = [[]]
        while self.queue:
            if len(self.done) >= self.args.max_nodes:
                print(f"hit --max-nodes ({self.args.max_nodes}), stopping")
                break
            path = self.queue.pop(0)
            key = key_for(path)
            if key in self.done:
                continue
            label = " > ".join(path) or "(root)"
            try:
                messages = await self.navigate(conv, path)
            except FloodWaitError as exc:
                print(f"flood wait {exc.seconds}s — sleeping")
                await asyncio.sleep(exc.seconds + 1)
                self.queue.insert(0, path)
                continue
            except Exception as exc:                     # noqa: BLE001
                print(f"skip '{label}': {exc}")
                self.nodes[key] = {"path": path, "error": str(exc), "messages": []}
                self.done.add(key)
                self.save()
                continue

            captured = [await self.capture(m, path) for m in messages]
            self.nodes[key] = {"path": path, "messages": captured}
            self.done.add(key)

            children = 0
            if len(path) < self.args.max_depth:
                seen_here = set()
                for entry in captured:
                    for btn in entry["buttons"]:
                        if btn in seen_here:
                            continue
                        seen_here.add(btn)
                        if not self.args.follow_nav and is_nav_button(btn):
                            continue
                        child = path + [btn]
                        if key_for(child) in self.done:
                            continue
                        self.queue.append(child)
                        children += 1

            print(f"[{len(self.done)}] {label} — "
                  f"{len(captured)} msg, {children} new branches")
            self.save()
            await asyncio.sleep(self.args.delay)


def key_for(path):
    # JSON-encoded so a label containing the separator can't collide with a
    # genuinely different path, and so the key stays readable in the state file.
    return json.dumps(path, ensure_ascii=False)



def slugify(value: str) -> str:
    value = re.sub(r"[^\w\s-]", "", value, flags=re.UNICODE).strip().lower()
    return re.sub(r"[\s_-]+", "-", value)[:60]


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--bot", default=os.environ.get("MUKHPATH_BOT", DEFAULT_BOT))
    p.add_argument("--output", default="mukhpath_dump.json")
    p.add_argument("--media-dir", default="downloads")
    p.add_argument("--mode", choices=("auto", "inline", "keyboard"), default="auto")
    p.add_argument("--max-depth", type=int, default=6)
    p.add_argument("--max-nodes", type=int, default=2000,
                   help="safety cap so a cyclic menu can't run forever")
    p.add_argument("--delay", type=float, default=1.5,
                   help="seconds between actions - don't hammer the bot")
    p.add_argument("--first-timeout", type=float, default=20.0)
    p.add_argument("--idle-timeout", type=float, default=3.0,
                   help="how long to wait for follow-up messages before "
                        "deciding the bot is done replying")
    p.add_argument("--max-messages-per-step", type=int, default=25)
    p.add_argument("--follow-nav", action="store_true",
                   help="also follow Back/Menu style buttons")
    p.add_argument("--skip-media", action="store_true")
    p.add_argument("--no-resume", dest="resume", action="store_false", default=True)
    p.add_argument("--dry-run", action="store_true",
                   help="send /start, print what comes back, exit")
    return p.parse_args(argv)


async def amain(args):
    api_id = os.environ.get("TELEGRAM_API_ID")
    api_hash = os.environ.get("TELEGRAM_API_HASH")
    if not api_id or not api_hash:
        sys.exit(
            "Set TELEGRAM_API_ID and TELEGRAM_API_HASH first (from "
            "https://my.telegram.org).\n"
            "  export TELEGRAM_API_ID=1234567\n"
            "  export TELEGRAM_API_HASH=abc123..."
        )
    client = TelegramClient("mukhpath_scraper_session", int(api_id), api_hash)
    await client.start()
    scraper = Scraper(client, args)
    async with client.conversation(args.bot, timeout=args.first_timeout,
                                   exclusive=True) as conv:
        if args.dry_run:
            await conv.send_message("/start")
            for msg in await scraper.drain(conv):
                kinds = {button_kind(b) for row in (msg.buttons or []) for b in row}
                print("-" * 60)
                print(msg.text)
                print("buttons:", [b.text for row in (msg.buttons or []) for b in row])
                print("kind:", kinds or "none", "| media:", bool(msg.media))
            print("\nUse --mode with whichever kind you see above.")
            return
        await scraper.run(conv)
    scraper.save()
    print(f"\nCaptured {len(scraper.nodes)} nodes -> {args.output}")
    print(f"Next: python3 scripts/parse_dump.py {args.output}")
    await client.disconnect()


def main():
    args = parse_args()
    asyncio.run(amain(args))


if __name__ == "__main__":
    main()
