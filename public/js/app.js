// Karaoke Online iTV - Main Client Application

const socket = io();

const state = {
  myId: null,
  userName: localStorage.getItem("karaoke_userName") || "",
  avatar: localStorage.getItem("karaoke_avatar") || "🎤",
  role: "tv", // 'tv' | 'remote'
  room: null,
  currentVideoId: null,
  ytPlayer: null,
  ytReady: false,
  localMuted: false,
  catalogSongs: [],
  displayedSongs: [],
  selectedGenre: "ALL",
  favorites: JSON.parse(localStorage.getItem("karaoke_favorites") || "[]"),
  networkInfo: { ip: window.location.hostname, port: window.location.port || 3000 },
  activeSingers: new Map()
};

// Khởi tạo bộ chấm điểm giọng hát & truyền giọng hát thời gian thực qua Micro
const audioScorer = new window.KaraokeAudioScorer(
  (telemetry) => {
    const noteEl = document.getElementById("localPitchNote");
    const accEl = document.getElementById("localAccuracyLabel");
    const scoreEl = document.getElementById("localLiveScore");

    if (noteEl) noteEl.textContent = telemetry.pitchNote;
    if (accEl) accEl.textContent = telemetry.accuracyLabel;
    if (scoreEl) scoreEl.textContent = telemetry.liveScore;

    if (state.room) {
      socket.emit("mic:telemetry", telemetry);
    }
  },
  (voiceChunk) => {
    if (state.room) {
      socket.emit("voice:stream", voiceChunk);
    }
  }
);

// Khởi tạo bộ thu phát giọng hát đa thành viên (WebRTC Mesh + Web Audio Live Stream)
const roomVoiceEngine = new window.KaraokeRoomVoiceEngine(socket, audioScorer);

// ================= TIỆN ÍCH HIỂN THỊ =================
function showToast(message) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const item = document.createElement("div");
  item.className = "toast-item";
  item.textContent = message;
  container.appendChild(item);
  setTimeout(() => {
    item.remove();
  }, 3200);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ================= YOUTUBE IFRAME API =================
window.onYouTubeIframeAPIReady = function () {
  state.ytReady = true;
  initYouTubePlayerIfNeeded();
};

function initYouTubePlayerIfNeeded() {
  if (!state.ytReady || state.ytPlayer) return;
  const playerContainer = document.getElementById("youtubePlayer");
  if (!playerContainer) return;

  state.ytPlayer = new YT.Player("youtubePlayer", {
    width: "100%",
    height: "100%",
    videoId: state.currentVideoId || "JB39GfVEzFA",
    playerVars: {
      autoplay: 1,
      controls: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError
    }
  });
}

function onPlayerReady(event) {
  const volSlider = document.getElementById("musicVolumeSlider");
  if (volSlider) {
    event.target.setVolume(parseInt(volSlider.value, 10) || 85);
  }
  if (state.localMuted || state.role === "remote") {
    event.target.mute();
  }
  if (state.room && state.room.currentSong) {
    loadAndSyncCurrentSong(state.room.currentSong, true);
  }
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.ENDED) {
    // Chỉ Host hoặc người đang mở màn hình TV chính kích hoạt chuyển bài tự động để tránh trùng lặp
    if (state.room && (state.room.hostId === state.myId || state.role === "tv")) {
      socket.emit("player:next", { finishWithScore: true });
    }
  } else if (event.data === YT.PlayerState.PLAYING) {
    hideFallbackOverlay();
    const label = document.getElementById("playPauseLabel");
    if (label) label.textContent = "Tạm dừng";
  } else if (event.data === YT.PlayerState.PAUSED) {
    const label = document.getElementById("playPauseLabel");
    if (label) label.textContent = "Tiếp tục phát";
  }
}

function onPlayerError(event) {
  // Mã lỗi 101 / 150: Chủ sở hữu kênh YouTube chặn nhúng ngoài trang
  const songTitle = state.room?.currentSong?.title || "Bài hát hiện tại";
  showFallbackOverlay(
    `⚠️ Video "${songTitle}" bị chủ kênh hạn chế phát nhúng`,
    "Bạn có thể bấm nút bên dưới để tìm nhanh một bản Karaoke khác của bài này hoặc chuyển sang bài tiếp theo.",
    true
  );
}

function showFallbackOverlay(title, desc, showAltSearchBtn = false) {
  const overlay = document.getElementById("tvFallbackOverlay");
  const titleEl = document.getElementById("fallbackTitle");
  const descEl = document.getElementById("fallbackDesc");
  const altBtn = document.getElementById("btnFallbackSearchAlt");
  if (!overlay) return;

  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = desc;
  if (altBtn) {
    altBtn.classList.toggle("hidden", !showAltSearchBtn);
  }
  overlay.classList.remove("hidden");
}

function hideFallbackOverlay() {
  const overlay = document.getElementById("tvFallbackOverlay");
  if (overlay) overlay.classList.add("hidden");
}

function loadAndSyncCurrentSong(song, forceReload = false) {
  if (!song || !song.videoId) {
    state.currentVideoId = null;
    if (state.ytPlayer && typeof state.ytPlayer.stopVideo === "function") {
      state.ytPlayer.stopVideo();
    }
    showFallbackOverlay(
      "🎤 Sân khấu đang chờ bài hát tiếp theo!",
      "Hãy chọn một bài hát từ Kho nhạc hoặc tìm kiếm trên YouTube ở bảng bên phải.",
      false
    );
    return;
  }

  hideFallbackOverlay();

  if (state.currentVideoId !== song.videoId || forceReload) {
    state.currentVideoId = song.videoId;
    audioScorer.resetSongScore();

    if (state.ytPlayer && typeof state.ytPlayer.loadVideoById === "function") {
      state.ytPlayer.loadVideoById({
        videoId: song.videoId,
        startSeconds: 0
      });
      if (state.localMuted || state.role === "remote") {
        state.ytPlayer.mute();
      }
    } else {
      initYouTubePlayerIfNeeded();
    }
  }
}

