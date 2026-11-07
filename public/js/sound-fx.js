// Bộ tổng hợp hiệu ứng âm thanh phòng hát Karaoke (Web Audio API)
// Không phụ thuộc file MP3 bên ngoài, hoạt động tức thì trên mọi trình duyệt.

class KaraokeSoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  playPop() {
    if (this.muted) return;
    const ctx = this.initContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  }

  playApplause() {
    if (this.muted) return;
    const ctx = this.initContext();
    if (!ctx) return;

    // Tạo tiếng vỗ tay từ các cụm White Noise lọc dải tần
    const claps = 18;
    for (let i = 0; i < claps; i++) {
      const startTime = ctx.currentTime + i * 0.055 + Math.random() * 0.03;
      const duration = 0.06 + Math.random() * 0.04;

      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let j = 0; j < bufferSize; j++) {
        data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (bufferSize * 0.35));
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1100 + Math.random() * 600;
      filter.Q.value = 1.8;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.16, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      noise.start(startTime);
    }
  }

  playAirhorn() {
    if (this.muted) return;
    const ctx = this.initContext();
    if (!ctx) return;

    const bursts = [0, 0.16, 0.32];
    const freqs = [390, 490, 587]; // Hợp âm kèn DJ cổ vũ

    bursts.forEach((offset, idx) => {
      const dur = idx === 2 ? 0.42 : 0.11;
      const start = ctx.currentTime + offset;

      freqs.forEach((f) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(f * 0.96, start);
        osc.frequency.linearRampToValueAtTime(f, start + 0.03);

        gain.gain.setValueAtTime(0.09, start);
        gain.gain.exponentialRampToValueAtTime(0.005, start + dur);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur);
      });
    });
  }

  playCheerChime() {
    if (this.muted) return;
    const ctx = this.initContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, idx) => {
      const start = ctx.currentTime + idx * 0.065;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.33);
    });
  }

  playScoreFanfare() {
    if (this.muted) return;
    const ctx = this.initContext();
    if (!ctx) return;

    // Nhạc hiệu chấm điểm phòng hát KTV kinh điển
    const melody = [
      { f: 523.25, t: 0.0, d: 0.14 },  // C5
      { f: 523.25, t: 0.16, d: 0.14 }, // C5
      { f: 523.25, t: 0.32, d: 0.14 }, // C5
      { f: 659.25, t: 0.48, d: 0.32 }, // E5
      { f: 587.33, t: 0.84, d: 0.16 }, // D5
      { f: 659.25, t: 1.02, d: 0.16 }, // E5
      { f: 783.99, t: 1.20, d: 0.65 }  // G5
    ];

    melody.forEach((n) => {
      const start = ctx.currentTime + n.t;
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sawtooth";
      osc2.type = "triangle";
      osc.frequency.setValueAtTime(n.f, start);
      osc2.frequency.setValueAtTime(n.f * 0.5, start);

      gain.gain.setValueAtTime(0.14, start);
      gain.gain.exponentialRampToValueAtTime(0.005, start + n.d);

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc2.start(start);
      osc.stop(start + n.d + 0.02);
      osc2.stop(start + n.d + 0.02);
    });

    // Kèm tiếng vỗ tay chúc mừng
    setTimeout(() => this.playApplause(), 800);
  }
}

window.soundFX = new KaraokeSoundFX();

