// Badges (earned once) and awards (bronze, silver, gold) shown on profiles.
const { db, save } = require("./db");
const { streakOf } = require("./chat");
const { notify } = require("./notifications");

const BADGES = [
  { id: "verified", cat: "Getting started", emoji: "tick", name: "Verified", how: "Get the verification tick.", test: (s) => s.verified },
  { id: "early", cat: "Getting started", emoji: "🌱", name: "Early member", how: "One of the first 100 people on LookBlog.", test: (s) => s.joinRank <= 100 },
  { id: "first-post", cat: "Getting started", emoji: "✏️", name: "First post", how: "Share your first post.", test: (s) => s.posts >= 1, progress: (s) => [s.posts, 1] },
  { id: "first-video", cat: "Creators", emoji: "🎬", name: "Director", how: "Upload your first video.", test: (s) => s.videos >= 1, progress: (s) => [s.videos, 1] },
  { id: "first-short", cat: "Creators", emoji: "📱", name: "Short maker", how: "Post your first short.", test: (s) => s.shorts >= 1, progress: (s) => [s.shorts, 1] },
  { id: "poll", cat: "Creators", emoji: "📊", name: "Curious mind", how: "Ask something with a poll.", test: (s) => s.polls >= 1, progress: (s) => [s.polls, 1] },
  { id: "sticker", cat: "Creators", emoji: "🎨", name: "Sticker artist", how: "Make a sticker.", test: (s) => s.stickers >= 1, progress: (s) => [s.stickers, 1] },
  { id: "social", cat: "Community", emoji: "🤝", name: "Social butterfly", how: "Follow 10 people.", test: (s) => s.following >= 10, progress: (s) => [s.following, 10] },
  { id: "chatty", cat: "Community", emoji: "💬", name: "Chatterbox", how: "Send 100 messages.", test: (s) => s.messages >= 100, progress: (s) => [s.messages, 100] },
  { id: "streak7", cat: "Streaks", emoji: "🔥", name: "On fire", how: "Keep a 7-day LookStreak.", test: (s) => s.bestStreak >= 7, progress: (s) => [s.bestStreak, 7] },
  { id: "streak30", cat: "Streaks", emoji: "☄️", name: "Unstoppable", how: "Keep a 30-day LookStreak.", test: (s) => s.bestStreak >= 30, progress: (s) => [s.bestStreak, 30] },
  { id: "viral", cat: "Reach", emoji: "🚀", name: "Gone viral", how: "Get 100 views on a single post.", test: (s) => s.topViews >= 100, progress: (s) => [s.topViews, 100] },
  // Creators
  { id: "storyteller", cat: "Creators", emoji: "📖", name: "Storyteller", how: "Post 5 stories.", test: (s) => s.stories >= 5, progress: (s) => [s.stories, 5] },
  { id: "curator", cat: "Creators", emoji: "🗂️", name: "Curator", how: "Make a playlist.", test: (s) => s.playlists >= 1, progress: (s) => [s.playlists, 1] },
  { id: "prolific", cat: "Creators", emoji: "🏭", name: "Prolific", how: "Share 50 posts, shorts or videos.", test: (s) => s.creator >= 50, progress: (s) => [s.creator, 50] },
  { id: "filmography", cat: "Creators", emoji: "🎞️", name: "Filmography", how: "Upload 10 videos.", test: (s) => s.videos >= 10, progress: (s) => [s.videos, 10] },
  { id: "shortking", cat: "Creators", emoji: "⚡", name: "Short king", how: "Post 25 shorts.", test: (s) => s.shorts >= 25, progress: (s) => [s.shorts, 25] },
  { id: "nightowl", cat: "Creators", emoji: "🦉", name: "Night owl", how: "Post something between midnight and 5 AM.", test: (s) => s.nightPosts >= 1 },
  // Community
  { id: "commenter", cat: "Community", emoji: "🗨️", name: "Conversation starter", how: "Write 25 replies.", test: (s) => s.commentsWritten >= 25, progress: (s) => [s.commentsWritten, 25] },
  { id: "voice", cat: "Community", emoji: "🎙️", name: "Voice of LookBlog", how: "Send 10 voice messages.", test: (s) => s.voiceSent >= 10, progress: (s) => [s.voiceSent, 10] },
  { id: "host", cat: "Community", emoji: "🏠", name: "Host", how: "Start a group.", test: (s) => s.groupsOwned >= 1, progress: (s) => [s.groupsOwned, 1] },
  { id: "caller", cat: "Community", emoji: "📞", name: "On the line", how: "Have a voice or video call.", test: (s) => s.calls >= 1, progress: (s) => [s.calls, 1] },
  { id: "supporter", cat: "Community", emoji: "😎", name: "Supporter", how: "Give 50 Cools to other people.", test: (s) => s.coolsGiven >= 50, progress: (s) => [s.coolsGiven, 50] },
  { id: "gif", cat: "Community", emoji: "🎞", name: "GIF master", how: "Add 5 GIFs to your collection.", test: (s) => s.gifs >= 5, progress: (s) => [s.gifs, 5] },
  // Streaks
  { id: "streak100", cat: "Streaks", emoji: "💯", name: "Legend", how: "Keep a 100-day LookStreak.", test: (s) => s.bestStreak >= 100, progress: (s) => [s.bestStreak, 100] },
  { id: "loyal", cat: "Streaks", emoji: "🗓️", name: "Loyal", how: "Be on LookBlog for a year.", test: (s) => s.daysOnSite >= 365, progress: (s) => [s.daysOnSite, 365] },
  // Reach
  { id: "rising", cat: "Reach", emoji: "📈", name: "Rising star", how: "Reach 100 followers.", test: (s) => s.followers >= 100, progress: (s) => [s.followers, 100] },
  { id: "famous", cat: "Reach", emoji: "🌟", name: "Famous", how: "Reach 1,000 followers.", test: (s) => s.followers >= 1000, progress: (s) => [s.followers, 1000] },
  { id: "loved", cat: "Reach", emoji: "💖", name: "Loved", how: "Get 500 likes in total.", test: (s) => s.likesReceived >= 500, progress: (s) => [s.likesReceived, 500] },
  { id: "megaviral", cat: "Reach", emoji: "🌋", name: "Mega viral", how: "Get 10,000 views on a single post.", test: (s) => s.topViews >= 10000, progress: (s) => [s.topViews, 10000] },
  // More creators
  { id: "snapshot", cat: "Creators", emoji: "📸", name: "Snapshot", how: "Share 10 photos.", test: (s) => s.photos >= 10, progress: (s) => [s.photos, 10] },
  { id: "gallery", cat: "Creators", emoji: "🖼️", name: "Gallery", how: "Share 100 photos.", test: (s) => s.photos >= 100, progress: (s) => [s.photos, 100] },
  { id: "pollster", cat: "Creators", emoji: "🗳️", name: "Pollster", how: "Ask 10 polls.", test: (s) => s.polls >= 10, progress: (s) => [s.polls, 10] },
  { id: "storyaddict", cat: "Creators", emoji: "🎠", name: "Story addict", how: "Post 50 stories.", test: (s) => s.stories >= 50, progress: (s) => [s.stories, 50] },
  { id: "centurion", cat: "Creators", emoji: "🏛️", name: "Centurion", how: "Share 100 posts.", test: (s) => s.posts >= 100, progress: (s) => [s.posts, 100] },
  // More community
  { id: "commentator", cat: "Community", emoji: "📣", name: "Commentator", how: "Write 100 replies.", test: (s) => s.commentsWritten >= 100, progress: (s) => [s.commentsWritten, 100] },
  { id: "reactor", cat: "Community", emoji: "😍", name: "Reactor", how: "React to 50 replies.", test: (s) => s.reactionsGiven >= 50, progress: (s) => [s.reactionsGiven, 50] },
  { id: "toprely", cat: "Community", emoji: "🏆", name: "Top reply", how: "Get 10 reactions on one reply.", test: (s) => s.topReplyReactions >= 10, progress: (s) => [s.topReplyReactions, 10] },
  { id: "gifsender", cat: "Community", emoji: "🎉", name: "GIF lord", how: "Send 25 GIFs in replies or chats.", test: (s) => s.gifsSent >= 25, progress: (s) => [s.gifsSent, 25] },
  { id: "stickerfan", cat: "Community", emoji: "🧸", name: "Sticker fan", how: "Send 20 stickers.", test: (s) => s.stickersSent >= 20, progress: (s) => [s.stickersSent, 20] },
  { id: "videoreply", cat: "Community", emoji: "📹", name: "Face to face", how: "Answer 5 posts with a video.", test: (s) => s.videoReplies >= 5, progress: (s) => [s.videoReplies, 5] },
  { id: "groupie", cat: "Community", emoji: "👯", name: "Groupie", how: "Join 5 groups.", test: (s) => s.groups >= 5, progress: (s) => [s.groups, 5] },
  { id: "crowd", cat: "Community", emoji: "🏟️", name: "Crowd puller", how: "Have 20 people in a group you started.", test: (s) => s.biggestGroup >= 20, progress: (s) => [s.biggestGroup, 20] },
  { id: "phonefriend", cat: "Community", emoji: "☎️", name: "Phone friend", how: "Have 25 calls.", test: (s) => s.calls >= 25, progress: (s) => [s.calls, 25] },
  { id: "explorer", cat: "Community", emoji: "🧭", name: "Explorer", how: "Follow 50 people.", test: (s) => s.following >= 50, progress: (s) => [s.following, 50] },
  { id: "chatlegend", cat: "Community", emoji: "📨", name: "Chat legend", how: "Send 1,000 messages.", test: (s) => s.messages >= 1000, progress: (s) => [s.messages, 1000] },
  // More streaks
  { id: "streak3", cat: "Streaks", emoji: "✨", name: "Spark", how: "Keep a 3-day LookStreak.", test: (s) => s.bestStreak >= 3, progress: (s) => [s.bestStreak, 3] },
  { id: "streak365", cat: "Streaks", emoji: "♾️", name: "Eternal flame", how: "Keep a 365-day LookStreak.", test: (s) => s.bestStreak >= 365, progress: (s) => [s.bestStreak, 365] },
  { id: "veteran", cat: "Streaks", emoji: "🎖️", name: "Veteran", how: "Be on LookBlog for two years.", test: (s) => s.daysOnSite >= 730, progress: (s) => [s.daysOnSite, 730] },
  // More reach
  { id: "firstfans", cat: "Reach", emoji: "🙌", name: "First fans", how: "Reach 10 followers.", test: (s) => s.followers >= 10, progress: (s) => [s.followers, 10] },
  { id: "icon", cat: "Reach", emoji: "👑", name: "Icon", how: "Reach 10,000 followers.", test: (s) => s.followers >= 10000, progress: (s) => [s.followers, 10000] },
  { id: "liked", cat: "Reach", emoji: "👍", name: "Liked", how: "Get 50 likes in total.", test: (s) => s.likesReceived >= 50, progress: (s) => [s.likesReceived, 50] },
  { id: "blockbuster", cat: "Reach", emoji: "🍿", name: "Blockbuster", how: "Get 100,000 views in total.", test: (s) => s.views >= 100000, progress: (s) => [s.views, 100000] },
  // Just for fun
  { id: "earlybird", cat: "Just for fun", emoji: "🐦", name: "Early bird", how: "Post something between 5 and 8 AM.", test: (s) => s.morningPosts >= 1 },
  { id: "weekend", cat: "Just for fun", emoji: "🏖️", name: "Weekend warrior", how: "Post 10 times on weekends.", test: (s) => s.weekendPosts >= 10, progress: (s) => [s.weekendPosts, 10] },
  { id: "nighttalk", cat: "Just for fun", emoji: "🌙", name: "Midnight talker", how: "Send a message between midnight and 5 AM.", test: (s) => s.nightMessages >= 1 },
  { id: "polymath", cat: "Just for fun", emoji: "🧠", name: "Polymath", how: "Pick 3 roles on your profile.", test: (s) => s.roles >= 3, progress: (s) => [s.roles, 3] },
  { id: "dressed", cat: "Just for fun", emoji: "🪞", name: "All dressed up", how: "Add a profile photo, a banner and a bio.", test: (s) => s.profileDone >= 3, progress: (s) => [s.profileDone, 3] },
  { id: "collector", cat: "Just for fun", emoji: "🧺", name: "Collector", how: "Keep 25 stickers.", test: (s) => s.stickers >= 25, progress: (s) => [s.stickers, 25] },
  // Live
  { id: "onair", cat: "Live", emoji: "🔴", name: "On air", how: "Go live for the first time.", test: (s) => s.streams >= 1, progress: (s) => [s.streams, 1] },
  { id: "broadcaster", cat: "Live", emoji: "📡", name: "Broadcaster", how: "Go live 10 times.", test: (s) => s.streams >= 10, progress: (s) => [s.streams, 10] },
  { id: "fullhouse", cat: "Live", emoji: "🎪", name: "Full house", how: "Have 10 people watching your live at once.", test: (s) => s.streamPeak >= 10, progress: (s) => [s.streamPeak, 10] },
  { id: "audience", cat: "Live", emoji: "👀", name: "Audience", how: "Get 100 different viewers on your lives.", test: (s) => s.streamViewers >= 100, progress: (s) => [s.streamViewers, 100] },
  { id: "crowdfav", cat: "Live", emoji: "💗", name: "Crowd favourite", how: "Get 50 likes on your lives.", test: (s) => s.streamLikes >= 50, progress: (s) => [s.streamLikes, 50] },
  { id: "guest", cat: "Live", emoji: "🙋", name: "Special guest", how: "Join someone’s live as a guest.", test: (s) => s.guestLives >= 1, progress: (s) => [s.guestLives, 1] },
  { id: "together", cat: "Live", emoji: "🤝", name: "Better together", how: "Go live with a guest on screen.", test: (s) => s.collabLives >= 1, progress: (s) => [s.collabLives, 1] },
  { id: "savedate", cat: "Live", emoji: "📅", name: "Save the date", how: "Schedule a live.", test: (s) => s.scheduled >= 1, progress: (s) => [s.scheduled, 1] },
  { id: "livechatter", cat: "Live", emoji: "💬", name: "Live chatter", how: "Send 50 messages in live chats.", test: (s) => s.liveChat >= 50, progress: (s) => [s.liveChat, 50] },
  { id: "premiere", cat: "Live", emoji: "🎟️", name: "Premiere night", how: "Schedule a video as an upcoming premiere.", test: (s) => s.premieres >= 1, progress: (s) => [s.premieres, 1] },
  // Music & film
  { id: "firsttrack", cat: "Music & film", emoji: "🎤", name: "First track", how: "Release your first song.", test: (s) => s.songs >= 1, progress: (s) => [s.songs, 1] },
  { id: "onrepeat", cat: "Music & film", emoji: "🎧", name: "On repeat", how: "Get 1,000 plays on your songs.", test: (s) => s.songPlays >= 1000, progress: (s) => [s.songPlays, 1000] },
  { id: "albumdrop", cat: "Music & film", emoji: "💿", name: "Album drop", how: "Release an album or EP.", test: (s) => s.albums >= 1, progress: (s) => [s.albums, 1] },
  { id: "feature", cat: "Music & film", emoji: "🎥", name: "Feature film", how: "Upload a movie.", test: (s) => s.movies >= 1, progress: (s) => [s.movies, 1] },
  { id: "showrunner", cat: "Music & film", emoji: "📺", name: "Showrunner", how: "Start a series.", test: (s) => s.series >= 1, progress: (s) => [s.series, 1] },
  { id: "dj", cat: "Music & film", emoji: "🎛️", name: "Voice DJ", how: "Play 10 songs in voice channels.", test: (s) => s.voiceDJ >= 10, progress: (s) => [s.voiceDJ, 10] },
  // Games
  { id: "firstwin", cat: "Games", emoji: "🏅", name: "First win", how: "Win a game in a chat.", test: (s) => s.gameWins >= 1, progress: (s) => [s.gameWins, 1] },
  { id: "cardshark", cat: "Games", emoji: "🃏", name: "Card shark", how: "Win 10 card games.", test: (s) => s.cardWins >= 10, progress: (s) => [s.cardWins, 10] },
  { id: "tableregular", cat: "Games", emoji: "🎲", name: "Table regular", how: "Finish 25 games.", test: (s) => s.gamesFinished >= 25, progress: (s) => [s.gamesFinished, 25] },
  // Fun
  { id: "soundmaker", cat: "Just for fun", emoji: "🔊", name: "Sound maker", how: "Add one of your own sounds.", test: (s) => s.mySounds >= 1, progress: (s) => [s.mySounds, 1] },
  { id: "picnote", cat: "Just for fun", emoji: "🖼️", name: "Picture note", how: "Share a note with a photo or GIF.", test: (s) => s.noteMedia >= 1, progress: (s) => [s.noteMedia, 1] },
  { id: "sharedaround", cat: "Reach", emoji: "📤", name: "Shared around", how: "Get your posts shared 25 times.", test: (s) => s.sharesReceived >= 25, progress: (s) => [s.sharesReceived, 25] }
];