// ================= KHỞI TẠO SẢNH CHỜ (LOBBY) =================
async function initApp() {
  const nameInput = document.getElementById("userNameInput");
  if (nameInput && state.userName) {
    nameInput.value = state.userName;
  }

  // Khôi phục Avatar đã lưu
  document.querySelectorAll("#avatarSelector .avatar-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.avatar === state.avatar);
    btn.addEventListener("click", () => {
      document.querySelectorAll("#avatarSelector .avatar-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.avatar = btn.dataset.avatar;
      localStorage.setItem("karaoke_avatar", state.avatar);
    });
  });

  // Chọn vai trò khi tạo phòng
  let createRole = "tv";
  document.querySelectorAll("#createRoleSelector .role-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      document.querySelectorAll("#createRoleSelector .role-option").forEach((o) => o.classList.remove("active"));
      opt.classList.add("active");
      createRole = opt.dataset.role;
    });
  });

  // Nút Tạo phòng mới
  document.getElementById("btnCreateRoom")?.addEventListener("click", () => {
    const roomName = document.getElementById("createRoomNameInput")?.value.trim() || "";
    joinOrCreateRoom({
      roomCode: "",
      roomName,
      role: createRole,
      createIfMissing: true
    });
  });

  // Nút Tham gia phòng theo mã
  document.getElementById("btnJoinRoom")?.addEventListener("click", () => {
    const code = document.getElementById("joinRoomCodeInput")?.value.trim().toUpperCase();
    const role = document.getElementById("joinRoleSelect")?.value || "tv";
    if (!code) {
      showToast("⚠️ Vui lòng nhập mã phòng 6 ký tự!");
      return;
    }
    joinOrCreateRoom({
      roomCode: code,
      role,
      createIfMissing: true
    });
  });

  document.getElementById("btnRefreshRooms")?.addEventListener("click", fetchActiveRooms);

  // Tải thông tin IP mạng LAN & Kho bài hát mặc định
  fetchNetworkInfo();
  fetchActiveRooms();
  await loadDefaultCatalog();

  // Kiểm tra URL query (?room=ABC123&mode=remote)
  const params = new URLSearchParams(window.location.search);
  const urlRoom = params.get("room");
  const urlMode = params.get("mode");
  if (urlRoom) {
    const codeInput = document.getElementById("joinRoomCodeInput");
    const roleSelect = document.getElementById("joinRoleSelect");
    if (codeInput) codeInput.value = urlRoom.toUpperCase();
    if (roleSelect && (urlMode === "remote" || window.innerWidth < 768)) {
      roleSelect.value = "remote";
    }
    // Nếu đã có tên hoặc vào từ QR điện thoại, tự động điền tên gợi ý nếu trống
    if (!nameInput.value.trim()) {
      nameInput.value = `Ca Sĩ #${Math.floor(100 + Math.random() * 899)}`;
    }
    joinOrCreateRoom({
      roomCode: urlRoom.toUpperCase(),
      role: urlMode === "remote" || window.innerWidth < 768 ? "remote" : "tv",
      createIfMissing: true
    });
  }

  bindRoomEvents();
}

async function fetchNetworkInfo() {
  try {
    const res = await fetch("/api/network-info");
    if (res.ok) {
      state.networkInfo = await res.json();
    }
  } catch (_) {}
}

async function fetchActiveRooms() {
  const container = document.getElementById("activeRoomsList");
  if (!container) return;

  try {
    const res = await fetch("/api/rooms");
    const data = await res.json();
    const rooms = data.rooms || [];

    if (rooms.length === 0) {
      container.innerHTML = `<div class="empty-rooms-hint">Chưa có phòng nào đang mở. Hãy là người đầu tiên tạo phòng nhé!</div>`;
      return;
    }

    container.innerHTML = rooms
      .map(
        (r) => `
      <div class="active-room-item">
        <div>
          <strong>#${escapeHtml(r.code)} - ${escapeHtml(r.name)}</strong>
          <small>👥 ${r.memberCount} người • 🎵 Đang hát: ${escapeHtml(r.currentSongTitle)}</small>
        </div>
        <div style="display:flex; gap:6px;">
          <button type="button" class="btn btn-primary btn-sm" onclick="window.quickJoinRoom('${escapeHtml(r.code)}', 'tv')">📺 Vào TV</button>
          <button type="button" class="btn btn-accent btn-sm" onclick="window.quickJoinRoom('${escapeHtml(r.code)}', 'remote')">📱 ĐT Remote</button>
        </div>
      </div>
    `
      )
      .join("");
  } catch (_) {}
}

window.quickJoinRoom = function (code, role) {
  joinOrCreateRoom({ roomCode: code, role, createIfMissing: false });
};

function joinOrCreateRoom({ roomCode, roomName, role, createIfMissing }) {
  const nameInput = document.getElementById("userNameInput");
  let userName = nameInput?.value.trim() || state.userName;
  if (!userName) {
    userName = `Ca Sĩ #${Math.floor(100 + Math.random() * 899)}`;
    if (nameInput) nameInput.value = userName;
  }
  state.userName = userName;
  localStorage.setItem("karaoke_userName", userName);

  socket.emit(
    "room:join",
    {
      roomCode,
      roomName,
      userName: state.userName,
      avatar: state.avatar,
      role: role || "tv",
      createIfMissing
    },
    (res) => {
      if (res?.error) {
        showToast(`❌ ${res.error}`);
        return;
      }
      state.myId = res.myId;
      state.room = res.room;
      roomVoiceEngine.setMyId(res.myId);
      roomVoiceEngine.ensureAudioContext();
      enterRoomScreen(role || "tv");
    }
  );
}

function enterRoomScreen(role) {
  document.getElementById("lobbyScreen")?.classList.add("hidden");
  document.getElementById("roomScreen")?.classList.remove("hidden");

  setRoleMode(role);
  renderRoomState(state.room);
  initYouTubePlayerIfNeeded();

  // Cập nhật URL để dễ share hoặc F5 không mất mã phòng
  if (state.room?.code) {
    const newUrl = `${window.location.pathname}?room=${state.room.code}&mode=${state.role}`;
    window.history.replaceState({}, "", newUrl);
  }

  window.soundFX.playCheerChime();
  showToast(`🎉 Đã vào phòng #${state.room.code}!`);
}

