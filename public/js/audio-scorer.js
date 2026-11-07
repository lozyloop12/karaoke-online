// Hệ thống Phân tích Giọng hát, Đo Cao độ (Pitch Detection) & Chấm điểm Karaoke Trực tiếp (Web Audio API)

const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

class KaraokeAudioScorer {
  constructor(onTelemetryCallback) {
    this.onTelemetry = onTelemetryCallback;
    this.audioCtx = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.micGainNode = null;
    this.echoDelayNode = null;
    this.echoFeedbackNode = null;
    this.monitorOutputNode = null;

    this.isActive = false;
    this.monitorEnabled = false;
    this.micVolume = 1.0;

    this.liveScore = 0;
    this.activeSingTicks = 0;
    this.pitchStabilityBonus = 0;
    this.lastDetectedNote = "--";
    this.currentAccuracyLabel = "Sẵn sàng hát 🎤";

    this.animFrameId = null;
    this.lastEmitTime = 0;
  }

  async start() {
    if (this.isActive) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false
        }
      });

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();

      this.source = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.82;

      // Nhánh tạo hiệu ứng Echo KTV (chỉ phát ra loa khi người dùng bật "Nghe giọng + Echo")
      this.micGainNode = this.audioCtx.createGain();
      this.micGainNode.gain.value = this.micVolume;

      this.echoDelayNode = this.audioCtx.createDelay(1.0);
      this.echoDelayNode.delayTime.value = 0.19; // Độ trễ vang chuẩn phòng KTV

      this.echoFeedbackNode = this.audioCtx.createGain();
      this.echoFeedbackNode.gain.value = 0.32;

      this.monitorOutputNode = this.audioCtx.createGain();
      this.monitorOutputNode.gain.value = this.monitorEnabled ? 0.85 : 0;

      // Kết nối chuỗi phân tích & Echo
      this.source.connect(this.micGainNode);
      this.micGainNode.connect(this.analyser);

      // Vòng lặp Echo KTV
      this.micGainNode.connect(this.monitorOutputNode);
      this.micGainNode.connect(this.echoDelayNode);
      this.echoDelayNode.connect(this.echoFeedbackNode);
      this.echoFeedbackNode.connect(this.echoDelayNode);
      this.echoDelayNode.connect(this.monitorOutputNode);
      this.monitorOutputNode.connect(this.audioCtx.destination);

      this.isActive = true;
      if (this.liveScore < 60) {
        this.liveScore = 65; // Điểm khởi đầu khích lệ khi bắt đầu cầm mic
      }

      this.loop();
      return true;
    } catch (err) {
      console.error("Không thể truy cập Micro:", err);
      return false;
    }
  }

  stop() {
    this.isActive = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.onTelemetry?.({
      isSinging: false,
      liveScore: Math.round(this.liveScore),
      pitchNote: "--",
      volume: 0,
      accuracyLabel: "Đã tắt Mic"
    });
  }

  resetSongScore() {
    this.liveScore = this.isActive ? 65 : 0;
    this.activeSingTicks = 0;
    this.pitchStabilityBonus = 0;
    this.lastDetectedNote = "--";
  }

  setMicVolume(val) {
    this.micVolume = parseFloat(val) || 1.0;
    if (this.micGainNode && this.audioCtx) {
      this.micGainNode.gain.setValueAtTime(this.micVolume, this.audioCtx.currentTime);
    }
  }

  setMonitorEcho(enabled) {
    this.monitorEnabled = Boolean(enabled);
    if (this.monitorOutputNode && this.audioCtx) {
      this.monitorOutputNode.gain.setValueAtTime(
        this.monitorEnabled ? 0.85 : 0,
        this.audioCtx.currentTime
      );
    }
  }

  // Thuật toán Autocorrelation tìm tần số cơ bản (Hz) của giọng hát
  autoCorrelate(buf, sampleRate) {
    let size = buf.length;
    let rms = 0;

    for (let i = 0; i < size; i++) {
      const val = buf[i];
      rms += val * val;
    }
    rms = Math.sqrt(rms / size);
    if (rms < 0.018) return { freq: -1, rms };

    let r1 = 0;
    let r2 = size - 1;
    const thres = 0.2;
    for (let i = 0; i < size / 2; i++) {
      if (Math.abs(buf[i]) < thres) {
        r1 = i;
        break;
      }
    }
    for (let i = 1; i < size / 2; i++) {
      if (Math.abs(buf[size - i]) < thres) {
        r2 = size - i;
        break;
      }
    }

    const sliced = buf.slice(r1, r2);
    size = sliced.length;

    const c = new Array(size).fill(0);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size - i; j++) {
        c[i] = c[i] + sliced[j] * sliced[j + i];
      }
    }

    let d = 0;
    while (c[d] > c[d + 1]) {
      d++;
      if (d >= size - 1) return { freq: -1, rms };
    }

    let maxval = -1;
    let maxpos = -1;
    for (let i = d; i < size; i++) {
      if (c[i] > maxval) {
        maxval = c[i];
        maxpos = i;
      }
    }

    const T0 = maxpos;
    if (T0 <= 0) return { freq: -1, rms };
    return { freq: sampleRate / T0, rms };
  }

  frequencyToNote(freq) {
    if (freq <= 65 || freq > 1300) return "--";
    const noteNum = 12 * (Math.log(freq / 440) / Math.log(2));
    const midi = Math.round(noteNum) + 69;
    const noteName = NOTE_STRINGS[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${noteName}${octave}`;
  }

  loop() {
    if (!this.isActive || !this.analyser) return;

    const timeBuf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(timeBuf);

    const freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(freqData);

    const { freq, rms } = this.autoCorrelate(timeBuf, this.audioCtx.sampleRate);
    const normalizedVol = Math.min(100, Math.round(rms * 360));

    let note = "--";
    if (freq > 70 && freq < 1200) {
      note = this.frequencyToNote(freq);
      this.activeSingTicks++;

      // Nếu giữ cao độ ổn định hoặc ngân giọng tốt thì cộng điểm thưởng nhanh hơn
      if (note === this.lastDetectedNote) {
        this.pitchStabilityBonus += 0.08;
        this.currentAccuracyLabel = normalizedVol > 45 ? "NGÂN GIỌNG ĐỈNH! 🔥" : "CHUẨN CAO ĐỘ! ✨";
      } else {
        this.pitchStabilityBonus += 0.04;
        this.currentAccuracyLabel = normalizedVol > 55 ? "NỘI LỰC CỰC CĂNG! 👑" : "NGỌT NGÀO! 💖";
      }
      this.lastDetectedNote = note;

      // Tăng điểm mượt mà từ 65 -> 100 theo thời gian và độ chuẩn cao độ
      this.liveScore = Math.min(
        100,
        68 + Math.min(24, this.activeSingTicks * 0.09) + Math.min(8, this.pitchStabilityBonus)
      );
    } else if (normalizedVol > 12) {
      this.currentAccuracyLabel = "Đang lấy nhịp... 🎶";
    } else {
      this.currentAccuracyLabel = "Hãy cất tiếng hát vào Mic 🎤";
    }

    this.drawVisualizer(freqData, normalizedVol);

    const now = performance.now();
    if (now - this.lastEmitTime > 180) {
      this.lastEmitTime = now;
      this.onTelemetry?.({
        isSinging: true,
        liveScore: Math.round(this.liveScore),
        pitchNote: note !== "--" ? note : this.lastDetectedNote,
        volume: normalizedVol,
        accuracyLabel: this.currentAccuracyLabel
      });
    }

    this.animFrameId = requestAnimationFrame(() => this.loop());
  }

  drawVisualizer(freqData, normalizedVol) {
    const canvas = document.getElementById("micVisualizerCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const barCount = 28;
    const step = Math.floor(freqData.length / 4 / barCount);
    const barWidth = (w / barCount) - 3;

    for (let i = 0; i < barCount; i++) {
      const value = freqData[i * step] || 0;
      const percent = value / 255;
      const barHeight = Math.max(4, percent * (h - 4));
      const x = i * (barWidth + 3);
      const y = h - barHeight;

      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, "#00f5d4");
      grad.addColorStop(0.55, "#9b5de5");
      grad.addColorStop(1, "#f15bb5");

      ctx.fillStyle = normalizedVol > 8 ? grad : "rgba(255,255,255,0.16)";
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 3);
      ctx.fill();
    }
  }
}

window.KaraokeAudioScorer = KaraokeAudioScorer;

