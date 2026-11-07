// Hệ thống Phân tích Giọng hát, Đo Cao độ (Pitch Detection), Chấm điểm Karaoke
// & Truyền Giọng Hát Đa Thành Viên Thời Gian Thực (WebRTC Mesh + Web Audio Live Stream)

const NOTE_STRINGS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

class KaraokeAudioScorer {
  constructor(onTelemetryCallback, onVoiceChunkCallback) {
    this.onTelemetry = onTelemetryCallback;
    this.onVoiceChunk = onVoiceChunkCallback;
    this.audioCtx = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.micGainNode = null;
    this.echoDelayNode = null;
    this.echoFeedbackNode = null;
    this.echoWetGainNode = null;
    this.voiceMixNode = null;
    this.broadcastDestNode = null;
    this.monitorOutputNode = null;
    this.processorNode = null;
    this.silentSinkNode = null;

    this.isActive = false;
    this.monitorEnabled = false;
    this.micVolume = 1.2;

    this.liveScore = 0;
    this.activeSingTicks = 0;
    this.pitchStabilityBonus = 0;
    this.lastDetectedNote = "--";
    this.currentAccuracyLabel = "Sẵn sàng hát 🎤";

    this.animFrameId = null;
    this.lastEmitTime = 0;
    this.trailingVoiceFrames = 0;
    this.onStreamStateChange = null;
  }