function setRoleMode(role) {
  state.role = role === "remote" ? "remote" : "tv";

  const mainLayout = document.getElementById("roomMainLayout");
  const btnTv = document.getElementById("btnSwitchTvMode");
  const btnRemote = document.getElementById("btnSwitchRemoteMode");
  const remoteHeader = document.getElementById("mobileRemoteQuickHeader");

  if (mainLayout) {
    mainLayout.classList.toggle("remote-mode-active", state.role === "remote");
  }
  if (btnTv) btnTv.classList.toggle("active", state.role === "tv");
  if (btnRemote) btnRemote.classList.toggle("active", state.role === "remote");
  if (remoteHeader) {
    remoteHeader.classList.toggle("hidden", state.role !== "remote");
  }

  // Nếu chuyển sang chế độ Remote điện thoại, tự động tắt tiếng trình phát YouTube phụ để tránh vọng âm với TV chính
  if (state.ytPlayer && typeof state.ytPlayer.mute === "function") {
    if (state.role === "remote" || state.localMuted) {
      state.ytPlayer.mute();
    } else {
      state.ytPlayer.unMute();
    }
  }

  socket.emit("member:switchRole", { role: state.role });
}

// ================= KHO BÀI HÁT & TÌM KIẾM YOUTUBE =================
async function loadDefaultCatalog() {
  try {
    const res = await fetch("/api/songs");
    const data = await res.json();
    state.catalogSongs = data.songs || [];
    state.displayedSongs = [...state.catalogSongs];
    renderSongsList();
  } catch (err) {
    console.error("Lỗi tải danh sách bài hát:", err);
  }
}

async function searchBrowserYouTubeFallback(searchQuery) {
  const endpoints = [
    `https://api.piped.private.coffee/search?q=${encodeURIComponent(searchQuery)}&filter=videos`,
    `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(searchQuery)}&filter=videos`,
    `https://pipedapi.tokhmi.xyz/search?q=${encodeURIComponent(searchQuery)}&filter=videos`
  ];

  for (const url of endpoints) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(4500) });
      if (!resp.ok) continue;
      const data = await resp.json();
      const items = data.items || [];
      const results = [];

      for (const item of items) {
        const videoUrl = item.url || "";
        const match = videoUrl.match(/v=([a-zA-Z0-9_-]{11})/);
        const videoId = match ? match[1] : null;
        if (!videoId) continue;

        const durSec = item.duration || 0;
        const mins = Math.floor(durSec / 60);
        const secs = String(durSec % 60).padStart(2, "0");

        results.push({
          id: `yt-${videoId}`,
          videoId,
          title: item.title || "Karaoke Video",
          artist: item.uploaderName || "YouTube Karaoke",
          genre: "YouTube",
          duration: durSec > 0 ? `${mins}:${secs}` : "Karaoke",
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        });
        if (results.length >= 15) break;
      }

      if (results.length > 0) return results;
    } catch (_) {}
  }
  return null;
}

async function searchYouTubeSongs(query) {
  const q = (query || "").trim();
  const container = document.getElementById("songsListContainer");
  if (!q) {
    filterSongsByGenre(state.selectedGenre);
    return;
  }

  if (container) {
    container.innerHTML = `<div class="empty-rooms-hint">🔍 Đang tìm video Karaoke cho "${escapeHtml(q)}"...</div>`;
  }

  try {
    const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();

    // Nếu server chạy trong môi trường giới hạn mạng (catalog-fallback), trình duyệt sẽ tự gọi API YouTube trực tiếp
    if (data.source === "catalog-fallback") {
      const ytQuery = q.toLowerCase().includes("karaoke") ? q : `${q} karaoke`;
      const browserResults = await searchBrowserYouTubeFallback(ytQuery);
      if (browserResults && browserResults.length > 0) {
        state.displayedSongs = browserResults;
        renderSongsList();
        return;
      }
    }

    state.displayedSongs = data.songs || [];
    renderSongsList();
  } catch (err) {
    showToast("⚠️ Không thể tìm kiếm lúc này, đang hiển thị kho nhạc có sẵn.");
    state.displayedSongs = state.catalogSongs;
    renderSongsList();
  }
}

function filterSongsByGenre(genre) {
  state.selectedGenre = genre;
  document.querySelectorAll("#genreFilterBar .genre-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.genre === genre);
  });

  if (genre === "FAV") {
    state.displayedSongs = state.favorites;
  } else if (genre === "ALL") {
    state.displayedSongs = [...state.catalogSongs];
  } else {
    state.displayedSongs = state.catalogSongs.filter(
      (s) => (s.genre || "").toLowerCase() === genre.toLowerCase()
    );
  }
  renderSongsList();
}

function isFavorite(videoId) {
  return state.favorites.some((f) => f.videoId === videoId);
}

function toggleFavoriteSong(song) {
  const exists = isFavorite(song.videoId);
  if (exists) {
    state.favorites = state.favorites.filter((f) => f.videoId !== song.videoId);
    showToast(`💔 Đã xóa "${song.title}" khỏi Yêu thích`);
  } else {
    state.favorites.unshift(song);
    showToast(`❤️ Đã lưu "${song.title}" vào Yêu thích`);
  }
  localStorage.setItem("karaoke_favorites", JSON.stringify(state.favorites));
  if (state.selectedGenre === "FAV") {
    state.displayedSongs = state.favorites;
  }
  renderSongsList();
}

