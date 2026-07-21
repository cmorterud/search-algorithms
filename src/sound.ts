import type { SearchEvent } from "./types";

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
    this.volume = Math.min(0.16, Math.max(0, volume) * 0.16);
  }

  async unlock(): Promise<void> {
    if (!this.context) {
      const AudioContextConstructor = globalThis.AudioContext;
      if (!AudioContextConstructor) {
        return;
      }

      try {
        this.context = new AudioContextConstructor();
      } catch {
        return;
      }
    }

    if (this.context.state === "suspended") {
      try {
        await this.context.resume();
      } catch {
        return;
      }
    }
  }

  playEvent(event: SearchEvent, progress = 0): void {
    if (!this.enabled || !this.context || this.context.state !== "running") {
      return;
    }

    // Search order is a useful, deliberately lightweight proxy for getting closer.
    const pitch = 0.82 + Math.min(1, Math.max(0, progress)) * 0.78;
    switch (event.type) {
      case "frontier":
      case "visit":
        this.updateHum(145 + progress * 220 * pitch);
        break;
      case "path":
        this.fadeHum();
        event.ids.slice(0, 5).forEach((_, index) => {
          this.playTone((360 + index * 28) * pitch, "sine", 0.09, 0.48, index * 0.045);
        });
        break;
      case "miss":
        this.fadeHum();
        this.playTone(170 * pitch, "sawtooth", 0.12, 0.55);
        break;
      case "clearHighlights":
        break;
    }
  }

  private updateHum(frequency: number): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    if (!this.humOscillator || !this.humGain) {
      this.humOscillator = this.context.createOscillator();
      this.humGain = this.context.createGain();
      this.humOscillator.type = "sine";
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

    const startTime = this.context.currentTime + offsetSeconds;
    const endTime = startTime + durationSeconds;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, this.volume * intensity),
      startTime + 0.008,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(startTime);
    oscillator.stop(endTime + 0.015);
  }
}
