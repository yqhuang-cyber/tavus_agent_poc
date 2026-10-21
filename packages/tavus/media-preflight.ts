import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const positive = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : undefined; };
const rate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d+(?:\/\d+)?$/u.test(value)) return undefined;
  const [a, b = '1'] = value.split('/'); return positive(Number(a) / Number(b));
};

export function assessMediaMetadata(value: unknown) {
  const data = object(value); const streams = Array.isArray(data.streams) ? data.streams.map(object) : [];
  const videos = streams.filter(s => s.codec_type === 'video' && object(s.disposition).attached_pic !== 1);
  const video = videos[0]; const audio = streams.find(s => s.codec_type === 'audio');
  const width = positive(video?.width); const height = positive(video?.height);
  const fps = rate(video?.avg_frame_rate) ?? rate(video?.r_frame_rate);
  const frames = positive(video?.nb_frames);
  const streamDuration = positive(video?.duration);
  const duration = streamDuration ?? (frames && fps ? frames / fps : undefined);
  const durationSource = streamDuration ? 'video-stream' : duration ? 'video-frame-count' : 'unknown';
  const checks: { code: string; status: 'passed' | 'failed' | 'unknown' }[] = [
    { code: 'one_video_stream', status: videos.length === 1 ? 'passed' : 'failed' },
    { code: 'at_least_full_hd', status: !width || !height ? 'unknown' : Math.min(width, height) >= 1080 && Math.max(width, height) >= 1920 ? 'passed' : 'failed' },
    { code: 'average_fps_at_least_25', status: !fps ? 'unknown' : fps >= 25 ? 'passed' : 'failed' },
    { code: 'video_at_least_60_seconds', status: !duration ? 'unknown' : duration >= 60 ? 'passed' : 'failed' },
    { code: 'audio_stream_present', status: audio ? 'passed' : 'failed' },
  ];
  return { kind: 'local-media-metadata-only', metadataEligible: checks.every(c => c.status === 'passed'), checks,
    video: { width: width ?? null, height: height ?? null, averageFps: fps ?? null, durationSeconds: duration ?? null, durationSource },
    audio: { present: !!audio, sampleRate: positive(audio?.sample_rate) ?? null, channels: positive(audio?.channels) ?? null },
    manualReview: [ 'continuous_30_seconds_speaking', 'following_30_seconds_still', 'front_facing_and_visible_mouth',
      'stable_camera_lighting_and_background', 'teacher_identity_and_chinese_voice_quality' ].map(code => ({ code, status: 'not-run' })),
    trainingAccepted: 'not-verified', uploaded: false };
}

export async function inspectLocalMedia(input: string) {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(input) || !['.mp4', '.mov', '.webm', '.mkv', '.m4v'].includes(extname(input).toLowerCase())) throw new Error('local_video_file_required');
  const path = resolve(input);
  try {
    const before = await stat(path);
    if (!before.isFile()) throw new Error('not_regular_file');
    const sha = createHash('sha256');
    for await (const chunk of createReadStream(path)) sha.update(chunk);
    // Local file/pipe only: a local playlist cannot silently fetch remote media.
    const { stdout } = await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', '-i', path],
      { timeout: 10000, maxBuffer: 1024 * 1024 });
    const after = await stat(path);
    if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('media_changed_during_probe');
    return { ...assessMediaMetadata(JSON.parse(stdout)), source: { sha256: sha.digest('hex'), bytes: before.size } };
  } catch (error) {
    if (error instanceof Error && error.message === 'media_changed_during_probe') throw error;
    throw new Error('local_media_probe_failed'); // No raw ffprobe stderr, signed URL, path, or media content in logs.
  }
}