function renderSongsList() {
  const container = document.getElementById("songsListContainer");
  if (!container) return;

  if (!state.displayedSongs || state.displayedSongs.length === 0) {
    container.innerHTML = `<div class="empty-rooms-hint">Không tìm thấy bài hát nào. Hãy thử nhập tên bài hát và bấm "Tìm kiếm"!</div>`;
    return;
  }

  container.innerHTML = state.displayedSongs
    .map((song, idx) => {
      const fav = isFavorite(song.videoId);
      return `
      <div class="song-card">
        <img class="song-thumb" src="${escapeHtml(song.thumbnail)}" alt="thumb" loading="lazy" />
        <div class="song-info">
          <div class="song-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
          <div class="song-meta">🎤 ${escapeHtml(song.artist)} • ⏱️ ${escapeHtml(song.duration || "Karaoke")}</div>
        </div>
        <div class="song-actions">
          <button type="button" class="btn-icon ${fav ? "fav-active" : ""}" onclick="window.handleToggleFav(${idx})" title="Lưu yêu thích">
            ${fav ? "❤️" : "🤍"}
          </button>
          <button type="button" class="btn-icon" onclick="window.handleAddSong(${idx}, true)" title="Ưu tiên phát đầu hàng chờ">
            ⚡
          </button>
          <button type="button" class="btn btn-primary btn-sm" onclick="window.handleAddSong(${idx}, false)" title="Thêm vào danh sách chờ">
            ➕ Chọn
          </button>
        </div>
      </div>
    `;
    })
    .join("");
}

window.handleToggleFav = function (idx) {
  const song = state.displayedSongs[idx];
  if (song) toggleFavoriteSong(song);
};

window.handleAddSong = function (idx, priority) {
  const song = state.displayedSongs[idx];
  if (!song) return;

  const singerInput = document.getElementById("songSingerInput");
  const dedicationInput = document.getElementById("songDedicationInput");

  const singerName = singerInput?.value.trim() || state.userName;
  const dedication = dedicationInput?.value.trim() || "";

  socket.emit("queue:add", { song, priority, singerName, dedication }, (res) => {
    if (res?.ok) {
      window.soundFX.playPop();
      showToast(
        priority
          ? `⚡ Đã ưu tiên "${song.title}" lên đầu danh sách chờ!`
          : `🎵 Đã thêm "${song.title}" vào danh sách chờ!`
      );
      if (dedicationInput) dedicationInput.value = "";
    }
  });
};

// ================= ĐỒNG BỘ & RENDER GIAO DIỆN PHÒNG HÁT =================
function renderRoomState(room) {
  if (!room) return;
  state.room = room;

  // Cập nhật chủ đề ánh sáng sân khấu
  document.body.className = `theme-${room.stageTheme || "neon"}`;
  const themeSelect = document.getElementById("stageThemeSelect");
  if (themeSelect && themeSelect.value !== room.stageTheme) {
    themeSelect.value = room.stageTheme;
  }

  // Thông tin phòng
  document.getElementById("roomNameDisplay").textContent = room.name;
  document.getElementById("roomCodeDisplay").textContent = room.code;
  document.getElementById("tvCornerRoomCode").textContent = room.code;
  document.getElementById("modalRoomCodeText").textContent = room.code;

  // Bài hát đang phát
  const cur = room.currentSong;
  const nowTitle = document.getElementById("tvNowPlayingTitle");
  const nowSub = document.getElementById("tvNowPlayingSub");
  const remoteNow = document.getElementById("remoteNowPlayingTitle");

  if (cur) {
    if (nowTitle) nowTitle.textContent = cur.title;
    if (nowSub) {
      nowSub.textContent = `🎤 Thể hiện: ${cur.singerName || "Tự do"} • Chọn bởi: ${cur.addedBy || "Thành viên"}`;
    }
    if (remoteNow) remoteNow.textContent = cur.title;
  } else {
    if (nowTitle) nowTitle.textContent = "Chưa có bài hát đang phát";
    if (nowSub) nowSub.textContent = "Hãy chọn bài hát từ kho YouTube Karaoke!";
    if (remoteNow) remoteNow.textContent = "Chưa chọn bài";
  }

  // Bài tiếp theo (Up Next)
  const upNextEl = document.getElementById("tvUpNextTitle");
  if (upNextEl) {
    if (room.queue && room.queue.length > 0) {
      const next = room.queue[0];
      upNextEl.textContent = `${next.title} (${next.singerName})`;
    } else {
      upNextEl.textContent = "Hãy thêm bài vào hàng chờ 🎶";
    }
  }

  // Đồng bộ Video YouTube
  loadAndSyncCurrentSong(cur, false);

  // Thanh chạy chữ iTV (Marquee Ticker)
  const marqueeTrack = document.getElementById("itvMarqueeTrack");
  if (marqueeTrack && room.tickerMessages) {
    marqueeTrack.innerHTML = room.tickerMessages
      .map((msg) => `<span>${escapeHtml(msg)}</span>`)
      .join("<span> •✦• </span>");
  }

  // Render Hàng chờ (Queue)
  renderQueue(room.queue || []);

  // Đồng bộ kết nối giọng hát đa thành viên & trạng thái ai đang bật Mic
  if (state.myId) {
    roomVoiceEngine.setMyId(state.myId);
    roomVoiceEngine.syncRoomMembers(room.members || []);
  }
  syncActiveSingersFromRoom(room.members || []);

  // Render Bảng xếp hạng, Lịch sử & Thành viên
  renderLeaderboardAndMembers(room);
}

function syncActiveSingersFromRoom(members) {
  const memberIds = new Set(members.map((m) => m.id));
  for (const singerId of state.activeSingers.keys()) {
    if (!memberIds.has(singerId)) {
      state.activeSingers.delete(singerId);
    }
  }
  for (const m of members) {
    if (m.isSinging) {
      const existing = state.activeSingers.get(m.id) || {};
      state.activeSingers.set(m.id, {
        singerId: m.id,
        singerName: m.name,
        singerAvatar: m.avatar,
        isSinging: true,
        liveScore: m.currentLiveScore || existing.liveScore || 65,
        pitchNote: m.currentPitchNote || existing.pitchNote || "--",
        volume: m.currentVolume ?? existing.volume ?? 0,
        accuracyLabel: existing.accuracyLabel || "Đang hát 🎶"
      });
    } else {
      state.activeSingers.delete(m.id);
    }
  }
  renderLiveSingersHud();
}

