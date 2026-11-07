// Kho bài hát YouTube Karaoke chọn lọc theo thể loại (100% Bản Beat Karaoke Không Lời Ca Sĩ)
// Ngoài danh sách gợi ý sẵn này, người dùng có thể tìm kiếm trực tiếp mọi bài hát Karaoke trên YouTube hoặc dán link YouTube bất kỳ.

const DEFAULT_KARAOKE_SONGS = [
  {
    id: "yt-1",
    videoId: "_ih5L6S7Ejk",
    title: "Bohemian Rhapsody (Karaoke Beat Chuẩn)",
    artist: "Queen",
    genre: "US-UK",
    duration: "5:56",
    thumbnail: "https://i.ytimg.com/vi/_ih5L6S7Ejk/hqdefault.jpg"
  },
  {
    id: "yt-2",
    videoId: "yzYCGeA3Dcg",
    title: "Perfect (Karaoke Acoustic Beat)",
    artist: "Ed Sheeran",
    genre: "US-UK",
    duration: "4:25",
    thumbnail: "https://i.ytimg.com/vi/yzYCGeA3Dcg/hqdefault.jpg"
  },
  {
    id: "yt-3",
    videoId: "QThJlC1W5hQ",
    title: "Despacito (Karaoke Instrumental Beat)",
    artist: "Luis Fonsi ft. Daddy Yankee",
    genre: "Remix / Party",
    duration: "3:51",
    thumbnail: "https://i.ytimg.com/vi/QThJlC1W5hQ/hqdefault.jpg"
  },
  {
    id: "yt-4",
    videoId: "JB39GfVEzFA",
    title: "Chúng Ta Của Hiện Tại (Official Karaoke Beat)",
    artist: "Sơn Tùng M-TP",
    genre: "Nhạc Trẻ",
    duration: "5:02",
    thumbnail: "https://i.ytimg.com/vi/JB39GfVEzFA/hqdefault.jpg"
  },
  {
    id: "yt-5",
    videoId: "4QnFflIMkpc",
    title: "Hãy Trao Cho Anh (Karaoke Beat Chuẩn)",
    artist: "Sơn Tùng M-TP",
    genre: "Remix / Party",
    duration: "4:12",
    thumbnail: "https://i.ytimg.com/vi/4QnFflIMkpc/hqdefault.jpg"
  },
  {
    id: "yt-6",
    videoId: "t4rjaYhmazo",
    title: "Nơi Này Có Anh (Karaoke Beat Gốc)",
    artist: "Sơn Tùng M-TP",
    genre: "Nhạc Trẻ",
    duration: "4:22",
    thumbnail: "https://i.ytimg.com/vi/t4rjaYhmazo/hqdefault.jpg"
  },
  {
    id: "yt-7",
    videoId: "iIsfYYw4b2A",
    title: "Cắt Đôi Nỗi Sầu (Official Karaoke Beat Chuẩn)",
    artist: "Tăng Duy Tân",
    genre: "Remix / Party",
    duration: "3:15",
    thumbnail: "https://i.ytimg.com/vi/iIsfYYw4b2A/hqdefault.jpg"
  },
  {
    id: "yt-8",
    videoId: "2MUfA2g87vo",
    title: "Bên Trên Tầng Lầu (Official Karaoke Beat)",
    artist: "Tăng Duy Tân",
    genre: "Remix / Party",
    duration: "3:06",
    thumbnail: "https://i.ytimg.com/vi/2MUfA2g87vo/hqdefault.jpg"
  },
  {
    id: "yt-9",
    videoId: "3pFUNPGv1h0",
    title: "Waiting For You (Karaoke Beat Chuẩn)",
    artist: "MONO",
    genre: "Nhạc Trẻ",
    duration: "4:21",
    thumbnail: "https://i.ytimg.com/vi/3pFUNPGv1h0/hqdefault.jpg"
  },
  {
    id: "yt-10",
    videoId: "z6HE1dr4S84",
    title: "See Tình (Karaoke Cukak Remix Beat)",
    artist: "Hoàng Thùy Linh",
    genre: "Remix / Party",
    duration: "3:05",
    thumbnail: "https://i.ytimg.com/vi/z6HE1dr4S84/hqdefault.jpg"
  },
  {
    id: "yt-11",
    videoId: "X04HB4u6dys",
    title: "Mang Tiền Về Cho Mẹ (Karaoke Beat Chuẩn)",
    artist: "Đen Vâu ft. Nguyên Thảo",
    genre: "Rap / Indie",
    duration: "6:45",
    thumbnail: "https://i.ytimg.com/vi/X04HB4u6dys/hqdefault.jpg"
  },
  {
    id: "yt-12",
    videoId: "EqamqamwiVA",
    title: "Hai Triệu Năm (Karaoke Beat Chuẩn)",
    artist: "Đen Vâu ft. Biên",
    genre: "Rap / Indie",
    duration: "3:38",
    thumbnail: "https://i.ytimg.com/vi/EqamqamwiVA/hqdefault.jpg"
  },
  {
    id: "yt-13",
    videoId: "Tqv0x1_QJlo",
    title: "Nàng Thơ (Karaoke Beat Gốc)",
    artist: "Hoàng Dũng",
    genre: "Ballad",
    duration: "4:15",
    thumbnail: "https://i.ytimg.com/vi/Tqv0x1_QJlo/hqdefault.jpg"
  },
  {
    id: "yt-14",
    videoId: "WdCsWw1Szz8",
    title: "Hơn Cả Yêu (Official Karaoke Beat)",
    artist: "Đức Phúc",
    genre: "Ballad",
    duration: "4:15",
    thumbnail: "https://i.ytimg.com/vi/WdCsWw1Szz8/hqdefault.jpg"
  },
  {
    id: "yt-15",
    videoId: "Vv2mtx5ZWwE",
    title: "Ngày Mai Người Ta Lấy Chồng (Karaoke Beat Chuẩn)",
    artist: "Thành Đạt",
    genre: "Ballad",
    duration: "6:02",
    thumbnail: "https://i.ytimg.com/vi/Vv2mtx5ZWwE/hqdefault.jpg"
  },
  {
    id: "yt-16",
    videoId: "uwMFPoWm0qk",
    title: "Never Gonna Give You Up (Instrumental Karaoke Beat)",
    artist: "Rick Astley",
    genre: "US-UK",
    duration: "3:33",
    thumbnail: "https://i.ytimg.com/vi/uwMFPoWm0qk/hqdefault.jpg"
  },
  {
    id: "yt-17",
    videoId: "CpZBAXvuucM",
    title: "Sugar (Karaoke Instrumental Beat)",
    artist: "Maroon 5",
    genre: "US-UK",
    duration: "4:04",
    thumbnail: "https://i.ytimg.com/vi/CpZBAXvuucM/hqdefault.jpg"
  },
  {
    id: "yt-18",
    videoId: "2mwg-7yI6N0",
    title: "Memories (Karaoke Instrumental Beat)",
    artist: "Maroon 5",
    genre: "US-UK",
    duration: "3:09",
    thumbnail: "https://i.ytimg.com/vi/2mwg-7yI6N0/hqdefault.jpg"
  }
];

module.exports = { DEFAULT_KARAOKE_SONGS };