  async start() {
    if (this.isActive) return true;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return false;
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();
      if (this.audioCtx.state === "suspended") {
        await this.audioCtx.resume();
      }

      this.source = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.82;

      // Nhánh khuếch đại Mic & tạo hiệu ứng Echo KTV
      this.micGainNode = this.audioCtx.createGain();
      this.micGainNode.gain.value = this.micVolume;

      this.echoDelayNode = this.audioCtx.createDelay(1.0);
      this.echoDelayNode.delayTime.value = 0.18; // Độ trễ vang chuẩn phòng KTV

      this.echoFeedbackNode = this.audioCtx.createGain();
      this.echoFeedbackNode.gain.value = 0.3;

      this.echoWetGainNode = this.audioCtx.createGain();
      this.echoWetGainNode.gain.value = 0.28; // Độ vang KTV gửi cho cả phòng cùng nghe

      // Nút trộn giọng hát + Echo KTV để phát cho các thành viên khác và tự nghe
      this.voiceMixNode = this.audioCtx.createGain();
      this.voiceMixNode.gain.value = 1.0;

      this.broadcastDestNode = this.audioCtx.createMediaStreamDestination();

      this.monitorOutputNode = this.audioCtx.createGain();
      this.monitorOutputNode.gain.value = this.monitorEnabled ? 0.85 : 0;

      // Kết nối chuỗi phân tích & trộn Echo KTV
      this.source.connect(this.micGainNode);
      this.micGainNode.connect(this.analyser);

      // Nhánh giọng thật (Dry) + Nhánh vang KTV (Wet) -> voiceMixNode
      this.micGainNode.connect(this.voiceMixNode);
      this.micGainNode.connect(this.echoDelayNode);
      this.echoDelayNode.connect(this.echoFeedbackNode);
      this.echoFeedbackNode.connect(this.echoDelayNode);
      this.echoDelayNode.connect(this.echoWetGainNode);
      this.echoWetGainNode.connect(this.voiceMixNode);

      // Xuất luồng âm thanh KTV sang WebRTC Broadcast & Loa nội bộ (nếu bật Tự nghe)
      this.voiceMixNode.connect(this.broadcastDestNode);
      this.voiceMixNode.connect(this.monitorOutputNode);
      this.monitorOutputNode.connect(this.audioCtx.destination);

      // Bộ xử lý đóng gói PCM 16kHz thời gian thực để truyền giọng hát tới mọi thành viên
      this.setupRealtimeVoiceStreamer();

      this.isActive = true;
      if (this.liveScore < 60) {
        this.liveScore = 65; // Điểm khởi đầu khích lệ khi bắt đầu cầm mic
      }

      this.onStreamStateChange?.(true, this.broadcastDestNode.stream);
      this.loop();
      return true;
    } catch (err) {
      console.error("Không thể truy cập Micro:", err);
      return false;
    }
  }

  setupRealtimeVoiceStreamer() {
    if (!this.audioCtx || !this.voiceMixNode) return;
    const bufferSize = 2048;
    const targetSampleRate = 16000;
    const sourceSampleRate = this.audioCtx.sampleRate;

    this.processorNode = this.audioCtx.createScriptProcessor(bufferSize, 1, 1);
    this.silentSinkNode = this.audioCtx.createGain();
    this.silentSinkNode.gain.value = 0;

    this.voiceMixNode.connect(this.processorNode);
    this.processorNode.connect(this.silentSinkNode);
    this.silentSinkNode.connect(this.audioCtx.destination);

    this.processorNode.onaudioprocess = (event) => {
      if (!this.isActive || !this.onVoiceChunk) return;
      const input = event.inputBuffer.getChannelData(0);

      // Tính năng lượng âm thanh (RMS) để lọc khoảng lặng hoàn toàn
      let sumSq = 0;
      for (let i = 0; i < input.length; i++) {
        sumSq += input[i] * input[i];
      }
      const rms = Math.sqrt(sumSq / input.length);

      if (rms > 0.0035) {
        this.trailingVoiceFrames = 8; // Giữ thêm 8 khung (~320ms) sau khi ngắt câu để không mất đuôi vang Echo
      } else if (this.trailingVoiceFrames > 0) {
        this.trailingVoiceFrames--;
      } else {
        return;
      }

      // Downsample mượt về 16000Hz Int16 PCM
      const ratio = sourceSampleRate / targetSampleRate;
      const outLength = Math.floor(input.length / ratio);
      const pcm16 = new Int16Array(outLength);

      for (let i = 0; i < outLength; i++) {
        const startIdx = Math.floor(i * ratio);
        const endIdx = Math.min(input.length, Math.floor((i + 1) * ratio));
        let acc = 0;
        let count = 0;
        for (let j = startIdx; j < endIdx; j++) {
          acc += input[j];
          count++;
        }
        const sample = count > 0 ? acc / count : input[startIdx] || 0;
        const clamped = Math.max(-1, Math.min(1, sample));
        pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }

      this.onVoiceChunk({
        pcm: pcm16.buffer,
        sampleRate: targetSampleRate
      });
    };
  }

  getBroadcastStream() {
    return this.broadcastDestNode ? this.broadcastDestNode.stream : this.stream;
  }

  stop() {
    this.isActive = false;
    this.trailingVoiceFrames = 0;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.processorNode) {
      try {
        this.processorNode.disconnect();
        this.processorNode.onaudioprocess = null;
      } catch (_) {}
      this.processorNode = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.broadcastDestNode = null;
    this.onStreamStateChange?.(false, null);
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
    if (rms < 0.015) return { freq: -1, rms };

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

      if (note === this.lastDetectedNote) {
        this.pitchStabilityBonus += 0.08;
        this.currentAccuracyLabel = normalizedVol > 45 ? "NGÂN GIỌNG ĐỈNH! 🔥" : "CHUẨN CAO ĐỘ! ✨";
      } else {
        this.pitchStabilityBonus += 0.04;
        this.currentAccuracyLabel = normalizedVol > 55 ? "NỘI LỰC CỰC CĂNG! 👑" : "NGỌT NGÀO! 💖";
      }
      this.lastDetectedNote = note;

      this.liveScore = Math.min(
        100,
        68 + Math.min(24, this.activeSingTicks * 0.09) + Math.min(8, this.pitchStabilityBonus)
      );
    } else if (normalizedVol > 10) {
      this.currentAccuracyLabel = "Đang lấy nhịp... 🎶";
    } else {
      this.currentAccuracyLabel = "Đang bật Mic (Cả phòng nghe bạn) 🎤";
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
    const barWidth = w / barCount - 3;

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

      ctx.fillStyle = normalizedVol > 6 ? grad : "rgba(255,255,255,0.16)";
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 3);
      ctx.fill();
    }
  }
}

// ================= HỆ THỐNG ĐỒNG BỘ GIỌNG HÁT ĐA THÀNH VIÊN (WEBRTC MESH + WEB AUDIO STREAM) =================
class KaraokeRoomVoiceEngine {
  constructor(socket, audioScorer) {
    this.socket = socket;
    this.audioScorer = audioScorer;
    this.myId = null;

    this.rxCtx = null;
    this.vocalCompressor = null;
    this.masterVoiceGain = null;
    this.voiceVolume = 1.25; // Mặc định 125% để giọng hát nổi rõ trên nền nhạc Karaoke
    this.voiceMuted = false;

    // Map<peerId, { pc, sender, audioEl, nextPlayTime, lastWebRtcActiveAt, makingOffer }>
    this.peers = new Map();

    this.rtcConfig = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    };

    this.bindSocketSignaling();
    this.bindUserGestureUnlock();