function renderLiveSingersHud() {
  const hud = document.getElementById("tvLiveSingerHud");
  const bar = document.getElementById("activeSingersBar");
  const singers = Array.from(state.activeSingers.values());

  if (bar) {
    if (singers.length === 0) {
      bar.innerHTML = `<span class="singers-empty-hint">🎙️ Bất kỳ ai bật Mic đều có thể hát &amp; nghe giọng nhau</span>`;
    } else {
      bar.innerHTML = singers
        .map((s) => {
          const isMe = s.singerId === state.myId;
          const vol = Math.min(100, Math.max(8, s.volume || 15));
          return `
            <span class="active-singer-chip ${s.volume > 10 ? "singing-pulse" : ""}">
              <span>${escapeHtml(s.singerAvatar || "🎤")}</span>
              <strong>${escapeHtml(s.singerName)}${isMe ? " (Bạn)" : ""}</strong>
              <span class="singer-vol-meter"><i style="width:${vol}%"></i></span>
              <small>${s.liveScore || 65}đ</small>
            </span>
          `;
        })
        .join("");
    }
  }

  if (!hud) return;
  if (singers.length === 0) {
    hud.classList.add("hidden");
    return;
  }

  hud.classList.remove("hidden");
  hud.innerHTML = singers
    .map(
      (s) => `
      <div class="singer-hud-item">
        <div class="singer-hud-header">
          <span>${escapeHtml(s.singerAvatar || "🎤")}</span>
          <strong>${escapeHtml(s.singerName || "Ca sĩ")}</strong>
          <span class="pitch-badge">${escapeHtml(s.pitchNote || "--")}</span>
        </div>
        <div class="singer-hud-score-row">
          <span class="accuracy-text">${escapeHtml(s.accuracyLabel || "Đang hát 🎶")}</span>
          <span class="live-score-number">${s.liveScore || 0}</span>
          <small>ĐIỂM</small>
        </div>
      </div>
    `
    )
    .join("");
}

function renderQueue(queue) {
  const badge = document.getElementById("queueCountBadge");
  if (badge) badge.textContent = queue.length;

  const container = document.getElementById("queueListContainer");
  if (!container) return;

  if (queue.length === 0) {
    container.innerHTML = `<div class="empty-rooms-hint">Danh sách chờ đang trống. Hãy qua tab "🎵 Chọn Bài" để thêm bài hát nhé!</div>`;
    return;
  }

  container.innerHTML = queue
    .map((item, index) => {
      const votesCount = item.votes ? item.votes.length : 0;
      return `
      <div class="song-card">
        <div class="queue-order-num">${index + 1}</div>
        <img class="song-thumb" src="${escapeHtml(item.thumbnail)}" alt="thumb" />
        <div class="song-info">
          <div class="song-title">${escapeHtml(item.title)}</div>
          <div class="song-meta">🎤 Ca sĩ: <strong>${escapeHtml(item.singerName)}</strong> • Thêm bởi: ${escapeHtml(item.addedBy)}</div>
          ${
            item.dedication
              ? `<div class="queue-dedication-note">💌 "${escapeHtml(item.dedication)}"</div>`
              : ""
          }
        </div>
        <div class="song-actions">
          <button type="button" class="btn-icon" onclick="window.voteQueueItem('${item.queueId}')" title="Bình chọn đẩy bài lên cao kiểu iTV">
            ❤️<small style="font-size:0.65rem;margin-left:2px;">${votesCount}</small>
          </button>
          ${
            index > 0
              ? `<button type="button" class="btn-icon" onclick="window.prioritizeQueueItem('${item.queueId}')" title="Ưu tiên lên đầu">⚡</button>`
              : ""
          }
          <button type="button" class="btn-icon" onclick="window.moveQueueItem('${item.queueId}', 'up')" title="Lên 1 bậc">🔼</button>
          <button type="button" class="btn-icon" onclick="window.moveQueueItem('${item.queueId}', 'down')" title="Xuống 1 bậc">🔽</button>
          <button type="button" class="btn-icon" onclick="window.removeQueueItem('${item.queueId}')" title="Xóa khỏi hàng chờ">🗑️</button>
        </div>
      </div>
    `;
    })
    .join("");
}

window.voteQueueItem = (queueId) => {
  window.soundFX.playPop();
  socket.emit("queue:vote", { queueId });
};
window.prioritizeQueueItem = (queueId) => socket.emit("queue:prioritize", { queueId });
window.moveQueueItem = (queueId, direction) => socket.emit("queue:move", { queueId, direction });
window.removeQueueItem = (queueId) => socket.emit("queue:remove", { queueId });

function renderLeaderboardAndMembers(room) {
  const memberBadge = document.getElementById("memberCountBadge");
  if (memberBadge) memberBadge.textContent = (room.members || []).length;

  // 1. Bảng xếp hạng
  const lbContainer = document.getElementById("leaderboardListContainer");
  if (lbContainer) {
    const lb = room.leaderboard || [];
    const medals = ["🥇", "🥈", "🥉"];
    lbContainer.innerHTML = lb
      .map((m, idx) => {
        const medal = medals[idx] || `#${idx + 1}`;
        const badgesHtml = (m.badges || [])
          .map((b) => `<span class="badge-pill">${b.icon} ${escapeHtml(b.label)}</span>`)
          .join("");
        return `
        <div class="rank-item">
          <div>
            <div>
              <span class="rank-medal">${medal}</span>
              <strong>${escapeHtml(m.avatar)} ${escapeHtml(m.name)}</strong>
              ${m.isHost ? `<span class="badge-pill">👑 Chủ phòng</span>` : ""}
            </div>
            <div class="member-badges">${badgesHtml}</div>
          </div>
          <div style="text-align:right;">
            <strong style="color:var(--gold);font-size:0.95rem;">${m.totalScore || 0} điểm</strong>
            <small style="display:block;color:var(--text-muted);font-size:0.72rem;">
              Đã hát ${m.songsSung || 0} bài • ❤️ ${m.reactionsSent || 0} cổ vũ
            </small>
          </div>
        </div>
      `;
      })
      .join("");
  }

  // 2. Lịch sử chấm điểm
  const histContainer = document.getElementById("scoreHistoryContainer");
  if (histContainer) {
    const history = room.history || [];
    if (history.length === 0) {
      histContainer.innerHTML = `<div class="empty-rooms-hint">Chưa có bài hát nào hoàn thành chấm điểm.</div>`;
    } else {
      histContainer.innerHTML = history
        .map(
          (h) => `
        <div class="rank-item">
          <div>
            <strong>${escapeHtml(h.singerAvatar)} ${escapeHtml(h.singerName)}</strong>
            <small style="display:block;color:var(--text-muted);font-size:0.74rem;">🎵 ${escapeHtml(h.songTitle)}</small>
          </div>
          <div style="text-align:right;">
            <strong style="color:var(--accent);font-size:1rem;">${h.score} Đ</strong>
            <small style="display:block;color:var(--gold);font-size:0.68rem;">${escapeHtml(h.rankTitle)}</small>
          </div>
        </div>
      `
        )
        .join("");
    }
  }

  // 3. Danh sách thành viên
  const memContainer = document.getElementById("membersListContainer");
  if (memContainer) {
    memContainer.innerHTML = (room.members || [])
      .map(
        (m) => `
      <div class="member-item">
        <div>
          <strong>${escapeHtml(m.avatar)} ${escapeHtml(m.name)}</strong>
          <small style="color:var(--text-muted);margin-left:6px;">
            ${m.role === "remote" ? "📱 Remote ĐT" : "📺 Màn hình TV"}
          </small>
        </div>
        <div>
          ${
            m.isSinging
              ? `<span class="badge-pill" style="background:rgba(255,0,85,0.25);color:#ff8fa3;">🎙️ Đang hát (${m.currentLiveScore}đ)</span>`
              : `<span style="font-size:0.74rem;color:var(--accent);">● Online</span>`
          }
        </div>
      </div>
    `
      )
      .join("");
  }
}

