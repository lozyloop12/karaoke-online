const express = require("express");
const http = require("http");
const path = require("path");
const os = require("os");
const { Server } = require("socket.io");
const { DEFAULT_KARAOKE_SONGS } = require("./data/songs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 5e6
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// In-memory store for active Karaoke rooms
const rooms = new Map();

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

function getRankTitle(score) {
  if (score >= 95) return "👑 Siêu Sao Giọng Ca Vàng (SSS)";
  if (score >= 88) return "💎 Ca Sĩ Chuyên Nghiệp (SS)";
  if (score >= 80) return "🌟 Giọng Ca Triển Vọng (S)";
  if (score >= 70) return "🎤 Cây Văn Nghệ Phòng Trà (A)";
  return "🎶 Nhiệt Huyết Hết Mình (B)";
}

function computeBadges(member) {
  const badges = [];
  if (member.bestScore >= 92) badges.push({ icon: "👑", label: "Giọng Ca Vàng" });
  if (member.songsSung >= 2) badges.push({ icon: "🎤", label: "Chiến Thần Cầm Mic" });
  if (member.songsAdded >= 3) badges.push({ icon: "📀", label: "DJ Tuyển Bài" });
  if (member.reactionsSent >= 10) badges.push({ icon: "🔥", label: "Thánh Cổ Vũ" });
  return badges;
}

function serializeRoom(room) {
  const membersList = Array.from(room.members.values()).map((m) => ({
    ...m,
    badges: computeBadges(m)
  }));

  const leaderboard = [...membersList].sort((a, b) => {
    const scoreDiff = (b.totalScore || 0) - (a.totalScore || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return (b.reactionsSent || 0) - (a.reactionsSent || 0);
  });

  return {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    stageTheme: room.stageTheme,
    members: membersList,
    leaderboard,
    currentSong: room.currentSong,
    playback: room.playback,
    queue: room.queue,
    history: room.history.slice(0, 15),
    tickerMessages: room.tickerMessages.slice(-12),
    chatHistory: room.chatHistory.slice(-50)
  };
}

function createRoom({ code, name, hostId }) {
  const roomCode = (code || generateRoomCode()).toUpperCase();
  const initialSong = {
    queueId: "init-" + Date.now(),
    ...DEFAULT_KARAOKE_SONGS[3], // Chúng Ta Của Hiện Tại
    addedBy: "iTV Hệ Thống",
    singerName: "Mọi người",
    dedication: "Chào mừng các bạn đến với phòng hát Karaoke Online iTV! Hãy chọn bài và bật Mic cùng hòa giọng nhé!",
    votes: []
  };

  const defaultQueue = [
    {
      queueId: "init-q1-" + Date.now(),
      ...DEFAULT_KARAOKE_SONGS[6], // Cắt Đôi Nỗi Sầu
      addedBy: "iTV Hệ Thống",
      singerName: "Tự do",
      dedication: "Quẩy hết mình cùng bạn bè tối nay!",
      votes: []
    },
    {
      queueId: "init-q2-" + Date.now(),
      ...DEFAULT_KARAOKE_SONGS[13], // Hơn Cả Yêu
      addedBy: "iTV Hệ Thống",
      singerName: "Song ca",
      dedication: "Dành tặng những trái tim yêu âm nhạc ❤️",
      votes: []
    }
  ];

  const room = {
    code: roomCode,
    name: name || `Phòng Karaoke iTV #${roomCode}`,
    hostId,
    stageTheme: "neon",
    members: new Map(),
    currentSong: initialSong,
    playback: {
      isPlaying: true,
      currentTime: 0,
      updatedAt: Date.now()
    },
    queue: defaultQueue,
    history: [],
    tickerMessages: [
      `📺 Chào mừng đến với ${name || `Phòng Karaoke iTV #${roomCode}`}! Mã phòng: ${roomCode}`,
      `🎤 Bấm "Chế độ Điện thoại / Remote" hoặc quét mã QR trên màn hình để chọn bài và thả tim từ xa!`,
      `💌 Gửi lời chúc & yêu cầu bài hát tại khung Chat iTV để chạy chữ trực tiếp trên màn hình lớn!`
    ],
    chatHistory: [],
    createdAt: Date.now()
  };

  rooms.set(roomCode, room);
  return room;
}

// Helper to extract YouTube Video ID from any URL or ID string
function extractYouTubeId(input) {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = trimmed.match(regex);
  return match ? match[1] : null;
}

// REST API: Local network info for QR code sharing
app.get("/api/network-info", (req, res) => {
  const port = server.address()?.port || process.env.PORT || 3000;
  res.json({
    ip: getLocalIpAddress(),
    port
  });
});

// REST API: Get active rooms for Lobby discovery
app.get("/api/rooms", (req, res) => {
  const activeRooms = [];
  for (const room of rooms.values()) {
    if (room.members.size > 0) {
      const host = room.members.get(room.hostId);
      activeRooms.push({
        code: room.code,
        name: room.name,
        memberCount: room.members.size,
        hostName: host ? host.name : "Chủ phòng",
        currentSongTitle: room.currentSong ? room.currentSong.title : "Đang chờ chọn bài...",
        queueCount: room.queue.length
      });
    }
  }
  res.json({ rooms: activeRooms });
});

// REST API: Get default curated Karaoke songs
app.get("/api/songs", (req, res) => {
  const { q = "", genre = "ALL" } = req.query;
  const query = q.trim().toLowerCase();
  const filtered = DEFAULT_KARAOKE_SONGS.filter((song) => {
    const matchesGenre = genre === "ALL" || song.genre.toLowerCase() === genre.toLowerCase();
    const matchesQuery =
      !query ||
      song.title.toLowerCase().includes(query) ||
      song.artist.toLowerCase().includes(query) ||
      song.genre.toLowerCase().includes(query);
    return matchesGenre && matchesQuery;
  });
  res.json({ songs: filtered });
});

// REST API: Search YouTube directly for Karaoke videos (with graceful fallback)
app.get("/api/youtube/search", async (req, res) => {
  const rawQuery = (req.query.q || "").trim();
  const autoKaraoke = req.query.karaoke !== "false";
  if (!rawQuery) {
    return res.json({ songs: DEFAULT_KARAOKE_SONGS, source: "catalog" });
  }

  // First check if user pasted a direct YouTube link or 11-char videoId
  const directVideoId = extractYouTubeId(rawQuery);
  if (directVideoId) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${directVideoId}`
      )}&format=json`;
      const resp = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json();
        return res.json({
          source: "youtube-direct",
          songs: [
            {
              id: `yt-${directVideoId}`,
              videoId: directVideoId,
              title: data.title || `YouTube Karaoke (${directVideoId})`,
              artist: data.author_name || "YouTube Karaoke",
              genre: "YouTube",
              duration: "LIVE",
              thumbnail: `https://i.ytimg.com/vi/${directVideoId}/hqdefault.jpg`
            }
          ]
        });
      }
    } catch (_) {
      // Fallback to direct video object even if offline
    }
    return res.json({
      source: "youtube-direct",
      songs: [
        {
          id: `yt-${directVideoId}`,
          videoId: directVideoId,
          title: `Video Karaoke YouTube (#${directVideoId})`,
          artist: "YouTube",
          genre: "YouTube",
          duration: "Video",
          thumbnail: `https://i.ytimg.com/vi/${directVideoId}/hqdefault.jpg`
        }
      ]
    });
  }

  const qLowerCheck = rawQuery.toLowerCase();
  const hasKaraokeKeyword =
    qLowerCheck.includes("karaoke") ||
    qLowerCheck.includes("beat") ||
    qLowerCheck.includes("instrumental");
  const searchQuery =
    autoKaraoke && !hasKaraokeKeyword
      ? `${rawQuery} karaoke beat chuẩn`
      : rawQuery;

  try {
    const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}&hl=vi`;
    const response = await fetch(ytSearchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
      },
      signal: AbortSignal.timeout(6500)
    });

    if (response.ok) {
      const html = await response.text();
      const match = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
      if (match && match[1]) {
        const data = JSON.parse(match[1]);
        const contents =
          data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
        const karaokeResults = [];
        const fallbackResults = [];

        for (const section of contents) {
          const items = section?.itemSectionRenderer?.contents || [];
          for (const item of items) {
            const v = item.videoRenderer;
            if (!v || !v.videoId) continue;
            const title = v.title?.runs?.map((r) => r.text).join("") || "Karaoke Video";
            const artist = v.ownerText?.runs?.[0]?.text || "Karaoke Channel";
            const duration = v.lengthText?.simpleText || "Karaoke";
            const tLower = title.toLowerCase();
            const aLower = artist.toLowerCase();

            const isMvWithVocals =
              tLower.includes("official music video") ||
              tLower.includes("official mv") ||
              tLower.includes("official video") ||
              tLower.includes("m/v") ||
              tLower.includes("lyrics video") ||
              tLower.includes("lyric video");
            const isKaraokeTrack =
              tLower.includes("karaoke") ||
              tLower.includes("beat") ||
              tLower.includes("instrumental") ||
              tLower.includes("backing track") ||
              aLower.includes("karaoke") ||
              aLower.includes("beat");

            const songObj = {
              id: `yt-${v.videoId}`,
              videoId: v.videoId,
              title,
              artist,
              genre: "YouTube",
              duration,
              thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
            };

            if (isKaraokeTrack) {
              karaokeResults.push(songObj);
            } else if (!isMvWithVocals) {
              fallbackResults.push(songObj);
            }
            if (karaokeResults.length >= 16) break;
          }
          if (karaokeResults.length >= 16) break;
        }

        const finalResults =
          karaokeResults.length > 0
            ? [...karaokeResults, ...fallbackResults].slice(0, 16)
            : fallbackResults.slice(0, 16);

        if (finalResults.length > 0) {
          return res.json({ songs: finalResults, source: "youtube" });
        }
      }
    }
  } catch (err) {
    // Fallback to local catalog matching if YouTube scrape times out or is offline
  }

  const qLower = rawQuery.toLowerCase();
  const localMatches = DEFAULT_KARAOKE_SONGS.filter(
    (s) =>
      s.title.toLowerCase().includes(qLower) ||
      s.artist.toLowerCase().includes(qLower) ||
      s.genre.toLowerCase().includes(qLower)
  );
  res.json({
    songs: localMatches.length > 0 ? localMatches : DEFAULT_KARAOKE_SONGS,
    source: "catalog-fallback"
  });
});

// Socket.io Real-Time Karaoke & iTV Logic
io.on("connection", (socket) => {
  let currentRoomCode = null;

  socket.on("room:join", ({ roomCode, roomName, userName, avatar, role, createIfMissing }, callback) => {
    const cleanCode = (roomCode || "").trim().toUpperCase() || generateRoomCode();
    let room = rooms.get(cleanCode);

    if (!room) {
      if (createIfMissing === false) {
        return callback?.({ error: `Không tìm thấy phòng #${cleanCode}. Vui lòng kiểm tra lại mã phòng!` });
      }
      room = createRoom({
        code: cleanCode,
        name: roomName || `Phòng Karaoke iTV #${cleanCode}`,
        hostId: socket.id
      });
    }

    currentRoomCode = room.code;
    socket.join(room.code);

    // If room had no host or host disconnected, assign this user
    if (!room.hostId || !room.members.has(room.hostId)) {
      room.hostId = socket.id;
    }

    const member = {
      id: socket.id,
      name: (userName || "Ca Sĩ Bí Ẩn").trim().slice(0, 28),
      avatar: avatar || "🎤",
      role: role || "tv", // 'tv' or 'remote'
      isHost: room.hostId === socket.id,
      isSinging: false,
      totalScore: 0,
      bestScore: 0,
      songsSung: 0,
      songsAdded: 0,
      reactionsSent: 0,
      currentLiveScore: 0,
      currentPitchNote: "--"
    };

    room.members.set(socket.id, member);

    const joinMsg = {
      id: "msg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      type: "system",
      userName: member.name,
      avatar: member.avatar,
      text: `${member.avatar} ${member.name} đã bước vào phòng hát (${
        member.role === "remote" ? "📱 Điều khiển ĐT" : "📺 Màn hình TV"
      })!`,
      timestamp: Date.now()
    };
    room.chatHistory.push(joinMsg);

    const serialized = serializeRoom(room);
    io.to(room.code).emit("room:state", serialized);
    io.to(room.code).emit("chat:new", joinMsg);

    callback?.({ ok: true, room: serialized, myId: socket.id });
  });

  // Switch between TV Screen role and Mobile Remote role
  socket.on("member:switchRole", ({ role }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const member = room.members.get(socket.id);
    if (!member) return;
    member.role = role === "remote" ? "remote" : "tv";
    io.to(room.code).emit("room:state", serializeRoom(room));
  });

  // Add song to Queue (or prioritize)
  socket.on("queue:add", ({ song, priority, singerName, dedication }, callback) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || !song || !song.videoId) return;

    const member = room.members.get(socket.id);
    const addedBy = member ? `${member.avatar} ${member.name}` : "Khách";
    if (member) {
      member.songsAdded = (member.songsAdded || 0) + 1;
    }

    const queueItem = {
      queueId: "q-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      id: song.id || `yt-${song.videoId}`,
      videoId: song.videoId,
      title: song.title || `Karaoke #${song.videoId}`,
      artist: song.artist || "YouTube Karaoke",
      genre: song.genre || "Karaoke",
      duration: song.duration || "Karaoke",
      thumbnail: song.thumbnail || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`,
      addedBy,
      singerName: (singerName || (member ? member.name : "Tự do")).trim(),
      dedication: (dedication || "").trim(),
      votes: [socket.id]
    };

    if (dedication && dedication.trim()) {
      const tickerText = `💌 [${queueItem.singerName} - Chọn bài "${queueItem.title}"]: ${dedication.trim()}`;
      room.tickerMessages.push(tickerText);
      io.to(room.code).emit("stage:danmaku", {
        text: tickerText,
        avatar: member?.avatar || "💌",
        userName: member?.name || "Yêu cầu bài hát",
        color: "#ffbe0b"
      });
    }

    if (!room.currentSong) {
      room.currentSong = queueItem;
      room.playback = {
        isPlaying: true,
        currentTime: 0,
        updatedAt: Date.now()
      };
    } else if (priority) {
      room.queue.unshift(queueItem);
    } else {
      room.queue.push(queueItem);
    }

    const sysMsg = {
      id: "msg-" + Date.now(),
      type: "queue",
      userName: member?.name || "Thành viên",
      avatar: member?.avatar || "🎵",
      text: `${addedBy} đã thêm bài "${queueItem.title}" ${priority ? "(⚡ Ưu tiên đầu bảng)" : "vào danh sách chờ"}!`,
      timestamp: Date.now()
    };
    room.chatHistory.push(sysMsg);

    io.to(room.code).emit("room:state", serializeRoom(room));
    io.to(room.code).emit("chat:new", sysMsg);
    callback?.({ ok: true, queueItem });
  });

  // Vote / Heart a song in Queue (iTV interactive song request voting!)
  socket.on("queue:vote", ({ queueId }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const item = room.queue.find((q) => q.queueId === queueId);
    if (!item) return;

    if (!item.votes.includes(socket.id)) {
      item.votes.push(socket.id);
    }
    // Sort queue softly by votes if multiple items have higher votes
    room.queue.sort((a, b) => (b.votes?.length || 0) - (a.votes?.length || 0));
    io.to(room.code).emit("room:state", serializeRoom(room));
  });

  // Move song to top of Queue
  socket.on("queue:prioritize", ({ queueId }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const idx = room.queue.findIndex((q) => q.queueId === queueId);
    if (idx > 0) {
      const [item] = room.queue.splice(idx, 1);
      room.queue.unshift(item);
      io.to(room.code).emit("room:state", serializeRoom(room));
    }
  });

  // Move song up or down by 1 step
  socket.on("queue:move", ({ queueId, direction }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const idx = room.queue.findIndex((q) => q.queueId === queueId);
    if (idx === -1) return;
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= room.queue.length) return;

    const temp = room.queue[idx];
    room.queue[idx] = room.queue[targetIdx];
    room.queue[targetIdx] = temp;
    io.to(room.code).emit("room:state", serializeRoom(room));
  });

  // Remove song from Queue
  socket.on("queue:remove", ({ queueId }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    room.queue = room.queue.filter((q) => q.queueId !== queueId);
    io.to(room.code).emit("room:state", serializeRoom(room));
  });

  // Synchronize playback state (Play / Pause / Seek / Replay)
  socket.on("player:control", ({ action, currentTime }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    if (action === "play") {
      room.playback.isPlaying = true;
      if (typeof currentTime === "number") room.playback.currentTime = currentTime;
      room.playback.updatedAt = Date.now();
    } else if (action === "pause") {
      room.playback.isPlaying = false;
      if (typeof currentTime === "number") room.playback.currentTime = currentTime;
      room.playback.updatedAt = Date.now();
    } else if (action === "replay") {
      room.playback.isPlaying = true;
      room.playback.currentTime = 0;
      room.playback.updatedAt = Date.now();
    } else if (action === "seek" && typeof currentTime === "number") {
      room.playback.currentTime = currentTime;
      room.playback.updatedAt = Date.now();
    }

    io.to(room.code).emit("player:sync", {
      action,
      playback: room.playback,
      triggeredBy: socket.id
    });
  });

  // Finish song, compute KTV Score Celebration, and move to next song
  socket.on("player:next", ({ finishWithScore, manualScore }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const finishedSong = room.currentSong;
    if (finishedSong && finishWithScore !== false) {
      // Find all members who sang or scored during this song
      let activeSingers = Array.from(room.members.values()).filter(
        (m) => m.isSinging || m.currentLiveScore > 0
      );
      if (activeSingers.length === 0) {
        const fallback = room.members.get(socket.id) || Array.from(room.members.values())[0];
        if (fallback) activeSingers = [fallback];
      }

      // Compute individual scores & combined celebration score
      const singerScores = [];
      for (const singer of activeSingers) {
        let sScore =
          singer.id === socket.id && manualScore
            ? manualScore
            : singer.currentLiveScore > 0
              ? Math.min(100, Math.max(72, Math.round(singer.currentLiveScore)))
              : Math.floor(82 + Math.random() * 17);
        singer.songsSung = (singer.songsSung || 0) + 1;
        singer.totalScore = (singer.totalScore || 0) + sScore;
        singer.bestScore = Math.max(singer.bestScore || 0, sScore);
        singer.currentLiveScore = 0;
        singer.currentPitchNote = "--";
        singerScores.push(sScore);
      }

      const finalScore =
        singerScores.length > 0
          ? Math.round(Math.max(...singerScores))
          : manualScore || Math.floor(82 + Math.random() * 17);

      const rankTitle = getRankTitle(finalScore);
      const singerName =
        activeSingers.length > 1
          ? activeSingers.map((s) => s.name).join(" & ")
          : activeSingers[0]?.name || finishedSong.singerName || "Ca Sĩ Phòng Hát";
      const singerAvatar =
        activeSingers.length > 1
          ? activeSingers.map((s) => s.avatar).join("")
          : activeSingers[0]?.avatar || "🎤";

      const record = {
        id: "hist-" + Date.now(),
        songTitle: finishedSong.title,
        artist: finishedSong.artist,
        singerName,
        singerAvatar,
        score: finalScore,
        rankTitle,
        timestamp: Date.now()
      };
      room.history.unshift(record);

      const tickerCongrats = `🏆 Chúc mừng ${singerAvatar} ${singerName} vừa hoàn thành bài "${finishedSong.title}" với ${finalScore} điểm (${rankTitle})!`;
      room.tickerMessages.push(tickerCongrats);

      io.to(room.code).emit("stage:scoreModal", record);
    }

    // Advance to next song in queue
    if (room.queue.length > 0) {
      room.currentSong = room.queue.shift();
      room.playback = {
        isPlaying: true,
        currentTime: 0,
        updatedAt: Date.now()
      };
    } else {
      room.currentSong = null;
      room.playback = {
        isPlaying: false,
        currentTime: 0,
        updatedAt: Date.now()
      };
    }

    io.to(room.code).emit("room:state", serializeRoom(room));
  });

  // Live Microphone status & real-time pitch/scoring telemetry
  socket.on("mic:telemetry", ({ isSinging, liveScore, pitchNote, volume, accuracyLabel }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const member = room.members.get(socket.id);
    if (!member) return;

    const prevSinging = member.isSinging;
    member.isSinging = Boolean(isSinging);
    if (typeof liveScore === "number") member.currentLiveScore = liveScore;
    if (pitchNote) member.currentPitchNote = pitchNote;
    member.currentVolume = volume || 0;

    io.to(room.code).emit("stage:micLive", {
      singerId: socket.id,
      singerName: member.name,
      singerAvatar: member.avatar,
      isSinging: member.isSinging,
      liveScore: member.currentLiveScore,
      pitchNote: member.currentPitchNote,
      volume: volume || 0,
      accuracyLabel: accuracyLabel || ""
    });

    if (prevSinging !== member.isSinging) {
      io.to(room.code).emit("room:state", serializeRoom(room));
    }
  });

  // Real-time Voice Audio Stream Relay (All members hear everyone singing in real time)
  socket.on("voice:stream", (payload) => {
    if (!currentRoomCode || !payload || !payload.pcm) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const member = room.members.get(socket.id);
    if (!member) return;

    socket.to(currentRoomCode).emit("voice:stream", {
      singerId: socket.id,
      singerName: member.name,
      singerAvatar: member.avatar,
      pcm: payload.pcm,
      sampleRate: payload.sampleRate || 16000
    });
  });

  // WebRTC Mesh Signaling for Ultra-Low-Latency Multi-Member Voice
  socket.on("webrtc:announce-mic", ({ isSinging }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const member = room.members.get(socket.id);
    if (member) {
      member.isSinging = Boolean(isSinging);
      io.to(room.code).emit("room:state", serializeRoom(room));
    }
    socket.to(currentRoomCode).emit("webrtc:peer-mic", {
      peerId: socket.id,
      isSinging: Boolean(isSinging)
    });
  });

  socket.on("webrtc:offer", ({ targetId, sdp }) => {
    if (!targetId || !sdp) return;
    io.to(targetId).emit("webrtc:offer", {
      fromId: socket.id,
      sdp
    });
  });

  socket.on("webrtc:answer", ({ targetId, sdp }) => {
    if (!targetId || !sdp) return;
    io.to(targetId).emit("webrtc:answer", {
      fromId: socket.id,
      sdp
    });
  });

  socket.on("webrtc:ice-candidate", ({ targetId, candidate }) => {
    if (!targetId || !candidate) return;
    io.to(targetId).emit("webrtc:ice-candidate", {
      fromId: socket.id,
      candidate
    });
  });

  // Interactive Stage Reactions, Emojis & Sound FX
  socket.on("stage:reaction", ({ emoji, label, soundEffect }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const member = room.members.get(socket.id);
    if (member) {
      member.reactionsSent = (member.reactionsSent || 0) + 1;
    }

    io.to(room.code).emit("stage:reaction", {
      id: "react-" + Date.now() + "-" + Math.random().toString(36).slice(2, 5),
      emoji: emoji || "❤️",
      label: label || "",
      soundEffect: soundEffect || null,
      userName: member ? member.name : "Khán giả",
      avatar: member ? member.avatar : "🎉"
    });

    // Update leaderboard counts periodically
    io.to(room.code).emit("room:state", serializeRoom(room));
  });

  // Live Chat & iTV Scrolling Ticker / Danmaku Messages
  socket.on("chat:send", ({ text, showOnTv, color }) => {
    if (!currentRoomCode || !text || !text.trim()) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const member = room.members.get(socket.id);
    const cleanText = text.trim().slice(0, 200);

    const chatMsg = {
      id: "msg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      type: showOnTv ? "itv" : "chat",
      userName: member ? member.name : "Khán giả",
      avatar: member ? member.avatar : "🎤",
      text: cleanText,
      color: color || "#00f5d4",
      timestamp: Date.now()
    };

    room.chatHistory.push(chatMsg);

    if (showOnTv) {
      room.tickerMessages.push(`💬 ${chatMsg.avatar} ${chatMsg.userName}: ${cleanText}`);
      io.to(room.code).emit("stage:danmaku", {
        text: cleanText,
        userName: chatMsg.userName,
        avatar: chatMsg.avatar,
        color: chatMsg.color
      });
    }

    io.to(room.code).emit("chat:new", chatMsg);
    if (showOnTv) {
      io.to(room.code).emit("room:state", serializeRoom(room));
    }
  });

  // Stage Lighting Theme Change
  socket.on("stage:theme", ({ theme }) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    room.stageTheme = theme || "neon";
    io.to(room.code).emit("room:state", serializeRoom(room));
  });

  socket.on("disconnect", () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const member = room.members.get(socket.id);
    room.members.delete(socket.id);

    io.to(room.code).emit("stage:micLive", {
      singerId: socket.id,
      isSinging: false
    });
    io.to(room.code).emit("webrtc:peer-left", {
      peerId: socket.id
    });

    if (room.members.size === 0) {
      // Keep room alive for 10 minutes in case host refreshes, then clean up
      setTimeout(() => {
        const r = rooms.get(currentRoomCode);
        if (r && r.members.size === 0) {
          rooms.delete(currentRoomCode);
        }
      }, 10 * 60 * 1000);
      return;
    }

    if (room.hostId === socket.id) {
      const nextHost = room.members.keys().next().value;
      room.hostId = nextHost;
      const nextMember = room.members.get(nextHost);
      if (nextMember) nextMember.isHost = true;
    }

    if (member) {
      const leaveMsg = {
        id: "msg-" + Date.now(),
        type: "system",
        userName: member.name,
        avatar: member.avatar,
        text: `${member.avatar} ${member.name} đã rời phòng hát.`,
        timestamp: Date.now()
      };
      room.chatHistory.push(leaveMsg);
      io.to(room.code).emit("chat:new", leaveMsg);
    }

    io.to(room.code).emit("room:state", serializeRoom(room));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎤 Karaoke Online iTV Server đang chạy tại: http://localhost:${PORT}`);
  console.log(`📱 Địa chỉ mạng LAN (cho điện thoại cùng Wi-Fi): http://${getLocalIpAddress()}:${PORT}`);
});

