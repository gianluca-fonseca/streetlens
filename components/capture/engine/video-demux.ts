/**
 * Streaming MP4 demux for the uploaded-video path.
 *
 * The whole reason this file exists is a single sentence: `File.arrayBuffer()`
 * is not survivable. A POV walk is a 200 MB to 2 GB file, and asking iOS Safari
 * to materialise that as one ArrayBuffer kills the tab somewhere around 100-200
 * MB with no error anyone can catch. There is no try/catch that saves you and no
 * event that tells you it happened. The tab is simply gone, along with the
 * walk. So the file is never read whole: it is sliced, and each slice is handed
 * to mp4box and then dropped.
 *
 * `Blob.slice()` does not read anything. It returns a view, and only the
 * `arrayBuffer()` on that small view actually touches bytes. Peak memory is
 * therefore one CHUNK_BYTES, not one file, and it stays flat whether the video
 * is 40 MB or 4 GB.
 *
 * mp4box's own retention is the other half of the problem. It is a parser that
 * would happily hold every buffer you ever gave it, which would rebuild the
 * exact whole-file allocation we just went to the trouble of avoiding.
 * `releaseUsedSamples` is what stops that: it tells mp4box the samples we have
 * already decoded can go, and the stream then reclaims the buffers behind them.
 * Without it the slicing is theatre.
 *
 * `createFile(true)` is NOT the memory knob it looks like, and the reading that
 * says otherwise is backwards in the worst way. The signature is
 * `createFile(keepMdatData = false)` and it builds `new ISOFile(stream,
 * !keepMdatData)`, so the intuitive-looking `createFile(false)` sets
 * `discardMdatData = true`, and mp4box then throws away the very bytes the
 * samples are made of. It does not fail. It logs "samples will not be
 * extracted" at warn level and hands back a perfectly well-formed stream of
 * nothing, and every count downstream is honestly reporting zero. The flag has
 * to be true or there is no video here at all. `scripts/test-mp4box-contract.mjs`
 * pins it.
 *
 * This module demuxes and nothing else. It does not decode, does not sample and
 * does not know what a frame is for. `video-extract.ts` owns those decisions.
 */

import {
  createFile,
  MP4BoxBuffer,
  MultiBufferStream,
  type ISOFile,
  type Movie,
  type Sample,
  type Track,
  type VisualSampleEntry,
} from "mp4box";
import { readRotation } from "@/components/capture/engine/video-plan";

/**
 * Bytes per slice.
 *
 * 4 MB is chosen against the two failure modes on either side of it. Smaller
 * chunks mean more round-trips through the file reader and more mp4box parse
 * entries for the same bytes. Larger chunks start to matter on a phone that is
 * also holding a decoder, its output frames and a JPEG encoder. Nothing here is
 * sensitive to the exact value; it only has to be far below the point where a
 * single allocation is itself the problem.
 */
const CHUNK_BYTES = 4 * 1024 * 1024;

/** What the decoder needs to know before it can be configured. */
export type VideoTrackInfo = {
  trackId: number;
  /** RFC 6381 codec string, e.g. "avc1.640028". Straight from the sample entry. */
  codec: string;
  width: number;
  height: number;
  /** Track timescale: sample cts/dts are in these units, not milliseconds. */
  timescale: number;
  durationMs: number;
  nbSamples: number;
  /**
   * Clockwise display rotation in degrees, from the track's transform matrix.
   *
   * This exists because a phone does not rotate the pixels it records. It writes
   * the sensor's native landscape frame and a matrix saying "turn this 90
   * degrees to show it", and a portrait POV walk is therefore a LANDSCAPE H.264
   * stream plus that instruction.
   *
   * A `<video>` element honours the matrix for free. `VideoDecoder` cannot: we
   * demux the container ourselves, so the decoder never sees the matrix and hands
   * back the raw sensor frame. Ignoring this would ship sideways JPEGs from the
   * WebCodecs path and upright ones from the seek path, for the same video, which
   * is precisely the "same artifact either way" invariant that everything else in
   * this subsystem is built to protect. It is also invisible in every count,
   * every progress bar and every test that does not look at the picture.
   */
  rotation: 0 | 90 | 180 | 270;
  /**
   * The codec-private bytes (avcC / hvcC / av1C / vpcC payload) VideoDecoder
   * wants as `description`. Null when the sample entry carries none, which is
   * legal for some codecs and fatal for H.264: see `readCodecDescription`.
   */
  description: Uint8Array | null;
  /**
   * The container's creation time, epoch ms, or null.
   *
   * Treat this as a HINT and nothing more. Phones routinely write local time
   * into a field the spec says is UTC, so this can be hours off with no way to
   * detect it from inside the file. It is the seed for the clock nudge, not an
   * answer. See `video-extract.ts` for why a wrong absolute clock is mostly
   * harmless on the trace path and mostly not on the timed-GPX path.
   */
  creationTimeMs: number | null;
};