    if (this.audioScorer) {
      this.audioScorer.onStreamStateChange = (isActive, stream) => {
        this.handleLocalMicChange(isActive, stream);
      };
    }
  }

  setMyId(id) {
    this.myId = id;
  }

  ensureAudioContext() {
    if (!this.rxCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.rxCtx = new AudioCtx();

      // Bộ nén giọng hát (Compressor) giúp giọng các thành viên dày, rõ và không bị vỡ tiếng khi hát lớn
      this.vocalCompressor = this.rxCtx.createDynamicsCompressor();
      this.vocalCompressor.threshold.setValueAtTime(-22, this.rxCtx.currentTime);
      this.vocalCompressor.knee.setValueAtTime(18, this.rxCtx.currentTime);
      this.vocalCompressor.ratio.setValueAtTime(3.5, this.rxCtx.currentTime);
      this.vocalCompressor.attack.setValueAtTime(0.005, this.rxCtx.currentTime);
      this.vocalCompressor.release.setValueAtTime(0.18, this.rxCtx.currentTime);

      this.masterVoiceGain = this.rxCtx.createGain();
      this.masterVoiceGain.gain.setValueAtTime(
        this.voiceMuted ? 0 : this.voiceVolume,
        this.rxCtx.currentTime
      );

      this.vocalCompressor.connect(this.masterVoiceGain);
      this.masterVoiceGain.connect(this.rxCtx.destination);
    }
    if (this.rxCtx && this.rxCtx.state === "suspended") {
      this.rxCtx.resume().catch(() => {});
    }
    return this.rxCtx;
  }

  bindUserGestureUnlock() {
    const unlock = () => {
      this.ensureAudioContext();
      this.peers.forEach((p) => {
        if (p.audioEl && p.audioEl.paused) {
          p.audioEl.play().catch(() => {});
        }
      });
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
  }

  setRemoteVoiceVolume(percentValue) {
    const num = parseFloat(percentValue);
    this.voiceVolume = Number.isNaN(num) ? 1.25 : num / 100;
    const ctx = this.ensureAudioContext();
    if (this.masterVoiceGain && ctx) {
      this.masterVoiceGain.gain.setValueAtTime(
        this.voiceMuted ? 0 : this.voiceVolume,
        ctx.currentTime
      );
    }
    this.peers.forEach((p) => {
      if (p.audioEl && !p.routedToWebAudio) {
        p.audioEl.volume = this.voiceMuted ? 0 : Math.min(1, this.voiceVolume);
      }
    });
  }

  toggleRemoteVoiceMute(forceState) {
    this.voiceMuted = typeof forceState === "boolean" ? forceState : !this.voiceMuted;
    const ctx = this.ensureAudioContext();
    if (this.masterVoiceGain && ctx) {
      this.masterVoiceGain.gain.setValueAtTime(
        this.voiceMuted ? 0 : this.voiceVolume,
        ctx.currentTime
      );
    }
    this.peers.forEach((p) => {
      if (p.audioEl && !p.routedToWebAudio) {
        p.audioEl.muted = this.voiceMuted;
      }
    });
    return this.voiceMuted;
  }

  // Đồng bộ danh sách thành viên trong phòng để thiết lập kết nối P2P
  syncRoomMembers(members) {
    if (!Array.isArray(members) || !this.myId) return;
    const activeIds = new Set(members.map((m) => m.id));

    // Dọn dẹp các peer đã rời phòng
    for (const peerId of this.peers.keys()) {
      if (!activeIds.has(peerId)) {
        this.removePeer(peerId);
      }
    }

    // Nếu mình đang bật Mic hoặc thành viên khác đang bật Mic, kết nối WebRTC ngay
    const localStream = this.audioScorer?.isActive ? this.audioScorer.getBroadcastStream() : null;
    for (const m of members) {
      if (m.id === this.myId) continue;
      if (localStream || m.isSinging) {
        const shouldOffer = this.myId < m.id || Boolean(localStream);
        this.ensurePeerConnection(m.id, shouldOffer);
      }
    }
  }

  handleLocalMicChange(isActive, stream) {
    this.socket.emit("webrtc:announce-mic", { isSinging: isActive });

    if (isActive && stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      for (const [peerId, peer] of this.peers.entries()) {
        this.attachLocalTrackToPeer(peerId, peer, audioTrack, stream);
      }
    } else {
      for (const [, peer] of this.peers.entries()) {
        if (peer.sender && peer.pc && peer.pc.signalingState !== "closed") {
          try {
            peer.sender.replaceTrack(null).catch(() => {});
          } catch (_) {}
        }
      }
    }
  }

  attachLocalTrackToPeer(peerId, peer, audioTrack, stream) {
    if (!peer || !peer.pc || peer.pc.signalingState === "closed") return;
    try {
      if (peer.sender) {
        peer.sender.replaceTrack(audioTrack).catch(() => {});
      } else {
        peer.sender = peer.pc.addTrack(audioTrack, stream);
        this.negotiateWithPeer(peerId, peer);
      }
    } catch (err) {
      console.warn("WebRTC attach track error:", err);
    }
  }

  ensurePeerConnection(peerId, initiateOffer = false) {
    if (!peerId || peerId === this.myId) return null;
    let peer = this.peers.get(peerId);
    if (peer && peer.pc && peer.pc.signalingState !== "closed") {
      if (initiateOffer && !peer. negotiatedOnce) {
        this.negotiateWithPeer(peerId, peer);
      }
      return peer;
    }

    if (typeof RTCPeerConnection === "undefined") return null;

    const pc = new RTCPeerConnection(this.rtcConfig);
    peer = {
      id: peerId,
      pc,
      sender: null,
      audioEl: null,
      remoteSourceNode: null,
      remoteAnalyser: null,
      routedToWebAudio: false,
      nextPlayTime: 0,
      lastWebRtcActiveAt: 0,
      makingOffer: false,
      negotiatedOnce: false
    };
    this.peers.set(peerId, peer);

    // Gắn track micro của mình nếu đang bật Mic
    if (this.audioScorer?.isActive) {
      const stream = this.audioScorer.getBroadcastStream();
      const track = stream?.getAudioTracks()?.[0];
      if (track) {
        peer.sender = pc.addTrack(track, stream);
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit("webrtc:ice-candidate", {
          targetId: peerId,
          candidate: e.candidate
        });
      }
    };

    pc.onnegotiationneeded = () => {
      this.negotiateWithPeer(peerId, peer);
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams?.[0] || new MediaStream([event.track]);
      this.setupRemotePeerStream(peer, remoteStream);
    };

    if (initiateOffer) {
      this.negotiateWithPeer(peerId, peer);
    }

    return peer;
  }

  async negotiateWithPeer(peerId, peer) {
    if (!peer || !peer.pc || peer.makingOffer) return;
    if (peer.pc.signalingState !== "stable") return;
    try {
      peer.makingOffer = true;
      peer.negotiatedOnce = true;
      const offer = await peer.pc.createOffer({
        offerToReceiveAudio: true
      });
      if (peer.pc.signalingState !== "stable") return;
      await peer.pc.setLocalDescription(offer);
      this.socket.emit("webrtc:offer", {
        targetId: peerId,
        sdp: peer.pc.localDescription
      });
    } catch (_) {
    } finally {
      peer.makingOffer = false;
    }
  }

  setupRemotePeerStream(peer, remoteStream) {
    const ctx = this.ensureAudioContext();

    if (!peer.audioEl) {
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.style.display = "none";
      document.body.appendChild(audioEl);
      peer.audioEl = audioEl;
    }

    peer.audioEl.srcObject = remoteStream;

    if (ctx && this.vocalCompressor) {
      try {
        // Trong Chrome, <audio> cần play() (ở trạng thái muted) để MediaStreamSourceNode nhận luồng dữ liệu WebRTC
        peer.audioEl.muted = true;
        peer.audioEl.play().catch(() => {});

        if (peer.remoteSourceNode) {
          try {
            peer.remoteSourceNode.disconnect();
          } catch (_) {}
        }
        peer.remoteSourceNode = ctx.createMediaStreamSource(remoteStream);
        peer.remoteAnalyser = ctx.createAnalyser();
        peer.remoteAnalyser.fftSize = 256;

        peer.remoteSourceNode.connect(peer.remoteAnalyser);
        peer.remoteAnalyser.connect(this.vocalCompressor);
        peer.routedToWebAudio = true;
      } catch (_) {
        peer.routedToWebAudio = false;
        peer.audioEl.muted = this.voiceMuted;
        peer.audioEl.volume = Math.min(1, this.voiceVolume);
        peer.audioEl.play().catch(() => {});
      }
    } else {
      peer.audioEl.muted = this.voiceMuted;
      peer.audioEl.volume = Math.min(1, this.voiceVolume);
      peer.audioEl.play().catch(() => {});
    }
  }

  isPeerWebRtcDeliveringAudio(peer) {
    if (!peer || !peer.pc) return false;
    const state = peer.pc.iceConnectionState || peer.pc.connectionState;
    if (state !== "connected" && state !== "completed") return false;

    if (peer.remoteAnalyser) {
      const buf = new Float32Array(peer.remoteAnalyser.fftSize);
      peer.remoteAnalyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        sum += buf[i] * buf[i];
      }
      const rms = Math.sqrt(sum / buf.length);
      if (rms > 0.0008) {
        peer.lastWebRtcActiveAt = performance.now();
        return true;
      }
    }
    return performance.now() - (peer.lastWebRtcActiveAt || 0) < 600;
  }

  // Phát gói âm thanh giọng hát thời gian thực từ Socket.io (Đảm bảo 100% mọi thành viên luôn nghe thấy nhau)
  handleIncomingVoiceStream({ singerId, pcm, sampleRate = 16000 }) {
    if (!singerId || singerId === this.myId || this.voiceMuted || !pcm) return;

    let peer = this.peers.get(singerId);
    if (!peer) {
      peer = this.ensurePeerConnection(singerId, false) || {
        id: singerId,
        nextPlayTime: 0,
        lastWebRtcActiveAt: 0
      };
      this.peers.set(singerId, peer);
    }

    // Nếu kết nối P2P WebRTC của thành viên này đã thông suốt và đang phát tiếng thì bỏ qua gói fallback để không bị lặp tiếng
    if (this.isPeerWebRtcDeliveringAudio(peer)) {
      return;
    }

    const ctx = this.ensureAudioContext();
    if (!ctx || !this.vocalCompressor) return;

    let int16;
    if (pcm instanceof ArrayBuffer) {
      int16 = new Int16Array(pcm);
    } else if (ArrayBuffer.isView(pcm)) {
      int16 = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
    } else if (pcm.data && Array.isArray(pcm.data)) {
      int16 = new Int16Array(new Uint8Array(pcm.data).buffer);
    } else {
      return;
    }

    if (int16.length === 0) return;

    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 0x8000;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const now = ctx.currentTime;
    if (!peer.nextPlayTime || peer.nextPlayTime < now || peer.nextPlayTime > now + 0.35) {
      peer.nextPlayTime = now + 0.045; // Bộ đệm Jitter 45ms giúp âm thanh mượt, không đứt quãng
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.vocalCompressor);
    source.start(peer.nextPlayTime);
    peer.nextPlayTime += audioBuffer.duration;
  }

  bindSocketSignaling() {
    if (!this.socket) return;

    this.socket.on("voice:stream", (payload) => {
      this.handleIncomingVoiceStream(payload);
    });

    this.socket.on("webrtc:peer-mic", ({ peerId, isSinging }) => {
      if (!peerId || peerId === this.myId) return;
      if (isSinging) {
        this.ensurePeerConnection(peerId, true);
      }
    });

    this.socket.on("webrtc:offer", async ({ fromId, sdp }) => {
      if (!fromId || fromId === this.myId || !sdp) return;
      const peer = this.ensurePeerConnection(fromId, false);
      if (!peer || !peer.pc) return;

      try {
        const polite = this.myId > fromId;
        const offerCollision = peer.makingOffer || peer.pc.signalingState !== "stable";
        if (offerCollision && !polite) {
          return;
        }
        await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.socket.emit("webrtc:answer", {
          targetId: fromId,
          sdp: peer.pc.localDescription
        });
      } catch (err) {
        console.warn("WebRTC offer handle error:", err);
      }
    });

    this.socket.on("webrtc:answer", async ({ fromId, sdp }) => {
      if (!fromId || !sdp) return;
      const peer = this.peers.get(fromId);
      if (!peer || !peer.pc) return;
      try {
        if (peer.pc.signalingState === "have-local-offer") {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
        }
      } catch (err) {
        console.warn("WebRTC answer handle error:", err);
      }
    });

    this.socket.on("webrtc:ice-candidate", async ({ fromId, candidate }) => {
      if (!fromId || !candidate) return;
      const peer = this.peers.get(fromId);
      if (!peer || !peer.pc) return;
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (_) {}
    });

    this.socket.on("webrtc:peer-left", ({ peerId }) => {
      this.removePeer(peerId);
    });
  }

  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    if (peer.remoteSourceNode) {
      try {
        peer.remoteSourceNode.disconnect();
      } catch (_) {}
    }
    if (peer.audioEl) {
      try {
        peer.audioEl.pause();
        peer.audioEl.srcObject = null;
        peer.audioEl.remove();
      } catch (_) {}
    }
    if (peer.pc) {
      try {
        peer.pc.close();
      } catch (_) {}
    }
    this.peers.delete(peerId);
  }

  destroy() {
    for (const peerId of this.peers.keys()) {
      this.removePeer(peerId);
    }
  }
}

window.KaraokeAudioScorer = KaraokeAudioScorer;
window.KaraokeRoomVoiceEngine = KaraokeRoomVoiceEngine;
