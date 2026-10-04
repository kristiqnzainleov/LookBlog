# LookBlog

**LookBlog** is a full social network built from scratch by **Kristiqn Zainelov**. It brings together what people usually need several apps for:
- a feed like Twitter or Instagram;
- shorts like TikTok and videos like YouTube;
- live streams like Twitch;
- chats, groups and voice rooms like Discord;
- music like Spotify;
- movies and series like Netflix.

🌐 **Live site:** https://lookblog-production.up.railway.app

The design is pink (`#ff4fa3`) on black. The interface is in English and can be switched to Bulgarian, Spanish, Russian, German, Serbian or Romanian.

> **Накратко на български:** LookBlog е социална мрежа, която съм направил изцяло сам, без външни библиотеки. Има постове, шортове, видеа, лайв стриймове, съобщения, групи с voice чат, музика, филми и сериали, игри, значки и класации.

---

## What the site can do

### Posts, shorts and videos
- **Posts:** text, up to 4 photos or one video. You can also add polls, @mentions and #tags.
- **Reacting:**
  - Cool, like and dislike;
  - reposts and quotes;
  - replies with photos or videos;
  - view and share counts.
- **Shorts:** vertical videos, one per screen, with a pink seek bar.
  - Double-tap left or right to skip, shown as pink pulses.
  - Viewers can react at exact moments.
- **Videos:** each one has its own watch page with an *Up next* list and playlists.
- **Player:** quality switching (360p–1080p made with ffmpeg) and subtitles.
- **Timed comments, like SoundCloud:** a comment is pinned to a moment in the video.
  - Viewers can also send live reactions at minutes.
  - Only works when the creator turns it on.
- **Video replies:** you can answer a video with your own video.
- **Comments:**
  - the creator can heart one, which shows *Liked by creator* like on YouTube;
  - the creator can turn replies off.
- **Upcoming videos and premieres:** a scheduled release with a "Remind me" button.
- **Editor:** trim and cut videos. Add subtitles, and timed lyrics for songs.
- **"For you" recommendations** score each item by four things:
  - authors you engage with;
  - topics;
  - what similar people liked;
  - quality, meaning likes per view and watch time.

### Live streaming (WebRTC)
- **What you can stream:** your camera, your screen, or both at once. The camera sits picture-in-picture and you can move and resize it.
- **Before going live:**
  - set a thumbnail, a description and a schedule ("Upcoming lives");
  - place pictures and GIFs on the stream.
- **Chat on the stream:** the chat can be drawn on the video like on YouTube. Viewers get a Top chat mode, emoji, stickers and personal sounds.
- **During the live, viewers can:**
  - send reactions in real time;
  - send pictures, videos and sounds;
  - like, dislike, share and report the live.
- **Collaboration like Instagram:** up to 4 people split the screen.
  - Each person controls only their own tile: what they show, their camera and their own chat overlay.
- **Moderators:** added by typing @name.
- **Stream settings:** chat, reactions, viewer alerts, and who can join.
- **After the stream:** live stats in Analytics, and the recording stays as a "Past live" that people can comment on.

### Messages, groups and voice
- **Direct messages and group chats:**
  - typing indicators and "Seen by";
  - @mentions and @everyone;
  - translation;
  - a gallery of photos, videos and links;
  - search by date;
  - group streaks.
- **Groups work like Discord servers:**
  - text and voice channels;
  - roles with permissions, and members grouped by role;
  - nicknames and events.
- **Voice and video rooms:**
  - a large grid of cameras;
  - screen sharing;
  - built-in and personal sound effects;
  - stickers.
- **Shared music in voice:**
  - play LookBlog songs or YouTube links;
  - everyone hears the same thing and can control the music and the volume.
- **Games inside chats and calls:**
  - chess, tic-tac-toe and connect four;
  - card games with bots: poker, blackjack, santase, UNO and belot.
- **Calls:** one-to-one voice and video calls.

### Music, movies and series
- **Music, like Spotify:** artists upload songs and albums with cover art. There are likes, popular tracks and a mini player.
- **Cinema, like Netflix:** movies and series with seasons. You can upload episodes straight into a chosen season.
- **Ratings:** movies and series get 1–5 stars with averages, plus reviews.
  - They have no likes or dislikes.
  - They can't be added to normal playlists.