export type DemuxHandlers = {
  /** Called once, as soon as the moov is parsed. Return false to stop the demux. */
  onTrack: (info: VideoTrackInfo) => boolean | Promise<boolean>;
  /** Called with each batch of samples, in decode order, awaited for backpressure. */
  onSamples: (samples: Sample[]) => void | Promise<void>;
  /** Bytes of the file fed to the parser so far. */
  onProgress?: (bytesRead: number, totalBytes: number) => void;
  signal?: AbortSignal;
};

/** A demux that could not start. `reason` is machine-ish so the UI can branch. */
export class VideoDemuxError extends Error {
  readonly reason: string;

  constructor(reason: string, message?: string) {
    super(message ?? reason);
    this.name = "VideoDemuxError";
    this.reason = reason;
  }
}

/**
 * Serialise a sample entry's codec-configuration box back into the raw bytes
 * `VideoDecoder` expects in `VideoDecoderConfig.description`.
 *
 * This is not optional for H.264 in avc1 form. The SPS and PPS live only in
 * this box, never in the sample data, so a decoder configured without it will
 * reject the very first chunk. (avc3 carries them in-band, which is why the
 * null return is a legal outcome and not automatically an error here: the
 * caller decides.)
 *
 * The `subarray(8)` strips the 4-byte size and 4-byte fourcc that `write()`
 * emits, because `description` is the box PAYLOAD, not the box.
 */
function readCodecDescription(entry: VisualSampleEntry): Uint8Array | null {
  const box = entry.avcC ?? entry.hvcC ?? entry.av1C ?? entry.vpcC;
  if (!box) return null;

  // A MultiBufferStream rather than a bare DataStream because that is what the
  // box writers are typed against. It extends DataStream, so it is the same
  // buffer underneath.
  const stream = new MultiBufferStream();
  box.write(stream);
  return new Uint8Array(stream.buffer, 8, Math.max(0, stream.byteLength - 8)).slice();
}

/** Pull the video track's sample entry out of the parsed moov. */
function visualEntry(iso: ISOFile, trackId: number): VisualSampleEntry | null {
  const trak = iso.getTrackById(trackId);
  const entries = trak?.mdia?.minf?.stbl?.stsd?.entries;
  const entry = entries?.[0];
  return (entry as VisualSampleEntry | undefined) ?? null;
}

function trackInfo(iso: ISOFile, movie: Movie, track: Track): VideoTrackInfo {
  const entry = visualEntry(iso, track.id);
  return {
    trackId: track.id,
    codec: track.codec,
    // The sample entry is authoritative on dimensions. `track.track_width` is
    // the tkhd display width, which carries the aspect correction and can
    // disagree with the coded size.
    width: entry?.width ?? 0,
    height: entry?.height ?? 0,
    timescale: track.timescale,
    durationMs:
      track.movie_timescale > 0
        ? (track.movie_duration / track.movie_timescale) * 1_000
        : (movie.duration / (movie.timescale || 1)) * 1_000,
    nbSamples: track.nb_samples,
    rotation: readRotation(track.matrix),
    description: entry ? readCodecDescription(entry) : null,
    creationTimeMs: movie.created instanceof Date ? movie.created.getTime() : null,
  };
}

