import type { SearchEvent } from "./types";
import { audioCueForEvent, type RecordingAudioCue } from "./recording";

const MAX_VOLUME = .16;
const clampVolume = (volume: number): number => Math.min(MAX_VOLUME, Math.max(0, volume) * MAX_VOLUME);

const scheduleTone = (
  context: BaseAudioContext,
  destination: AudioNode,
  frequency: number,
  wave: OscillatorType,
  durationSeconds: number,
  intensity: number,
  volume: number,
  startTime: number,
): void => {
  const endTime = startTime + durationSeconds;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0001, volume * intensity), startTime + .008);
  gain.gain.exponentialRampToValueAtTime(.0001, endTime);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(startTime);
  oscillator.stop(endTime + .015);
};

const audioBufferToWav = (buffer: AudioBuffer): Blob => {
  const channels = buffer.numberOfChannels;
  const sampleCount = buffer.length;
  const bytesPerSample = 2;
  const dataSize = sampleCount * channels * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); writeText(8, "WAVE");
  writeText(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true); view.setUint16(34, 16, true);
  writeText(36, "data"); view.setUint32(40, dataSize, true);
  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.max(-1, Math.min(1, channelData[channel][sample]));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
};

export const renderRecordingSoundtrack = async (
  cues: readonly RecordingAudioCue[],
  durationSeconds: number,
  normalizedVolume: number,
): Promise<Blob> => {
  const sampleRate = 48_000;
  const frameCount = Math.max(1, Math.ceil(durationSeconds * sampleRate));
  const context = new OfflineAudioContext(2, frameCount, sampleRate);
  const volume = clampVolume(normalizedVolume);
  const humCues = cues.filter((cue): cue is Extract<RecordingAudioCue, { type: "hum" }> => cue.type === "hum");
  if (humCues.length > 0) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(humCues[0].frequency, humCues[0].timeSeconds);
    gain.gain.setValueAtTime(.0001, 0);
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.start(0); oscillator.stop(durationSeconds);
    cues.forEach((cue) => {
      if (cue.type === "hum") {
        oscillator.frequency.setTargetAtTime(cue.frequency, cue.timeSeconds, .07);
        gain.gain.setTargetAtTime(Math.max(.0001, volume * .4), cue.timeSeconds, .035);
      } else if (cue.type === "stop" || cue.type === "success" || cue.type === "miss") {
        gain.gain.setTargetAtTime(.0001, cue.timeSeconds, .08);
      }
    });
  }
  cues.forEach((cue) => {
    if (cue.type === "success") {
      [392, 494, 587].forEach((frequency, index) => {
        scheduleTone(context, context.destination, frequency * cue.pitch, "sine", .14, .48, volume, cue.timeSeconds + index * .065);
      });
    } else if (cue.type === "miss") {
      scheduleTone(context, context.destination, cue.frequency, "sawtooth", .12, .55, volume, cue.timeSeconds);
    }
  });
  return audioBufferToWav(await context.startRendering());
};

export class SearchSound {
  private context: AudioContext | undefined;
  private enabled = true;
  private volume = 0.14;
  private humOscillator: OscillatorNode | undefined;
  private humGain: GainNode | undefined;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  stopHum(): void {
    this.fadeHum();
  }

  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
  }

  async unlock(): Promise<void> {
    if (!this.context) {
      const AudioContextConstructor = globalThis.AudioContext
        ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) {
        return;
      }

      try {
        this.context = new AudioContextConstructor();
        this.primeOutput();
      } catch {
        return;
      }
    }

    if (this.context.state !== "running") {
      try {
        await this.context.resume();
        this.primeOutput();
      } catch {
        return;
      }
    }
  }

  playEvent(event: SearchEvent, progress = 0): void {
    if (!this.enabled || !this.context || this.context.state !== "running") {
      return;
    }

    const cue = audioCueForEvent(event, progress, this.context.currentTime);
    if (!cue) return;
    if (cue.type === "hum") this.updateHum(cue.frequency);
    else if (cue.type === "success") { this.fadeHum(); this.playSuccessChime(cue.pitch); }
    else if (cue.type === "miss") { this.fadeHum(); this.playTone(cue.frequency, "sawtooth", .12, .55); }
  }

  private updateHum(frequency: number): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    if (!this.humOscillator || !this.humGain) {
      this.humOscillator = this.context.createOscillator();
      this.humGain = this.context.createGain();
      this.humOscillator.type = "triangle";
      this.humGain.gain.setValueAtTime(0.0001, now);
      this.humOscillator.connect(this.humGain);
      this.humGain.connect(this.context.destination);
      this.humOscillator.start();
    }
    this.humOscillator.frequency.cancelScheduledValues(now);
    this.humOscillator.frequency.setTargetAtTime(frequency, now, 0.07);
    this.humGain.gain.cancelScheduledValues(now);
    this.humGain.gain.setTargetAtTime(Math.max(.0001, this.volume * .4), now, 0.035);
  }

  private fadeHum(): void {
    if (!this.context || !this.humGain) return;
    const now = this.context.currentTime;
    this.humGain.gain.cancelScheduledValues(now);
    this.humGain.gain.setTargetAtTime(.0001, now, .08);
  }

  private primeOutput(): void {
    if (!this.context) return;
    const source = this.context.createBufferSource();
    source.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
    source.connect(this.context.destination);
    source.start();
  }

  private playSuccessChime(pitch: number): void {
    [392, 494, 587].forEach((frequency, index) => {
      this.playTone(frequency * Math.min(1.18, pitch), "sine", 0.14, 0.48, index * 0.065);
    });
  }

  private playTone(
    frequency: number,
    wave: OscillatorType,
    durationSeconds: number,
    intensity: number,
    offsetSeconds = 0,
  ): void {
    if (!this.context) {
      return;
    }

    scheduleTone(this.context, this.context.destination, frequency, wave, durationSeconds, intensity, this.volume, this.context.currentTime + offsetSeconds);
  }
}