const TIERS = [["bronze", "🥉"], ["silver", "🥈"], ["gold", "🥇"]];
const AWARDS = [
  { id: "views", name: "Watched", unit: "views", steps: [100, 1000, 10000] },
  { id: "followers", name: "Followed", unit: "followers", steps: [10, 100, 1000] },
  { id: "cools", name: "So cool", unit: "Cools received", steps: [10, 100, 1000] },
  { id: "creator", name: "Creator", unit: "posts, shorts and videos", steps: [10, 50, 200] },
];

function statsFor(user) {
  const mine = db.posts.filter((p) => p.userId === user.id);
  const visible = mine.filter((p) => p.visibility !== "private");
  const sent = db.messages.filter((m) => m.userId === user.id);
  let bestStreak = 0;
  for (const c of db.chats) if (c.kind === "dm" && c.members.includes(user.id)) bestStreak = Math.max(bestStreak, streakOf(c)?.days || 0);
  bestStreak = Math.max(bestStreak, user.bestStreak || 0);
  return {
    verified: Boolean(user.verified),
    joinRank: [...db.users].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).findIndex((u) => u.id === user.id) + 1,
    posts: mine.filter((p) => p.type === "post").length,
    videos: mine.filter((p) => p.type === "video").length,
    shorts: mine.filter((p) => p.type === "short").length,
    polls: mine.filter((p) => p.poll).length,
    stickers: (user.stickers || []).length,
    following: user.following.length,
    followers: db.users.filter((u) => u.following.includes(user.id)).length,
    messages: sent.length,
    views: visible.reduce((n, p) => n + p.viewedBy.length, 0),
    topViews: visible.reduce((n, p) => Math.max(n, p.viewedBy.length), 0),
    cools: visible.reduce((n, p) => n + p.cools.length, 0),
    creator: mine.length,
    bestStreak,
    stories: user.storyCount || 0,
    playlists: db.playlists.filter((p) => p.userId === user.id).length,
    nightPosts: mine.filter((p) => { const h = new Date(p.createdAt).getHours(); return h < 5; }).length,
    commentsWritten: db.comments.filter((c) => c.userId === user.id).length,
    voiceSent: db.messages.filter((m) => m.userId === user.id && m.media?.kind === "audio").length,
    groupsOwned: db.chats.filter((c) => c.kind === "group" && c.ownerId === user.id).length,
    calls: user.callCount || 0,
    coolsGiven: db.posts.filter((p) => p.userId !== user.id && p.cools.includes(user.id)).length,
    gifs: (user.gifs || []).length,
    daysOnSite: Math.floor((Date.now() - new Date(user.createdAt).getTime()) / 86400000),
    likesReceived: mine.reduce((n, p) => n + p.likes.length, 0),
    photos: mine.reduce((n, p) => n + (p.media || []).filter((m) => m.kind === "image").length, 0),
    reactionsGiven: db.comments.filter((c) => c.userId !== user.id && c.reactions?.[user.id]).length,
    topReplyReactions: db.comments.filter((c) => c.userId === user.id).reduce((n, c) => Math.max(n, Object.keys(c.reactions || {}).length), 0),
    gifsSent: db.comments.filter((c) => c.userId === user.id && c.media?.gif).length + sent.filter((m) => m.media?.gif).length,
    stickersSent: sent.filter((m) => m.media?.sticker).length,
    videoReplies: db.comments.filter((c) => c.userId === user.id && c.media?.kind === "video").length,
    groups: db.chats.filter((c) => c.kind === "group" && c.members.includes(user.id)).length,
    biggestGroup: db.chats.filter((c) => c.kind === "group" && c.ownerId === user.id).reduce((n, c) => Math.max(n, c.members.length), 0),
    morningPosts: mine.filter((p) => { const h = new Date(p.createdAt).getHours(); return h >= 5 && h < 8; }).length,
    weekendPosts: mine.filter((p) => [0, 6].includes(new Date(p.createdAt).getDay())).length,
    nightMessages: sent.filter((m) => new Date(m.createdAt).getHours() < 5).length,
    roles: (user.roles || []).length,
    profileDone: [user.avatar, user.banner, user.bio].filter(Boolean).length,
    // Live
    ...(() => {
      const mineLive = (db.streams || []).filter((x) => x.userId === user.id && x.startedAt);
      const viewers = new Set(); mineLive.forEach((x) => (x.stats?.viewers || []).forEach((v) => viewers.add(v)));
      return {
        streams: mineLive.length, streamViewers: viewers.size,
        streamPeak: mineLive.reduce((n, x) => Math.max(n, x.peak || 0), 0),
        streamLikes: mineLive.reduce((n, x) => n + (x.likes || []).length, 0),
        guestLives: (db.streams || []).filter((x) => (x.guestHistory || []).includes(user.id)).length,
        collabLives: mineLive.filter((x) => (x.guestHistory || []).length).length,
        scheduled: (db.streams || []).filter((x) => x.userId === user.id && x.scheduledFor).length,
        liveChat: (db.streams || []).reduce((n, x) => n + (x.chat || []).filter((m) => m.userId === user.id).length, 0),
      };
    })(),
    premieres: mine.filter((p) => p.premiere).length,
    songs: (db.songs || []).filter((x) => x.userId === user.id).length,
    songPlays: (db.songs || []).filter((x) => x.userId === user.id).reduce((n, x) => n + (x.plays || 0), 0),
    albums: (db.albums || []).filter((x) => x.userId === user.id).length,
    movies: mine.filter((p) => p.film).length,
    series: db.playlists.filter((p) => p.userId === user.id && p.kind === "series").length,
    voiceDJ: user.voiceDJ || 0,
    gameWins: user.gameWins || 0, cardWins: user.cardWins || 0, gamesFinished: user.gamesFinished || 0,
    mySounds: (user.sounds || []).length,
    noteMedia: user.noteMediaCount || 0,
    sharesReceived: mine.reduce((n, p) => n + (p.shares || 0), 0),
  };
}

