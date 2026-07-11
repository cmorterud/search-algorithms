import type { SearchEvent } from "./types";

export class SearchSound {
  private context: AudioContext | undefined;
  private enabled = true;
  private volume = 0.14;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
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

  playEvent(event: SearchEvent): void {
    if (!this.enabled || !this.context || this.context.state !== "running") {
      return;
    }

    switch (event.type) {
      case "frontier":
        this.playTone(260, "sine", 0.025, 0.35);
        break;
      case "visit":
        this.playTone(420, "triangle", 0.035, 0.75);
        break;
      case "path":
        event.ids.slice(0, 5).forEach((_, index) => {
          this.playTone(520 + index * 48, "sine", 0.065, 0.9, index * 0.035);
        });
        break;
      case "miss":
        this.playTone(170, "sawtooth", 0.12, 0.55);
        break;
      case "clearHighlights":
        break;
    }
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
