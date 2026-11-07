// Kho bài hát YouTube Karaoke chọn lọc theo thể loại
// Ngoài danh sách gợi ý sẵn này, người dùng có thể tìm kiếm trực tiếp mọi bài hát Karaoke trên YouTube hoặc dán link YouTube bất kỳ.

const DEFAULT_KARAOKE_SONGS = [
  {
    id: "yt-1",
    videoId: "fJ9rUzIMcZQ",
    title: "Bohemian Rhapsody (Karaoke Version)",
    artist: "Queen",
    genre: "US-UK",
    duration: "5:55",
    thumbnail: "https://i.ytimg.com/vi/fJ9rUzIMcZQ/hqdefault.jpg"
  },
  {
    id: "yt-2",
    videoId: "2Vv-BfVoq4g",
    title: "Perfect (Karaoke Acoustic)",
    artist: "Ed Sheeran",
    genre: "US-UK",
    duration: "4:23",
    thumbnail: "https://i.ytimg.com/vi/2Vv-BfVoq4g/hqdefault.jpg"
  },
  {
    id: "yt-3",
    videoId: "kJQP7kiw5Fk",
    title: "Despacito (Party Vibe)",
    artist: "Luis Fonsi ft. Daddy Yankee",
    genre: "Remix / Party",
    duration: "4:41",
    thumbnail: "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg"
  },
  {
    id: "yt-4",
    videoId: "abPmZCZZrFA",
    title: "Chúng Ta Của Hiện Tại (Karaoke Beat Chuẩn)",
    artist: "Sơn Tùng M-TP",
    genre: "Nhạc Trẻ",
    duration: "5:01",
    thumbnail: "https://i.ytimg.com/vi/abPmZCZZrFA/hqdefault.jpg"
  },
  {
    id: "yt-5",
    videoId: "knW7-x7Y7RE",
    title: "Hãy Trao Cho Anh (Beat Sôi Động)",
    artist: "Sơn Tùng M-TP",
    genre: "Remix / Party",
    duration: "4:06",
    thumbnail: "https://i.ytimg.com/vi/knW7-x7Y7RE/hqdefault.jpg"
  },
  {
    id: "yt-6",
    videoId: "FN7ALfpGxiI",
    title: "Nơi Này Có Anh (Karaoke Tone Nam/Nữ)",
    artist: "Sơn Tùng M-TP",
    genre: "Nhạc Trẻ",
    duration: "4:20",
    thumbnail: "https://i.ytimg.com/vi/FN7ALfpGxiI/hqdefault.jpg"
  },
  {
    id: "yt-7",
    videoId: "Llw9Q6akRo4",
    title: "Cắt Đôi Nỗi Sầu (Beat Quẩy Cực Sung)",
    artist: "Tăng Duy Tân",
    genre: "Remix / Party",
    duration: "3:15",
    thumbnail: "https://i.ytimg.com/vi/Llw9Q6akRo4/hqdefault.jpg"
  },
  {
    id: "yt-8",
    videoId: "Yw6u6YkTgQ4",
    title: "Bên Trên Tầng Lầu (Karaoke Remix)",
    artist: "Tăng Duy Tân",
    genre: "Remix / Party",
    duration: "3:04",
    thumbnail: "https://i.ytimg.com/vi/Yw6u6YkTgQ4/hqdefault.jpg"
  },
  {
    id: "yt-9",
    videoId: "cBClD7jylos",
    title: "Waiting For You (Karaoke Beat Chuẩn)",
    artist: "MONO",
    genre: "Nhạc Trẻ",
    duration: "4:25",
    thumbnail: "https://i.ytimg.com/vi/cBClD7jylos/hqdefault.jpg"
  },
  {
    id: "yt-10",
    videoId: "gJHSDZfJrRY",
    title: "See Tình (Karaoke Dance Vibe)",
    artist: "Hoàng Thùy Linh",
    genre: "Remix / Party",
    duration: "3:05",
    thumbnail: "https://i.ytimg.com/vi/gJHSDZfJrRY/hqdefault.jpg"
  },
  {
    id: "yt-11",
    videoId: "ddaEtFOsFeM",
    title: "Mang Tiền Về Cho Mẹ (Karaoke Rap)",
    artist: "Đen Vâu ft. Nguyên Thảo",
    genre: "Rap / Indie",
    duration: "6:45",
    thumbnail: "https://i.ytimg.com/vi/ddaEtFOsFeM/hqdefault.jpg"
  },
  {
    id: "yt-12",
    videoId: "KKc_RMln5UY",
    title: "Hai Triệu Năm (Karaoke Chill)",
    artist: "Đen Vâu ft. Biên",
    genre: "Rap / Indie",
    duration: "3:37",
    thumbnail: "https://i.ytimg.com/vi/KKc_RMln5UY/hqdefault.jpg"
  },
  {
    id: "yt-13",
    videoId: "Jk38OqdAQxc",
    title: "Nàng Thơ (Karaoke Acoustic)",
    artist: "Hoàng Dũng",
    genre: "Ballad",
    duration: "4:14",
    thumbnail: "https://i.ytimg.com/vi/Jk38OqdAQxc/hqdefault.jpg"
  },
  {
    id: "yt-14",
    videoId: "t7tZFq29lis",
    title: "Hơn Cả Yêu (Karaoke Song Ca / Đơn Ca)",
    artist: "Đức Phúc",
    genre: "Ballad",
    duration: "4:52",
    thumbnail: "https://i.ytimg.com/vi/t7tZFq29lis/hqdefault.jpg"
  },
  {
    id: "yt-15",
    videoId: "3fi7uwBU-CE",
    title: "Ngày Mai Người Ta Lấy Chồng (Karaoke Ballad)",
    artist: "Thành Đạt",
    genre: "Ballad",
    duration: "6:02",
    thumbnail: "https://i.ytimg.com/vi/3fi7uwBU-CE/hqdefault.jpg"
  },
  {
    id: "yt-16",
    videoId: "dQw4w9WgXcQ",
    title: "Never Gonna Give You Up (Party Classic)",
    artist: "Rick Astley",
    genre: "US-UK",
    duration: "3:33",
    thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
  },
  {
    id: "yt-17",
    videoId: "09R8_2nJtjg",
    title: "Sugar (Karaoke Pop Party)",
    artist: "Maroon 5",
    genre: "US-UK",
    duration: "5:01",
    thumbnail: "https://i.ytimg.com/vi/09R8_2nJtjg/hqdefault.jpg"
  },
  {
    id: "yt-18",
    videoId: "SlPhMPnQ58k",
    title: "Memories (Karaoke Acoustic Sing-Along)",
    artist: "Maroon 5",
    genre: "US-UK",
    duration: "3:15",
    thumbnail: "https://i.ytimg.com/vi/SlPhMPnQ58k/hqdefault.jpg"
  }
];

module.exports = { DEFAULT_KARAOKE_SONGS };

