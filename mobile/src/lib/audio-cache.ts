import { Directory, File, Paths } from 'expo-file-system';

// Offline reference audio. Phase 2 streamed straight from
// bkymukhpath.nahq.baps.dev every time; this caches each track to disk the
// first time it's played, so a verse visited once is available with no
// connection thereafter.
//
// Deliberately *not* part of the corpus sync (lib/sync.ts): that pulls
// ~130KB of text on every launch, and eagerly downloading every verse's
// audio alongside it would turn a fast, cheap sync into a slow one that also
// burns mobile data the learner never asked to spend on texts they haven't
// opened. Caching on first play means the cost is paid only for verses
// actually practised, which is most of them eventually but not all of them
// on day one.

const AUDIO_DIR = new Directory(Paths.document, 'audio');

// Only two possible tracks per verse (Gujarati recitation, English
// explanation — see verseAudio in lib/types.ts), so the cache key doesn't
// need to encode the source URL, just which slot this is.
export type AudioSlot = 'gu' | 'en';

function extensionOf(url: string): string {
  const withoutQuery = url.split('?')[0] ?? url;
  const match = /\.([a-zA-Z0-9]{2,5})$/.exec(withoutQuery);
  return match ? match[1] : 'mp3';
}

function cacheFile(verseId: string, slot: AudioSlot, url: string): File {
  return new File(AUDIO_DIR, `${verseId}-${slot}.${extensionOf(url)}`);
}

/**
 * The URI to hand `useAudioPlayer`: the cached file if one exists, otherwise
 * the remote URL, with a cache fill kicked off in the background for next
 * time.
 *
 * Synchronous existence check + fire-and-forget download, not "await the
 * download and swap in the local file" — the latter would remount `AudioBar`
 * (see its `key={url}` doc comment) partway through a first-ever playback,
 * restarting it out from under the learner. Deferring the swap to the next
 * time the verse is opened costs nothing this session and never disrupts one.
 */
export function verseAudioUri(verseId: string, slot: AudioSlot, remoteUrl: string): string {
  const file = cacheFile(verseId, slot, remoteUrl);
  if (file.exists) return file.uri;

  void downloadInBackground(verseId, slot, remoteUrl);
  return remoteUrl;
}

const inFlight = new Set<string>();

async function downloadInBackground(verseId: string, slot: AudioSlot, remoteUrl: string): Promise<void> {
  const key = `${verseId}-${slot}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);

  try {
    if (!AUDIO_DIR.exists) AUDIO_DIR.create({ intermediates: true });
    const destination = cacheFile(verseId, slot, remoteUrl);
    if (destination.exists) return;
    await File.downloadFileAsync(remoteUrl, destination, { idempotent: true });
  } catch {
    // Offline, or the source is unreachable — this verse simply stays
    // streamed-only until a later visit tries again. Not worth surfacing:
    // AudioBar already shows its own error if playback itself fails.
  } finally {
    inFlight.delete(key);
  }
}

/** Whether this verse's track for this slot is already cached on-device. */
export function isAudioCached(verseId: string, slot: AudioSlot, remoteUrl: string): boolean {
  return cacheFile(verseId, slot, remoteUrl).exists;
}
