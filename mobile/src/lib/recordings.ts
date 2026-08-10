import { Directory, File, Paths } from 'expo-file-system';

// Kid's own recitation, kept for comparing against the reference audio.
//
// CLAUDE.md: "No child audio ever leaves the device." There is no upload
// path here at all, not even a disabled one — recordings live only under
// this app's document directory and the only thing that ever reads them
// back is RecordingBar's own playback.

const RECORDINGS_DIR = new Directory(Paths.document, 'recordings');

function verseDir(verseId: string): Directory {
  return new Directory(RECORDINGS_DIR, verseId);
}

/** One take per verse. A fresh filename each save (see `saveRecording`) is
 *  what this returns; there's never more than one file in a verse's directory. */
export function recordingUri(verseId: string): string | null {
  const dir = verseDir(verseId);
  if (!dir.exists) return null;
  const [take] = dir.list().filter((entry): entry is File => entry instanceof File);
  return take?.uri ?? null;
}

/**
 * Move a just-finished recording (still wherever expo-audio wrote it) into
 * this verse's directory, replacing any previous take.
 *
 * The filename includes a timestamp rather than being fixed, so re-recording
 * always yields a new URI. `useAudioPlayer` keys its player off the source
 * string (see AudioBar's `key={url}` remount), and a fixed filename that
 * gets overwritten in place would leave a re-recorded take silently playing
 * stale, already-buffered audio.
 */
export async function saveRecording(verseId: string, tempUri: string): Promise<string> {
  const dir = verseDir(verseId);
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true });

  // Destination filename is always fresh (timestamped), so there's nothing
  // to overwrite; SDK 54's File.move() is synchronous and takes no options.
  const destination = new File(dir, `take-${Date.now()}.m4a`);
  new File(tempUri).move(destination);
  return destination.uri;
}

export function deleteRecording(verseId: string): void {
  const dir = verseDir(verseId);
  if (dir.exists) dir.delete();
}