function badgesFor(user) {
  const s = statsFor(user);
  const badges = BADGES.map((b) => {
    const [have, need] = b.progress ? b.progress(s) : [b.test(s) ? 1 : 0, 1];
    return { id: b.id, cat: b.cat, emoji: b.emoji, name: b.name, how: b.how, earned: Boolean(b.test(s)), progress: Math.min(have, need), goal: need };
  });
  const awards = AWARDS.map((a) => {
    const value = s[a.id];
    const level = a.steps.filter((x) => value >= x).length; // 0..3
    const next = a.steps[level] || null;
    return {
      id: a.id, name: a.name, unit: a.unit, value, level,
      tier: level ? TIERS[level - 1][0] : null, emoji: level ? TIERS[level - 1][1] : "🏅",
      next, steps: a.steps,
    };
  });
  // Special badges the LookBlog team made just for this person
  const special = (user.specialBadges || []).map((b) => ({ id: b.id, emoji: b.emoji, name: b.name, givenAt: b.givenAt }));
  return { badges, awards, special, verifiedType: user.verified ? user.verifiedType || "creator" : null };
}

// Role badges people pick for themselves (up to 3)
const ROLES = [
  ["musician", "🎵", "Musician"], ["singer", "🎤", "Singer"], ["rapper", "🎙️", "Rapper"], ["dj", "🎧", "DJ / Producer"], ["artist", "🎨", "Artist"],
  ["photographer", "📷", "Photographer"], ["filmmaker", "🎥", "Filmmaker"], ["producer", "🎬", "Film Producer"], ["creator", "✨", "Creator"], ["writer", "✍️", "Writer"], ["dancer", "💃", "Dancer"],
  ["actor", "🎭", "Actor"], ["comedian", "😂", "Comedian"], ["gamer", "🎮", "Gamer"], ["streamer", "📺", "Streamer"],
  ["athlete", "🏅", "Athlete"], ["chef", "🍳", "Chef"], ["traveler", "✈️", "Traveler"], ["fashion", "👗", "Fashion"],
  ["designer", "✏️", "Designer"], ["developer", "💻", "Developer"], ["student", "🎓", "Student"], ["business", "💼", "Business"],
].map(([id, emoji, name]) => ({ id, emoji, name }));
// …or ones they made up themselves (user.customRoles)
const findRole = (u, id) => ROLES.find((r) => r.id === id) || (u.customRoles || []).find((r) => r.id === id);
const rolesOf = (u) => (u.roles || []).map((id) => findRole(u, id)).filter(Boolean);

// Notice new badges / award levels and tell the person
function checkBadges(user) {
  if (!user) return;
  const { badges, awards } = badgesFor(user);
  const have = new Set(user.earned || []);
  const fresh = [];
  for (const b of badges) if (b.earned && !have.has(b.id)) fresh.push([b.id, `${b.emoji} ${b.name}`]);
  for (const a of awards) for (let i = 1; i <= a.level; i++) {
    const key = `${a.id}:${i}`;
    if (!have.has(key)) fresh.push([key, `${TIERS[i - 1][1]} ${a.name} (${TIERS[i - 1][0]})`]);
  }
  if (!fresh.length) return;
  const first = !user.earned; // don't flood people with everything they already had before badges existed
  user.earned = [...have, ...fresh.map((f) => f[0])];
  const s = statsFor(user);
  if (s.bestStreak > (user.bestStreak || 0)) user.bestStreak = s.bestStreak;
  save("users");
  if (!first) for (const [, label] of fresh) notify(user.id, "badge", user, { text: label });
}

module.exports = { badgesFor, checkBadges, ROLES, rolesOf, findRole };
