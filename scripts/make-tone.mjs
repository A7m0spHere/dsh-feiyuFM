// Generates a short PCM WAV for playback verification. Written in plain Node so
// no FFmpeg or other external tool is needed, and the file is never committed.
import { writeFileSync } from 'node:fs';

/** @param {{ seconds?: number, frequency?: number, path: string, sampleRate?: number }} options */
export function writeTone({ path, seconds = 3, frequency = 440, sampleRate = 44100, amplitude = 0.2 }) {
  const frames = Math.max(1, Math.round(seconds * sampleRate));
  const dataBytes = frames * 2; // mono 16-bit
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM header size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  const fadeFrames = Math.min(Math.round(sampleRate * 0.02), Math.floor(frames / 4));
  for (let index = 0; index < frames; index += 1) {
    let gain = amplitude;
    if (index < fadeFrames) gain *= index / fadeFrames;
    const remaining = frames - index;
    if (remaining < fadeFrames) gain *= remaining / fadeFrames;
    const value = Math.round(Math.sin((2 * Math.PI * frequency * index) / sampleRate) * gain * 32767);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  writeFileSync(path, buffer);
  return { path, frames, durationMs: Math.round((frames / sampleRate) * 1000), sampleRate, bytes: buffer.length };
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (invokedDirectly) {
  const [path, seconds = '3', frequency = '440'] = process.argv.slice(2);
  if (!path) throw new Error('Usage: node scripts/make-tone.mjs <path.wav> [seconds] [frequency]');
  console.log(JSON.stringify(writeTone({ path, seconds: Number(seconds), frequency: Number(frequency) })));
}