/**
 * Feed `file` through mp4box in slices, reporting the video track and then its
 * samples.
 *
 * Resolves when the file is exhausted or a handler asked to stop. Rejects with
 * a `VideoDemuxError` when there is nothing here to decode.
 *
 * Backpressure is the subtle part. mp4box calls `onSamples` SYNCHRONOUSLY from
 * inside `appendBuffer`, so there is no way to await a slow consumer from
 * within the callback. Samples are therefore parked in `pending` and drained
 * between slices, where awaiting is legal. That is what lets the caller hold the
 * decoder queue down instead of pushing a whole file's worth of chunks into it
 * and reproducing the memory blowup by another route.
 */
export async function demuxVideo(file: Blob, handlers: DemuxHandlers): Promise<void> {
  const { onTrack, onSamples, onProgress, signal } = handlers;

  // `keepMdatData: true`. Counter-intuitive and mandatory: false discards the
  // sample payloads and extraction silently yields nothing. See the file header.
  const iso = createFile(true);
  let info: VideoTrackInfo | null = null;
  let stopped = false;
  let parseError: string | null = null;
  let pending: Sample[] = [];
  let lastReleased = -1;

  iso.onError = (_module, message) => {
    parseError = message;
  };

  iso.onReady = (movie: Movie) => {
    const track = movie.videoTracks?.[0];
    if (!track) {
      parseError = "no_video_track";
      return;
    }
    info = trackInfo(iso, movie, track);
    // `nbSamples` batches the onSamples callbacks. It is a parser-side batching
    // hint only and does not change what we receive in total.
    iso.setExtractionOptions(track.id, null, { nbSamples: 64 });
    iso.start();
  };

  iso.onSamples = (_id, _user, samples) => {
    pending.push(...samples);
  };

  const drain = async (): Promise<void> => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    await onSamples(batch);

    // Tell mp4box these are spent. Without this it holds every sample it ever
    // parsed and the slicing above buys nothing.
    const last = batch[batch.length - 1];
    if (info && last && last.number > lastReleased) {
      lastReleased = last.number;
      iso.releaseUsedSamples(info.trackId, last.number);
    }
  };

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };

  for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
    throwIfAborted();

    const end = Math.min(offset + CHUNK_BYTES, file.size);
    const bytes = await file.slice(offset, end).arrayBuffer();
    const isLast = end >= file.size;

    iso.appendBuffer(MP4BoxBuffer.fromArrayBuffer(bytes, offset), isLast);

    if (parseError) throw new VideoDemuxError("parse_failed", parseError);

    // The moov landed on this slice: hand the track over before any samples do.
    if (info && !stopped) {
      const proceed = await onTrack(info);
      stopped = true;
      if (!proceed) return;
    }

    await drain();
    onProgress?.(end, file.size);
  }

  iso.flush();
  if (parseError) throw new VideoDemuxError("parse_failed", parseError);

  // A moov at the very end of the file (an un-faststarted recording) only
  // parses on the final append, so the track can arrive here rather than in the
  // loop.
  if (info && !stopped) {
    stopped = true;
    if (!(await onTrack(info))) return;
  }

  await drain();

  if (!info) {
    throw new VideoDemuxError(
      parseError === "no_video_track" ? "no_video_track" : "no_moov",
    );
  }
}

/**
 * Read just enough of the file to describe its video track, then stop.
 *
 * Used by the picker to say "this is 12 minutes of 1080p" before committing to
 * a full extraction. It reads slices until the moov parses rather than reading
 * the file: a faststarted recording answers on the first 4 MB.
 */
export async function probeVideo(file: Blob, signal?: AbortSignal): Promise<VideoTrackInfo> {
  let found: VideoTrackInfo | null = null;
  await demuxVideo(file, {
    signal,
    onTrack: (info) => {
      found = info;
      return false; // Stop. The samples are none of a probe's business.
    },
    onSamples: () => undefined,
  });
  if (!found) throw new VideoDemuxError("no_moov");
  return found;
}