### Profiles and community
- **Profiles:** banner, photo, bio, live follower counts, verified tick and badges. There are over 60 badges, for example Live, Music & film and Games.
- **Stories and notes:** stories disappear after 24 hours. Notes can carry a photo or GIF.
- **Find people:** search by name or @username, with suggestions.
- **Public events:** with their own discussion.
- **Leaderboards:**
  - creators;
  - streams by viewers and likes;
  - series and films.
- **Analytics for creators:** views, watch time, followers and live streams.
- **Notifications:** live, in real time.
- **Accounts:**
  - several accounts on one device;
  - privacy settings;
  - reporting and verification requests;
  - account deletion.

---

## Technologies

LookBlog has **no external dependencies**: no frameworks and no npm packages. Everything is written by hand.

| Part | Technology |
| --- | --- |
| Server | **Node.js** (`http` module), its own router, its own rate limiting |
| Database | Its own **JSON-file database** (`data/*.json`), batched atomic writes |
| Real-time updates | **Server-Sent Events (SSE)** |
| Live streams, calls, voice rooms | **WebRTC** (peer-to-peer, STUN). The server is used only for signalling |
| Stream mixing | **Canvas 2D**, `captureStream`, `ImageDecoder` (GIFs), Web Workers as a clock |
| Sound | **Web Audio API** (synthesised sound effects, mixing, limiter) |
| Video quality | **ffmpeg** (360p, 480p, 720p, 1080p copies) |
| Front end | **Vanilla JavaScript** (ES modules), HTML and CSS, a single-page app with its own router |
| YouTube music | YouTube IFrame Player API, oEmbed |
| Security | scrypt password hashes, HttpOnly session cookies, a CSRF header (`X-LookBlog: 1`), uploads checked by their contents |
| Hosting | **Docker** on **Railway**, with a persistent volume for the data |

---

## Running it locally

You need Node.js 20 or newer. ffmpeg is optional and only used for video qualities.

```bash
npm start
```

Then open http://localhost:3000. The `data/` folder is created on first start.

### Environment variables

| Name | What it does |
| --- | --- |
| `PORT` | Port to listen on (default `3000`) |
| `LOOKBLOG_DATA` | Where the data and uploads are kept (default `./data`) |
| `TRUST_PROXY` | Set to `1` behind a hosting proxy so each visitor's real IP is used |
| `GOOGLE_CLIENT_ID` | Turns on "Sign in with Google" |
| `FFMPEG_PATH` | Path to ffmpeg, if it isn't found automatically |

### Deploying

The `Dockerfile` builds an image with Node and ffmpeg. On Railway:
1. Run `railway up`.
2. Add a volume mounted at `/data`.

The database and uploads are never part of the image.

---

## Project structure

```
server.js            starts the server and decides which page to show
server/              the API
  auth.js            accounts, sessions, password reset, Google sign-in
  social.js          posts, shorts, videos, comments, reactions, follows, search
  streams.js         live streams, guests, moderators, live chat
  chat.js            messages, groups, typing, read receipts, card games
  voice.js           voice rooms and shared music
  groups.js          Discord-style servers, roles, channels
  playlists.js       playlists, series, reviews
  music.js           songs and albums
  media.js           uploads (checked by content, seekable video)
  transcode.js       ffmpeg video qualities
  recommend.js       "For you" recommendations
  badges.js          badges and roles
  leaderboard.js     leaderboards
  realtime.js        Server-Sent Events
  db.js              JSON-file database
public/              everything the browser loads
  index.html         landing page (log in / sign up)
  app.html, app.css  the app
  js/pages/          one file per page (feed, watch, live, messages, …)
  js/components/     player, comments, chat, voice room, card games, …
old-versions/        earlier designs of the home, landing, login and ticket pages
```

## Limits

- Photos can be up to 15 MB (JPG, PNG, GIF, WebP).
- Videos can be up to 500 MB (MP4, MOV, WebM).
- Shorts can be up to 90 seconds.
- Posts can be up to 1000 characters.

---

Made by **Kristiqn Zainelov**.