// ================= HIỆU ỨNG SÂN KHẤU: DANMAKU, EMOJI BURST & CHẤM ĐIỂM =================
function spawnDanmaku({ text, userName, avatar, color }) {
  const layer = document.getElementById("danmakuLayer");
  if (!layer) return;

  const item = document.createElement("div");
  item.className = "danmaku-item";
  item.style.top = `${8 + Math.floor(Math.random() * 68)}%`;
  item.style.color = color || "#00f5d4";
  item.style.border = `1px solid ${color || "#00f5d4"}`;
  item.textContent = `${avatar || "💬"} ${userName}: ${text}`;

  layer.appendChild(item);
  setTimeout(() => item.remove(), 9600);
}

function spawnReactionBurst({ emoji, label, userName, soundEffect }) {
  if (soundEffect === "applause") window.soundFX.playApplause();
  else if (soundEffect === "airhorn") window.soundFX.playAirhorn();
  else if (soundEffect === "chime") window.soundFX.playCheerChime();
  else window.soundFX.playPop();

  const layer = document.getElementById("reactionBurstLayer");
  if (!layer) return;

  // Tạo chùm 5 biểu cảm bay lên rực rỡ
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      const el = document.createElement("div");
      el.className = "floating-reaction";
      el.style.left = `${12 + Math.floor(Math.random() * 76)}%`;
      el.innerHTML = `
        <span>${escapeHtml(emoji)}</span>
        ${i === 0 ? `<small>${escapeHtml(userName)} ${escapeHtml(label || "")}</small>` : ""}
      `;
      layer.appendChild(el);
      setTimeout(() => el.remove(), 3300);
    }, i * 110);
  }
}

