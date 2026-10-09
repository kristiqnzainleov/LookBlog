<p align="center">
  <a href="https://lookblog.vercel.app"><img src="docs/logo-banner.png" alt="LookBlog" width="760"></a>
</p>

<p align="center">
  <a href="https://lookblog.vercel.app"><b>🌐 lookblog.vercel.app</b></a>
</p>

# LookBlog

**LookBlog** is a full social network built from scratch by **Kristiqn Zainelov**. It brings together what people usually need several apps for:
- a feed like Twitter or Instagram;
- shorts like TikTok and videos like YouTube;
- live streams like Twitch;
- chats, groups and voice rooms like Discord;
- music like Spotify;
- movies and series like Netflix.

🌐 **Live site:** https://lookblog.vercel.app

The design is pink (`#ff4fa3`) on black. The interface is in English and can be switched to Bulgarian, Spanish, Russian, German, Serbian or Romanian.

> **Накратко на български:** LookBlog е социална мрежа, която съм направил изцяло сам, без фреймуърци и npm пакети. Има постове, шортове, видеа, лайв стриймове, съобщения, групи с voice чат, музика, филми и сериали, игри, значки и класации. Какви технологии са използвани и защо — виж [Технологии (на български)](#технологии-на-български).

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
- **Friends' reactions, like Instagram:** round photos of your mutuals (people you follow who follow you back) sit on the photo or video and show what they did: ❤️ liked, 👎 disliked, 🔁 reposted or 😎 Cool.
  - You can drag them anywhere on the photo; the place is remembered.
  - When a mutual reacts while you're looking at the post, their photo flies up from it.
- **Views:** seeing a post in the feed counts once; opening it (the post, a video played for 2 seconds, a photo opened big) counts every time. Opening the same thing again within 30 seconds doesn't count twice.
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

### Admin page for the LookBlog team (`/admin`)
- **Reports:** reports of posts, accounts, live streams and live chat messages.
  - Grouped by what was reported, the most reported first.
  - The team can dismiss a report, remove the content or suspend the author.
  - Reporters and authors are told by a notification from the LookBlog Team.
- **Verification:** see each request with followers and posts, choose the kind of tick, approve or reject.
- **Support and bugs:** read messages to the team and bug reports with screenshots, and reply. The reply arrives as a notification.
- **Deleted accounts:** why people left.
- **Accounts:**
  - search, verify or remove the tick;
  - suspend or unsuspend (a suspended account can't log in);
  - delete accounts;
  - owners can add and remove admins.
- **Overview:** what's waiting, totals and new accounts per day. Counts update live.

### Profiles and community
- **Profiles:** banner, photo, bio, live follower counts, verified tick and badges. There are over 60 badges, for example Live, Music & film and Games.
- **Customize your profile:** one-tap themes; the name's colour, gradient, font, effect, animation and the line under it; the photo's ring, shape, movement and decoration; the banner's colours and movement; the background; things falling over the profile; a frame; a pointer and its trail; the bio's font and style; how the follower numbers look; how the profile opens; a status and a profile song.
- **Customize your messages:** the bubble's colour, font, shape, text colour, size and effect, a pattern, a border, an effect around it, how it appears, and a sticker on its corner. You can also send a message with an effect (confetti, hearts, secret messages, a time capsule…) and pick the sound others hear when your message arrives.
- **Stories and notes:** stories disappear after 24 hours. Notes can carry a photo or GIF.
- **Search:** people, groups, events and posts, with suggestions as you type, and by voice. Your searches are kept on your account (the same on your phone and computer, only you see them); you can remove one or clear them all.
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

LookBlog uses **no frameworks and no npm packages**: the server, the database layer, the router, the video player, the chat and everything else are written by hand. The only code from outside is loaded by the browser for one job each (the photo checks, YouTube and fonts), listed below.

### Overview

| Part | Technology |
| --- | --- |
| Server | **Node.js 24** (`http` module), its own router and rate limiting |
| Database | Its own in-memory database, kept in **Supabase Postgres** online and in JSON files locally |
| Real-time updates | **Supabase Realtime** online, **Server-Sent Events** locally |
| Live streams, calls, voice rooms | **WebRTC** (peer-to-peer, STUN); the server only passes the connection messages |
| Front end | **Vanilla JavaScript** (ES modules), HTML and CSS; a single-page app with its own router |
| Stream mixing | **Canvas 2D**, `captureStream`, `ImageDecoder` (GIFs), a Web Worker as a clock |
| Sound | **Web Audio API**: synthesised sound effects, the DJ mixer, mixing, a limiter |
| Photo checks | **TensorFlow.js** with **NSFWJS** and **MobileNet**, in the browser |
| Video quality | **ffmpeg** (360p, 480p, 720p and 1080p copies) |
| Other browser APIs | Web Speech API (voice search), MediaRecorder (voice messages, sounds), IntersectionObserver (views), visualViewport (the phone keyboard) |
| Outside services | YouTube IFrame Player API and oEmbed (music in voice rooms), GIPHY (GIFs), Google Fonts |
| Hosting | **Vercel** (the server is one function, static files on Vercel's CDN), files in **Supabase Storage** |

### Why these, and how they work

**Node.js without frameworks.** The whole server is plain Node: one `http` server, and each file in `server/` answers its own part of `/api`. This keeps the project small and fast to start (which matters on Vercel, where the server can start for a request), and every line is understood and under control, with no packages to update or audit. Rate limiting, cookies, uploads and the router are short hand-written functions.

**The database: in memory first, Supabase underneath.** All records live in memory as plain JavaScript objects, so reading is instant and the code stays simple (`db.posts.find(...)`). Online, every record is also one row in a single Supabase Postgres table (`docs`: collection, id, JSON data, a sequence number):
- On start the server loads all rows into memory.
- Before each request it fetches only the rows whose sequence number changed, so several copies of the server stay in sync.
- After a change it writes only the records that really changed.
Locally the same objects are saved to JSON files, so the site runs with just `npm start`. Postgres was chosen because Supabase gives a free, reliable database, file storage and real-time messages in one place.

**Real-time: Supabase Realtime and Server-Sent Events.** New messages, typing, likes, view counts, who's online and the friends' reactions arrive live. Online the server sends each event to a Supabase Realtime channel (one shared channel and one private channel per person) and the browser listens with a small hand-written WebSocket client. Locally the same events go out over Server-Sent Events, a simple one-way stream that needs nothing extra. Private things (messages, notifications) only go to the people they're for.

**WebRTC for streams, calls and voice rooms.** Video and sound go straight between the people's browsers, not through the server, so there's no media server to pay for and the delay is low. The LookBlog server only passes the short connection messages (offers, answers, ICE candidates); public STUN servers help browsers find each other. The streamer's picture (camera, screen, pictures and GIFs on top) is drawn on a canvas and sent as one video with `captureStream`.

**Vanilla JavaScript on the front end.** The app is ES modules loaded straight by the browser: no build step, no bundler. A small `h()` function makes elements, a tiny router swaps pages without reloading, and a tiny event bus (`on`/`emit`) passes live updates around. Pages and heavy parts (the DJ mixer, games, the photo checks) are loaded only when they're opened. Styles are plain CSS with variables for the pink theme.

**Web Audio API.** The sounds (message sounds, effects, the DJ mixer with bass boost and effects) are made and mixed in the browser, so they need no sound files and play instantly.

**TensorFlow.js, NSFWJS and MobileNet for the photo checks.** Before a photo or video is posted, it's checked right in the browser for nudity (NSFWJS) and sensitive things like weapons (MobileNet). Doing it in the browser keeps people's photos private and costs nothing on the server. Marked posts are shown covered and left out of recommendations. The models are loaded only when someone picks a photo, and big photos are made smaller first, so it's quick.

**ffmpeg.** Uploaded videos get 360p–1080p copies so the player can switch quality on slower connections.

**Security.**
- Passwords are hashed with **scrypt** (Node's `crypto`) and compared in constant time.
- Sessions are random tokens in **HttpOnly, Secure** cookies, so page scripts can't read them.
- Every change needs the `X-LookBlog: 1` header, which other sites can't send, so they can't act for you (CSRF protection).
- Uploads are checked by their real contents, not their name.
- Link previews resolve the address first and refuse private networks (no SSRF).
- Security headers (`X-Frame-Options`, a content security policy for frames, `nosniff`, HSTS, Referrer and Permissions policies) are set on every response.
- Every write is rate-limited per person.

**Vercel and Supabase Storage.** Vercel runs the server as one function (`api/index.js`) and serves `public/` from its CDN, close to the visitor. Files are uploaded by the browser straight to Supabase Storage (so big files never pass through the function), then the server checks them.

**Phones.** The layout is responsive CSS. On phones the menu moves to the bottom, sheets slide up and close with a swipe down, and the chat uses `visualViewport` so the screen stays still when the keyboard opens (on iPhone the chat is sized for the keyboard before it appears).

---

## Технологии (на български)

LookBlog е написан **без фреймуърци и без npm пакети**: сървърът, базата данни, рутерът, плейърът, чатът и всичко останало са написани на ръка. Отвън се зареждат само няколко неща в браузъра, всяко за една задача: проверката на снимки, YouTube и шрифтовете.

- **Node.js (сървърът).** Един `http` сървър; всеки файл в `server/` отговаря за своята част от `/api`. **Защо:** малко, бързо стартира (важно за Vercel) и всеки ред е под контрол, без пакети за обновяване.
- **Базата данни в паметта, а под нея Supabase Postgres.** Всички записи са обекти в паметта, затова четенето е мигновено. Онлайн всеки запис е и ред в една таблица в Supabase. При всяка заявка сървърът тегли само променените редове, а след промяна записва само това, което наистина е променено. Локално се пазят в JSON файлове. **Защо:** простота и скорост, а Supabase дава безплатно база данни, файлове и съобщения в реално време на едно място.
- **Supabase Realtime и Server-Sent Events.** Нови съобщения, „пише…“, лайкове, гледания и кой е онлайн идват на живо. Онлайн е през канали в Supabase Realtime, локално през Server-Sent Events. Личните неща отиват само до човека, за когото са.
- **WebRTC.** Стриймовете, обажданията и voice стаите вървят директно между браузърите, не през сървъра. **Защо:** без скъп медиа сървър и с малко закъснение. Сървърът само предава кратките съобщения за свързване.
- **Чист JavaScript (ES модули), HTML и CSS.** Без build стъпка. Малък рутер сменя страниците без презареждане; тежките части (DJ миксерът, игрите, проверката на снимки) се зареждат чак когато се отворят.
- **Web Audio API.** Звуците, ефектите и DJ миксерът се правят и смесват в браузъра, без звукови файлове.
- **TensorFlow.js, NSFWJS и MobileNet.** Снимките и видеата се проверяват за голота и опасни неща (например оръжия) още в браузъра, преди да се публикуват. **Защо:** снимките остават лични, а на сървъра не струва нищо.
- **ffmpeg.** Прави копия на видеата в 360p–1080p, за да може плейърът да сменя качеството.
- **Сигурност.** Паролите са хеширани със scrypt. Сесиите са в HttpOnly и Secure бисквитки. Всяка промяна иска хедъра `X-LookBlog: 1` (защита от CSRF). Качените файлове се проверяват по съдържание. Прегледите на линкове не стигат до вътрешни мрежи (защита от SSRF). Има защитни хедъри и ограничение на броя заявки.
- **Vercel и Supabase Storage.** Vercel пуска сървъра като една функция и дава файловете от `public/` от своя CDN. Браузърът качва файловете директно в Supabase Storage, а сървърът ги проверява след това.

---

## Running it locally

You need Node.js 24. ffmpeg is optional and only used for video qualities.

```bash
npm start
```

Then open http://localhost:3000. The `data/` folder is created on first start.

### Environment variables

| Name | What it does |
| --- | --- |
| `PORT` | Port to listen on (default `3000`) |
| `LOOKBLOG_DATA` | Where the data and uploads are kept (default `./data`) |
| `SUPABASE_URL` | Turns on online mode: the Supabase project's address |
| `SUPABASE_SERVICE_KEY` | The project's service key (server only, never sent to browsers) |
| `SUPABASE_PUBLIC_KEY` | The public key browsers use to listen for live updates |
| `VERIFIED_USERNAMES` | Usernames that always get the tick, comma-separated (default `ko6i`) |
| `TRUST_PROXY` | Set to `1` behind a hosting proxy so each visitor's real IP is used |
| `ADMINS` | Usernames of the owners of the admin page, comma-separated (default `ko6i`) |
| `FFMPEG_PATH` | Path to ffmpeg, if it isn't found automatically |

### Deploying

LookBlog runs on **Vercel** with **Supabase**:
1. In Supabase, run the migration in `supabase/migrations`. It creates the `docs` table.
2. Create a public storage bucket called `media`.
3. In Vercel, set the `SUPABASE_*` variables.
4. Run `vercel deploy --prod`.

`vercel.json` sends pages and `/api` to the function in `api/index.js` and serves `public/` directly.

Online, the browser uploads files straight to Supabase Storage. The server checks the file afterwards, and `/media/...` links redirect there.

Without the `SUPABASE_*` variables, `npm start` uses JSON files in `data/` instead. A `Dockerfile` for a classic server is included too.

---

## Project structure

```
server.js            starts the server and decides which page to show
server/              the API
  auth.js            accounts, sessions, password reset
  social.js          posts, shorts, videos, comments, reactions, follows, search
  streams.js         live streams, guests, moderators, live chat
  admin.js           the admin page: reports, verification, support, accounts
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
  realtime.js        live updates (Supabase Realtime or Server-Sent Events) and who is online
  db.js              the in-memory database (JSON files locally)
  store.js           keeps the database in Supabase: loads it, syncs changes, writes what changed
  ticker.js          repeating jobs (run at request time online)
api/index.js         the Vercel function
supabase/            the database table
public/              everything the browser loads
  index.html         landing page (log in / sign up)
  app.html, app.css  the app
  js/pages/          one file per page (feed, watch, live, messages, …)
  js/components/     player, comments, chat, voice room, card games, …
old-versions/        earlier designs of the home, landing, login and ticket pages
```

## Limits

- Photos can be up to 15 MB (JPG, PNG, GIF, WebP).
- Videos can be up to 500 MB locally (MP4, MOV, WebM). Online every file can be up to 50 MB, the limit of Supabase's free plan.
- Shorts can be up to 90 seconds.
- Posts can be up to 1000 characters.

---

Made by **Kristiqn Zainelov**.