function appendChatMessage(msg) {
  const container = document.getElementById("chatMessagesContainer");
  if (!container) return;

  const div = document.createElement("div");
  div.className = `chat-bubble type-${msg.type || "chat"}`;

  if (msg.type === "system" || msg.type === "queue") {
    div.textContent = msg.text;
  } else {
    div.innerHTML = `
      <span class="chat-author">${escapeHtml(msg.avatar)} ${escapeHtml(msg.userName)}:</span>
      <span>${escapeHtml(msg.text)}</span>
    `;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function showScoreCelebrationModal(record) {
  const modal = document.getElementById("scoreModal");
  if (!modal || !record) return;

  document.getElementById("modalSingerAvatar").textContent = record.singerAvatar || "🎤";
  document.getElementById("modalSingerName").textContent = record.singerName || "Ca Sĩ";
  document.getElementById("modalSongTitle").textContent = `🎵 ${record.songTitle}`;
  document.getElementById("modalScoreValue").textContent = record.score;
  document.getElementById("modalRankTitle").textContent = record.rankTitle;

  modal.classList.remove("hidden");
  window.soundFX.playScoreFanfare();
}

// ================= GẮN SỰ KIỆN TRONG PHÒNG HÁT =================
function bindRoomEvents() {
  // Chuyển chế độ TV / Remote ĐT
  document.getElementById("btnSwitchTvMode")?.addEventListener("click", () => setRoleMode("tv"));
  document.getElementById("btnSwitchRemoteMode")?.addEventListener("click", () => setRoleMode("remote"));

  // Sao chép mã phòng
  document.getElementById("btnCopyRoomCode")?.addEventListener("click", () => {
    if (!state.room) return;
    navigator.clipboard?.writeText(state.room.code);
    showToast(`📋 Đã sao chép mã phòng: ${state.room.code}`);
  });

  // Đổi chủ đề ánh sáng sân khấu
  document.getElementById("stageThemeSelect")?.addEventListener("change", (e) => {
    socket.emit("stage:theme", { theme: e.target.value });
  });

  // Rời phòng
  document.getElementById("btnLeaveRoom")?.addEventListener("click", () => {
    audioScorer.stop();
    roomVoiceEngine.destroy();
    window.location.href = window.location.pathname;
  });

  // Chuyển Tab Sidebar
  document.querySelectorAll(".sidebar-tabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.tab;
      document.querySelectorAll(".sidebar-tabs .tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".companion-sidebar .tab-pane").forEach((p) => {
        p.classList.toggle("hidden", p.id !== targetId);
        p.classList.toggle("active", p.id === targetId);
      });
      btn.classList.add("active");
    });
  });

  // Nút nhảy nhanh tới ô Tìm & Chọn Bài Hát
  document.getElementById("btnQuickFocusSearch")?.addEventListener("click", () => {
    const tabSongsBtn = document.querySelector('.sidebar-tabs .tab-btn[data-tab="tabSongs"]');
    tabSongsBtn?.click();
    const sInput = document.getElementById("songSearchInput");
    if (sInput) {
      sInput.scrollIntoView({ behavior: "smooth", block: "center" });
      sInput.focus();
    }
  });

  // Tìm kiếm bài hát YouTube Karaoke (tự động lọc khi gõ + tìm trên YouTube)
  const searchInput = document.getElementById("songSearchInput");
  let searchDebounceTimer = null;

  document.getElementById("btnSearchYouTube")?.addEventListener("click", () => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchYouTubeSongs(searchInput?.value);
  });

  searchInput?.addEventListener("input", () => {
    const q = searchInput.value.trim();
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (!q) {
      filterSongsByGenre(state.selectedGenre);
      return;
    }
    // Lọc nhanh tức thì trong kho có sẵn trước
    const qLower = q.toLowerCase();
    const instantMatches = state.catalogSongs.filter(
      (s) =>
        s.title.toLowerCase().includes(qLower) ||
        s.artist.toLowerCase().includes(qLower) ||
        s.genre.toLowerCase().includes(qLower)
    );
    if (instantMatches.length > 0) {
      state.displayedSongs = instantMatches;
      renderSongsList();
    }
    // Sau 500ms ngừng gõ sẽ tự động tìm rộng trên YouTube Karaoke
    searchDebounceTimer = setTimeout(() => {
      searchYouTubeSongs(q);
    }, 500);
  });

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchYouTubeSongs(searchInput.value);
    }
  });

  // Lọc thể loại
  document.querySelectorAll("#genreFilterBar .genre-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      filterSongsByGenre(chip.dataset.genre);
    });
  });

  // Điều khiển trình phát nhạc
  const togglePlayPause = () => {
    if (!state.ytPlayer || typeof state.ytPlayer.getPlayerState !== "function") return;
    const pState = state.ytPlayer.getPlayerState();
    const curTime = state.ytPlayer.getCurrentTime ? state.ytPlayer.getCurrentTime() : 0;
    if (pState === YT.PlayerState.PLAYING) {
      socket.emit("player:control", { action: "pause", currentTime: curTime });
    } else {
      socket.emit("player:control", { action: "play", currentTime: curTime });
    }
  };

  document.getElementById("btnPlayPause")?.addEventListener("click", togglePlayPause);
  document.getElementById("btnRemotePlayPause")?.addEventListener("click", togglePlayPause);

  document.getElementById("btnReplaySong")?.addEventListener("click", () => {
    socket.emit("player:control", { action: "replay", currentTime: 0 });
  });

  const finishAndScore = () => {
    const myLiveScore = Math.round(audioScorer.liveScore);
    socket.emit("player:next", {
      finishWithScore: true,
      manualScore: myLiveScore >= 65 ? myLiveScore : undefined
    });
  };

  document.getElementById("btnFinishAndScore")?.addEventListener("click", finishAndScore);
  document.getElementById("btnRemoteFinishScore")?.addEventListener("click", finishAndScore);

  document.getElementById("btnSkipNoScore")?.addEventListener("click", () => {
    socket.emit("player:next", { finishWithScore: false });
  });

  // Nút trên màn hình Fallback khi video bị chặn nhúng
  document.getElementById("btnFallbackSkipNext")?.addEventListener("click", () => {
    socket.emit("player:next", { finishWithScore: false });
  });
  document.getElementById("btnFallbackSearchAlt")?.addEventListener("click", () => {
    const title = state.room?.currentSong?.title || "";
    if (searchInput) {
      searchInput.value = `${title} karaoke beat`;
      searchYouTubeSongs(searchInput.value);
      showToast("🔍 Hãy chọn một phiên bản Karaoke khác ở danh sách bên phải!");
    }
  });

  // Âm lượng nhạc nền & Tắt tiếng cục bộ
  document.getElementById("musicVolumeSlider")?.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    if (state.ytPlayer && typeof state.ytPlayer.setVolume === "function") {
      state.ytPlayer.setVolume(val);
    }
  });

  document.getElementById("btnToggleLocalMute")?.addEventListener("click", (e) => {
    state.localMuted = !state.localMuted;
    const btn = e.currentTarget;
    if (state.ytPlayer) {
      if (state.localMuted) state.ytPlayer.mute();
      else state.ytPlayer.unMute();
    }
    btn.textContent = state.localMuted ? "🔇 Nhạc TV: Tắt" : "🔊 Nhạc TV: Bật";
  });

  // Âm lượng & Bật/Tắt nghe Giọng hát của các thành viên khác trong phòng
  document.getElementById("remoteVoiceVolumeSlider")?.addEventListener("input", (e) => {
    roomVoiceEngine.setRemoteVoiceVolume(e.target.value);
  });

  const handleToggleRemoteVoice = () => {
    const muted = roomVoiceEngine.toggleRemoteVoiceMute();
    const btnMain = document.getElementById("btnToggleRemoteVoice");
    const btnRemote = document.getElementById("btnRemoteToggleVoice");
    if (btnMain) {
      btnMain.textContent = muted ? "🔇 Voice Phòng: Tắt" : "🔊 Voice Phòng: Bật";
    }
    if (btnRemote) {
      btnRemote.textContent = muted ? "🔇 Voice: Tắt" : "🔊 Voice: Bật";
    }
    showToast(
      muted
        ? "🔇 Đã tắt tiếng giọng hát của các thành viên khác trên thiết bị này."
        : "🔊 Đã bật nghe giọng hát trực tiếp của mọi thành viên trong phòng!"
    );
  };

  document.getElementById("btnToggleRemoteVoice")?.addEventListener("click", handleToggleRemoteVoice);
  document.getElementById("btnRemoteToggleVoice")?.addEventListener("click", handleToggleRemoteVoice);

  // Bật / Tắt Micro Hát & Truyền giọng trực tiếp cho cả phòng
  const handleMicToggle = async () => {
    const btnMain = document.getElementById("btnToggleMic");
    const btnRemote = document.getElementById("btnRemoteToggleMic");

    roomVoiceEngine.ensureAudioContext();

    if (!audioScorer.isActive) {
      const ok = await audioScorer.start();
      if (!ok) {
        showToast("⚠️ Vui lòng cấp quyền truy cập Micro trên trình duyệt để hát cùng mọi người!");
        return;
      }
      if (btnMain) {
        btnMain.className = "btn btn-mic-on";
        btnMain.textContent = "🎙️ Đang Hát Live (Bấm để tắt Mic)";
      }
      if (btnRemote) {
        btnRemote.className = "btn btn-sm btn-mic-on";
        btnRemote.textContent = "🎙️ Đang Hát (Tắt Mic)";
      }
      showToast("🎤 Đã bật Micro! Cả phòng đang nghe giọng hát của bạn trực tiếp!");
    } else {
      audioScorer.stop();
      if (btnMain) {
        btnMain.className = "btn btn-mic-off";
        btnMain.textContent = "🎙️ Bật Mic Hát Cùng Phòng";
      }
      if (btnRemote) {
        btnRemote.className = "btn btn-sm btn-mic-off";
        btnRemote.textContent = "🎙️ Bật Mic Hát";
      }
      showToast("🔇 Đã tắt Micro.");
    }
  };

  document.getElementById("btnToggleMic")?.addEventListener("click", handleMicToggle);
  document.getElementById("btnRemoteToggleMic")?.addEventListener("click", handleMicToggle);

  document.getElementById("chkMicEchoMonitor")?.addEventListener("change", (e) => {
    audioScorer.setMonitorEcho(e.target.checked);
    if (e.target.checked) {
      showToast("🔊 Đã bật phát giọng + Echo KTV! (Nên dùng tai nghe hoặc đặt Mic xa loa để tránh hú)");
    }
  });

  document.getElementById("micGainSlider")?.addEventListener("input", (e) => {
    audioScorer.setMicVolume(e.target.value);
  });

  // Các nút thả biểu cảm & cổ vũ
  document.querySelectorAll(".btn-reaction, .btn-reaction-mini").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("stage:reaction", {
        emoji: btn.dataset.emoji,
        label: btn.dataset.label,
        soundEffect: btn.dataset.sfx
      });
    });
  });

  // Gửi Chat & Chữ bay iTV Danmaku
  document.getElementById("chatForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("chatTextInput");
    const showOnTv = document.getElementById("chkSendToTvTicker")?.checked;
    const color = document.getElementById("danmakuColorPicker")?.value || "#00f5d4";

    const text = input?.value.trim();
    if (!text) return;

    socket.emit("chat:send", { text, showOnTv, color });
    input.value = "";
  });

  // Đóng Modal Chấm điểm
  document.getElementById("btnCloseScoreModal")?.addEventListener("click", () => {
    document.getElementById("scoreModal")?.classList.add("hidden");
  });

  // Mở / Đóng Modal Mời Bạn Bè & QR Code
  const openInviteModal = () => {
    if (!state.room) return;
    const hostOrigin =
      window.location.hostname === "localhost" && state.networkInfo.ip !== "localhost"
        ? `http://${state.networkInfo.ip}:${state.networkInfo.port}`
        : window.location.origin;

    const remoteUrl = `${hostOrigin}/?room=${state.room.code}&mode=remote`;
    const tvUrl = `${hostOrigin}/?room=${state.room.code}&mode=tv`;

    const remoteInput = document.getElementById("remoteInviteUrlInput");
    const tvInput = document.getElementById("tvInviteUrlInput");
    const qrImg = document.getElementById("inviteQrImage");

    if (remoteInput) remoteInput.value = remoteUrl;
    if (tvInput) tvInput.value = tvUrl;
    if (qrImg) {
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(remoteUrl)}`;
    }

    document.getElementById("inviteModal")?.classList.remove("hidden");
  };

  document.getElementById("btnOpenInviteModal")?.addEventListener("click", openInviteModal);
  document.getElementById("btnCornerInvite")?.addEventListener("click", openInviteModal);
  document.getElementById("btnCloseInviteModal")?.addEventListener("click", () => {
    document.getElementById("inviteModal")?.classList.add("hidden");
  });

  document.getElementById("btnCopyRemoteUrl")?.addEventListener("click", () => {
    const val = document.getElementById("remoteInviteUrlInput")?.value;
    if (val) {
      navigator.clipboard?.writeText(val);
      showToast("📋 Đã sao chép Link Điều khiển Điện thoại!");
    }
  });

  document.getElementById("btnCopyTvUrl")?.addEventListener("click", () => {
    const val = document.getElementById("tvInviteUrlInput")?.value;
    if (val) {
      navigator.clipboard?.writeText(val);
      showToast("📋 Đã sao chép Link Màn hình TV!");
    }
  });
}

// ================= NHẬN SỰ KIỆN REAL-TIME TỪ SOCKET.IO =================
socket.on("room:state", (room) => {
  renderRoomState(room);
});

socket.on("player:sync", ({ action, playback }) => {
  if (!state.ytPlayer || typeof state.ytPlayer.seekTo !== "function") return;

  if (action === "play") {
    if (typeof playback.currentTime === "number") {
      const diff = Math.abs((state.ytPlayer.getCurrentTime?.() || 0) - playback.currentTime);
      if (diff > 2.5) state.ytPlayer.seekTo(playback.currentTime, true);
    }
    state.ytPlayer.playVideo?.();
  } else if (action === "pause") {
    state.ytPlayer.pauseVideo?.();
  } else if (action === "replay") {
    state.ytPlayer.seekTo(0, true);
    state.ytPlayer.playVideo?.();
  }
});

socket.on("stage:micLive", (data) => {
  if (!data || !data.singerId) return;
  if (!data.isSinging) {
    state.activeSingers.delete(data.singerId);
  } else {
    state.activeSingers.set(data.singerId, {
      ...data,
      updatedAt: Date.now()
    });
  }
  renderLiveSingersHud();
});

socket.on("stage:danmaku", (payload) => {
  spawnDanmaku(payload);
});

socket.on("stage:reaction", (payload) => {
  spawnReactionBurst(payload);
});

socket.on("chat:new", (msg) => {
  appendChatMessage(msg);
});

socket.on("stage:scoreModal", (record) => {
  showScoreCelebrationModal(record);
});

// Khởi chạy ứng dụng khi DOM sẵn sàng
document.addEventListener("DOMContentLoaded", initApp);

