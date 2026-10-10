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
  { id: "sharedaround", cat: "Reach", emoji: "📤", name: "Shared around", how: "Get your posts shared 25 times.", test: (s) => s.sharesReceived >= 25, progress: (s) => [s.sharesReceived, 25] },
  // More: community
  { id: "partystarter", cat: "Community", emoji: "🎉", name: "Party starter", how: "Host a public event.", test: (s) => s.eventsHosted >= 1, progress: (s) => [s.eventsHosted, 1] },
  { id: "outandabout", cat: "Community", emoji: "🎟️", name: "Out and about", how: "Go to 5 public events.", test: (s) => s.eventsJoined >= 5, progress: (s) => [s.eventsJoined, 5] },
  { id: "amplifier", cat: "Community", emoji: "📣", name: "Amplifier", how: "Repost 10 posts.", test: (s) => s.repostsMade >= 10, progress: (s) => [s.repostsMade, 10] },
  { id: "notepal", cat: "Community", emoji: "💭", name: "Note pal", how: "Reply to 5 notes.", test: (s) => s.noteReplies >= 5, progress: (s) => [s.noteReplies, 5] },
  { id: "noticed", cat: "Community", emoji: "💗", name: "Noticed", how: "Get a heart from the creator on one of your replies.", test: (s) => s.heartsReceived >= 1, progress: (s) => [s.heartsReceived, 1] },
  { id: "bigheart", cat: "Community", emoji: "💞", name: "Big heart", how: "Heart 10 replies on your own posts.", test: (s) => s.heartsGiven >= 10, progress: (s) => [s.heartsGiven, 10] },
  { id: "groupboss", cat: "Community", emoji: "👑", name: "Group boss", how: "Start 3 groups.", test: (s) => s.groupsOwned >= 3, progress: (s) => [s.groupsOwned, 3] },
  { id: "bestbuds", cat: "Community", emoji: "🫶", name: "Best buds", how: "Follow each other with 10 people.", test: (s) => s.mutuals >= 10, progress: (s) => [s.mutuals, 10] },
  // More: creators
  { id: "shortstar", cat: "Creators", emoji: "🌟", name: "Short star", how: "Post 100 shorts.", test: (s) => s.shorts >= 100, progress: (s) => [s.shorts, 100] },
  { id: "studio", cat: "Creators", emoji: "🏢", name: "Studio", how: "Upload 50 videos.", test: (s) => s.videos >= 50, progress: (s) => [s.videos, 50] },
  { id: "noteworthy", cat: "Creators", emoji: "🗒️", name: "Noteworthy", how: "Share 10 notes.", test: (s) => s.notesShared >= 10, progress: (s) => [s.notesShared, 10] },
  // More: reach
  { id: "coolkid", cat: "Reach", emoji: "😎", name: "Cool kid", how: "Get 100 Cools in total.", test: (s) => s.cools >= 100, progress: (s) => [s.cools, 100] },
  { id: "hottake", cat: "Reach", emoji: "🌶️", name: "Hot take", how: "Get 50 replies on one post.", test: (s) => s.topReplies >= 50, progress: (s) => [s.topReplies, 50] },
  { id: "megastar", cat: "Reach", emoji: "💫", name: "Megastar", how: "Get 5,000 likes in total.", test: (s) => s.likesReceived >= 5000, progress: (s) => [s.likesReceived, 5000] },
  { id: "celebrity", cat: "Reach", emoji: "🌠", name: "Celebrity", how: "Reach 5,000 followers.", test: (s) => s.followers >= 5000, progress: (s) => [s.followers, 5000] },
  // More: live
  { id: "marathon", cat: "Live", emoji: "🏃", name: "Live marathon", how: "Go live 50 times.", test: (s) => s.streams >= 50, progress: (s) => [s.streams, 50] },
  { id: "packed", cat: "Live", emoji: "🏟️", name: "Packed house", how: "Have 100 people watching your live at once.", test: (s) => s.streamPeak >= 100, progress: (s) => [s.streamPeak, 100] },
  { id: "cohost", cat: "Live", emoji: "🎤", name: "Co-host", how: "Join 5 lives as a guest.", test: (s) => s.guestLives >= 5, progress: (s) => [s.guestLives, 5] },
  // More: music & film
  { id: "hitmaker", cat: "Music & film", emoji: "🎶", name: "Hitmaker", how: "Release 10 songs.", test: (s) => s.songs >= 10, progress: (s) => [s.songs, 10] },
  { id: "platinum", cat: "Music & film", emoji: "💿", name: "Platinum", how: "Get 100,000 plays on your songs.", test: (s) => s.songPlays >= 100000, progress: (s) => [s.songPlays, 100000] },
  { id: "critic", cat: "Music & film", emoji: "⭐", name: "Critic", how: "Rate 10 movies or series with stars.", test: (s) => s.starsGiven >= 10, progress: (s) => [s.starsGiven, 10] },
  // More: games
  { id: "champion", cat: "Games", emoji: "🏆", name: "Champion", how: "Win 50 games.", test: (s) => s.gameWins + s.cardWins >= 50, progress: (s) => [s.gameWins + s.cardWins, 50] },
  { id: "gamenight", cat: "Games", emoji: "🕹️", name: "Game night", how: "Finish 100 games.", test: (s) => s.gamesFinished >= 100, progress: (s) => [s.gamesFinished, 100] },
  // More: streaks and fun
  { id: "streak14", cat: "Streaks", emoji: "🌟", name: "Two weeks strong", how: "Keep a 14-day LookStreak.", test: (s) => s.bestStreak >= 14, progress: (s) => [s.bestStreak, 14] },
  { id: "oneofakind", cat: "Just for fun", emoji: "💎", name: "One of a kind", how: "Get a special badge from the LookBlog team.", test: (s) => s.specialBadges >= 1 },
  // ---- 100 more ----
  { id: "dressed-up", cat: "Getting started", emoji: "👗", name: "Dressed up", how: "Change 5 things on your profile’s look.", test: (s) => s.looks >= 5, progress: (s) => [s.looks, 5] },
  { id: "stylist", cat: "Getting started", emoji: "💅", name: "Stylist", how: "Change 12 things on your profile’s look.", test: (s) => s.looks >= 12, progress: (s) => [s.looks, 12] },
  { id: "fashion-icon", cat: "Getting started", emoji: "🦄", name: "Fashion icon", how: "Change 20 things on your profile’s look.", test: (s) => s.looks >= 20, progress: (s) => [s.looks, 20] },
  { id: "soundtrack", cat: "Getting started", emoji: "🎵", name: "Soundtrack", how: "Put a song on your profile.", test: (s) => s.profileSong >= 1, progress: (s) => [s.profileSong, 1] },
  { id: "status-update", cat: "Getting started", emoji: "💭", name: "Status update", how: "Set a status under your name.", test: (s) => s.statusSet >= 1, progress: (s) => [s.statusSet, 1] },
  { id: "show-off", cat: "Getting started", emoji: "🏅", name: "Show-off", how: "Show 3 badges next to your name.", test: (s) => s.featuredBadges >= 3, progress: (s) => [s.featuredBadges, 3] },
  { id: "my-style", cat: "Getting started", emoji: "🖌️", name: "My style", how: "Give your messages your own style.", test: (s) => s.msgStyled >= 1, progress: (s) => [s.msgStyled, 1] },
  { id: "ringtone", cat: "Getting started", emoji: "🔔", name: "Ringtone", how: "Pick your own message sound.", test: (s) => s.msgSound >= 1, progress: (s) => [s.msgSound, 1] },
  { id: "searcher", cat: "Getting started", emoji: "🔍", name: "Searcher", how: "Search for 10 different things.", test: (s) => s.searches >= 10, progress: (s) => [s.searches, 10] },
  { id: "pinned", cat: "Getting started", emoji: "📌", name: "Pinned", how: "Pin a post or video to your profile.", test: (s) => s.pins >= 1, progress: (s) => [s.pins, 1] },
  { id: "first-ten", cat: "Creators", emoji: "🔟", name: "First ten", how: "Share 10 posts.", test: (s) => s.posts >= 10, progress: (s) => [s.posts, 10] },
  { id: "fifty-posts", cat: "Creators", emoji: "5️⃣", name: "Fifty", how: "Share 50 posts.", test: (s) => s.posts >= 50, progress: (s) => [s.posts, 50] },
  { id: "five-hundred", cat: "Creators", emoji: "🏗️", name: "Builder", how: "Share 500 posts.", test: (s) => s.posts >= 500, progress: (s) => [s.posts, 500] },
  { id: "thousand-posts", cat: "Creators", emoji: "🗿", name: "Monument", how: "Share 1,000 posts.", test: (s) => s.posts >= 1000, progress: (s) => [s.posts, 1000] },
  { id: "vlogger", cat: "Creators", emoji: "🎥", name: "Vlogger", how: "Upload 25 videos.", test: (s) => s.videos >= 25, progress: (s) => [s.videos, 25] },
  { id: "media-empire", cat: "Creators", emoji: "🏙️", name: "Media empire", how: "Upload 100 videos.", test: (s) => s.videos >= 100, progress: (s) => [s.videos, 100] },
  { id: "short-five", cat: "Creators", emoji: "🩳", name: "Quick one", how: "Post 5 shorts.", test: (s) => s.shorts >= 5, progress: (s) => [s.shorts, 5] },
  { id: "short-fifty", cat: "Creators", emoji: "🎢", name: "Scroll stopper", how: "Post 50 shorts.", test: (s) => s.shorts >= 50, progress: (s) => [s.shorts, 50] },
  { id: "short-legend", cat: "Creators", emoji: "🌪️", name: "Short legend", how: "Post 250 shorts.", test: (s) => s.shorts >= 250, progress: (s) => [s.shorts, 250] },
  { id: "photo-1000", cat: "Creators", emoji: "🏞️", name: "Museum", how: "Share 1,000 photos.", test: (s) => s.photos >= 1000, progress: (s) => [s.photos, 1000] },
  { id: "photo-dump", cat: "Creators", emoji: "🗃️", name: "Photo dump", how: "Share a post with 4 photos.", test: (s) => s.photoDumps >= 1, progress: (s) => [s.photoDumps, 1] },
  { id: "dump-master", cat: "Creators", emoji: "📦", name: "Dump master", how: "Share 10 posts with 4 photos.", test: (s) => s.photoDumps >= 10, progress: (s) => [s.photoDumps, 10] },
  { id: "long-video", cat: "Creators", emoji: "⏳", name: "Long story", how: "Upload a video of 10 minutes or more.", test: (s) => s.longVideos >= 1, progress: (s) => [s.longVideos, 1] },
  { id: "essayist", cat: "Creators", emoji: "📜", name: "Essayist", how: "Write a post of 500 characters or more.", test: (s) => s.longPosts >= 1, progress: (s) => [s.longPosts, 1] },
  { id: "emoji-poet", cat: "Creators", emoji: "🎭", name: "Emoji poet", how: "Write a post with only emoji.", test: (s) => s.emojiPosts >= 1, progress: (s) => [s.emojiPosts, 1] },
  { id: "stories-100", cat: "Creators", emoji: "📚", name: "Story machine", how: "Post 100 stories.", test: (s) => s.stories >= 100, progress: (s) => [s.stories, 100] },
  { id: "stories-500", cat: "Creators", emoji: "🎬", name: "Story legend", how: "Post 500 stories.", test: (s) => s.stories >= 500, progress: (s) => [s.stories, 500] },
  { id: "poll-50", cat: "Creators", emoji: "🧪", name: "Researcher", how: "Ask 50 polls.", test: (s) => s.polls >= 50, progress: (s) => [s.polls, 50] },
  { id: "sticker-100", cat: "Creators", emoji: "🏷️", name: "Sticker factory", how: "Make 100 stickers.", test: (s) => s.stickers >= 100, progress: (s) => [s.stickers, 100] },
  { id: "creator-200", cat: "Creators", emoji: "⚙️", name: "Machine", how: "Share 200 posts, shorts or videos.", test: (s) => s.creator >= 200, progress: (s) => [s.creator, 200] },
  { id: "creator-1000", cat: "Creators", emoji: "🏭", name: "Factory", how: "Share 1,000 posts, shorts or videos.", test: (s) => s.creator >= 1000, progress: (s) => [s.creator, 1000] },
  { id: "playlists-5", cat: "Creators", emoji: "🗄️", name: "Collector", how: "Make 5 playlists.", test: (s) => s.playlists >= 5, progress: (s) => [s.playlists, 5] },
  { id: "follow-100", cat: "Community", emoji: "🫂", name: "Fan of everyone", how: "Follow 100 people.", test: (s) => s.following >= 100, progress: (s) => [s.following, 100] },
  { id: "follow-500", cat: "Community", emoji: "🌍", name: "Know everyone", how: "Follow 500 people.", test: (s) => s.following >= 500, progress: (s) => [s.following, 500] },
  { id: "mutual-25", cat: "Community", emoji: "🤜", name: "Crew", how: "Have 25 mutuals.", test: (s) => s.mutuals >= 25, progress: (s) => [s.mutuals, 25] },
  { id: "mutual-100", cat: "Community", emoji: "🫶", name: "Squad", how: "Have 100 mutuals.", test: (s) => s.mutuals >= 100, progress: (s) => [s.mutuals, 100] },
  { id: "chat-5000", cat: "Community", emoji: "📬", name: "Pen pal", how: "Send 5,000 messages.", test: (s) => s.messages >= 5000, progress: (s) => [s.messages, 5000] },
  { id: "chat-20000", cat: "Community", emoji: "🗣️", name: "Never stops talking", how: "Send 20,000 messages.", test: (s) => s.messages >= 20000, progress: (s) => [s.messages, 20000] },
  { id: "reply-500", cat: "Community", emoji: "💬", name: "Talk of the town", how: "Write 500 replies.", test: (s) => s.commentsWritten >= 500, progress: (s) => [s.commentsWritten, 500] },
  { id: "reply-2000", cat: "Community", emoji: "🎙", name: "Forum legend", how: "Write 2,000 replies.", test: (s) => s.commentsWritten >= 2000, progress: (s) => [s.commentsWritten, 2000] },
  { id: "voice-100", cat: "Community", emoji: "🎤", name: "Podcaster", how: "Send 100 voice messages.", test: (s) => s.voiceSent >= 100, progress: (s) => [s.voiceSent, 100] },
  { id: "cools-500", cat: "Community", emoji: "🕶️", name: "Cool dispenser", how: "Give 500 Cools.", test: (s) => s.coolsGiven >= 500, progress: (s) => [s.coolsGiven, 500] },
  { id: "hype-man", cat: "Community", emoji: "📢", name: "Hype man", how: "Hype 10 posts in Trending.", test: (s) => s.hypesGiven >= 10, progress: (s) => [s.hypesGiven, 10] },
  { id: "hype-machine", cat: "Community", emoji: "🚨", name: "Hype machine", how: "Hype 100 posts in Trending.", test: (s) => s.hypesGiven >= 100, progress: (s) => [s.hypesGiven, 100] },
  { id: "reposter", cat: "Community", emoji: "🔁", name: "Spreader", how: "Repost 50 things.", test: (s) => s.repostsMade >= 50, progress: (s) => [s.repostsMade, 50] },
  { id: "gif-100", cat: "Community", emoji: "🎊", name: "GIF wizard", how: "Send 100 GIFs.", test: (s) => s.gifsSent >= 100, progress: (s) => [s.gifsSent, 100] },
  { id: "sticker-sent-100", cat: "Community", emoji: "🧷", name: "Sticker bomber", how: "Send 100 stickers.", test: (s) => s.stickersSent >= 100, progress: (s) => [s.stickersSent, 100] },
  { id: "file-sender", cat: "Community", emoji: "📎", name: "Paperwork", how: "Send a document in a chat.", test: (s) => s.filesSent >= 1, progress: (s) => [s.filesSent, 1] },
  { id: "file-pro", cat: "Community", emoji: "🗂", name: "Office pro", how: "Send 25 documents in chats.", test: (s) => s.filesSent >= 25, progress: (s) => [s.filesSent, 25] },
  { id: "music-sharer", cat: "Community", emoji: "💿", name: "Music sharer", how: "Send a song file in a chat.", test: (s) => s.audioFilesSent >= 1, progress: (s) => [s.audioFilesSent, 1] },
  { id: "effect-fan", cat: "Community", emoji: "🎆", name: "Show-off sender", how: "Send 10 messages with an effect.", test: (s) => s.effectsSent >= 10, progress: (s) => [s.effectsSent, 10] },
  { id: "effect-master", cat: "Community", emoji: "🪄", name: "Effect master", how: "Send 100 messages with an effect.", test: (s) => s.effectsSent >= 100, progress: (s) => [s.effectsSent, 100] },
  { id: "shark-attack", cat: "Community", emoji: "🦈", name: "Shark attack", how: "Send a message with the Shark attack effect.", test: (s) => s.sharkAttacks >= 1, progress: (s) => [s.sharkAttacks, 1] },
  { id: "jaws", cat: "Community", emoji: "🌊", name: "Jaws", how: "Send 25 Shark attacks.", test: (s) => s.sharkAttacks >= 25, progress: (s) => [s.sharkAttacks, 25] },
  { id: "groups-15", cat: "Community", emoji: "🏘️", name: "Everywhere", how: "Be in 15 groups.", test: (s) => s.groups >= 15, progress: (s) => [s.groups, 15] },
  { id: "group-100", cat: "Community", emoji: "🏟", name: "Stadium", how: "Have 100 people in a group you started.", test: (s) => s.biggestGroup >= 100, progress: (s) => [s.biggestGroup, 100] },
  { id: "calls-100", cat: "Community", emoji: "📱", name: "Always on call", how: "Have 100 calls.", test: (s) => s.calls >= 100, progress: (s) => [s.calls, 100] },
  { id: "events-5", cat: "Community", emoji: "🎪", name: "Party planner", how: "Host 5 events.", test: (s) => s.eventsHosted >= 5, progress: (s) => [s.eventsHosted, 5] },
  { id: "events-25", cat: "Community", emoji: "🎟️", name: "Out every night", how: "Go to 25 events.", test: (s) => s.eventsJoined >= 25, progress: (s) => [s.eventsJoined, 25] },
  { id: "followers-50", cat: "Reach", emoji: "🌤️", name: "Getting noticed", how: "Reach 50 followers.", test: (s) => s.followers >= 50, progress: (s) => [s.followers, 50] },
  { id: "followers-500", cat: "Reach", emoji: "🌞", name: "Popular", how: "Reach 500 followers.", test: (s) => s.followers >= 500, progress: (s) => [s.followers, 500] },
  { id: "followers-50k", cat: "Reach", emoji: "🪐", name: "Superstar", how: "Reach 50,000 followers.", test: (s) => s.followers >= 50000, progress: (s) => [s.followers, 50000] },
  { id: "followers-100k", cat: "Reach", emoji: "👑", name: "Icon", how: "Reach 100,000 followers.", test: (s) => s.followers >= 100000, progress: (s) => [s.followers, 100000] },
  { id: "views-1k", cat: "Reach", emoji: "👀", name: "Seen", how: "Get 1,000 views in total.", test: (s) => s.views >= 1000, progress: (s) => [s.views, 1000] },
  { id: "views-10k", cat: "Reach", emoji: "🔭", name: "Watched", how: "Get 10,000 views in total.", test: (s) => s.views >= 10000, progress: (s) => [s.views, 10000] },
  { id: "views-1m", cat: "Reach", emoji: "🌌", name: "Millionaire", how: "Get 1,000,000 views in total.", test: (s) => s.views >= 1000000, progress: (s) => [s.views, 1000000] },
  { id: "viral-1k", cat: "Reach", emoji: "🔥", name: "Heating up", how: "Get 1,000 views on a single post.", test: (s) => s.topViews >= 1000, progress: (s) => [s.topViews, 1000] },
  { id: "viral-100k", cat: "Reach", emoji: "☄", name: "Global hit", how: "Get 100,000 views on a single post.", test: (s) => s.topViews >= 100000, progress: (s) => [s.topViews, 100000] },
  { id: "likes-10", cat: "Reach", emoji: "👍", name: "Liked", how: "Get 10 likes in total.", test: (s) => s.likesReceived >= 10, progress: (s) => [s.likesReceived, 10] },
  { id: "likes-50k", cat: "Reach", emoji: "💞", name: "Adored", how: "Get 50,000 likes in total.", test: (s) => s.likesReceived >= 50000, progress: (s) => [s.likesReceived, 50000] },
  { id: "cools-1k", cat: "Reach", emoji: "😎", name: "Coolest", how: "Get 1,000 Cools.", test: (s) => s.cools >= 1000, progress: (s) => [s.cools, 1000] },
  { id: "hyped", cat: "Reach", emoji: "🌡️", name: "Hyped", how: "Get 10 hypes on your posts.", test: (s) => s.hypesReceived >= 10, progress: (s) => [s.hypesReceived, 10] },
  { id: "mega-hyped", cat: "Reach", emoji: "💥", name: "Mega hyped", how: "Get 100 hypes on your posts.", test: (s) => s.hypesReceived >= 100, progress: (s) => [s.hypesReceived, 100] },
  { id: "shared-100", cat: "Reach", emoji: "📤", name: "Shared everywhere", how: "Get 100 shares.", test: (s) => s.sharesReceived >= 100, progress: (s) => [s.sharesReceived, 100] },
  { id: "reposted-10", cat: "Reach", emoji: "♻️", name: "Reposted", how: "Get reposted 10 times.", test: (s) => s.repostsReceived >= 10, progress: (s) => [s.repostsReceived, 10] },
  { id: "reposted-100", cat: "Reach", emoji: "🌀", name: "Repost storm", how: "Get reposted 100 times.", test: (s) => s.repostsReceived >= 100, progress: (s) => [s.repostsReceived, 100] },
  { id: "replies-1k", cat: "Reach", emoji: "🧵", name: "Big thread", how: "Get 1,000 replies in total.", test: (s) => s.repliesReceived >= 1000, progress: (s) => [s.repliesReceived, 1000] },
  { id: "haters", cat: "Reach", emoji: "👎", name: "Haters gonna hate", how: "Get 100 dislikes (it means you’re seen!).", test: (s) => s.dislikesReceived >= 100, progress: (s) => [s.dislikesReceived, 100] },
  { id: "streams-100", cat: "Live", emoji: "📡", name: "Broadcaster", how: "Go live 100 times.", test: (s) => s.streams >= 100, progress: (s) => [s.streams, 100] },
  { id: "peak-1k", cat: "Live", emoji: "🏟️", name: "Packed house", how: "Have 1,000 people watching a live at once.", test: (s) => s.streamPeak >= 1000, progress: (s) => [s.streamPeak, 1000] },
  { id: "live-viewers-1k", cat: "Live", emoji: "👥", name: "Live audience", how: "Reach 1,000 different viewers in lives.", test: (s) => s.streamViewers >= 1000, progress: (s) => [s.streamViewers, 1000] },
  { id: "live-likes-1k", cat: "Live", emoji: "💗", name: "Live love", how: "Get 1,000 likes on your lives.", test: (s) => s.streamLikes >= 1000, progress: (s) => [s.streamLikes, 1000] },
  { id: "collab-10", cat: "Live", emoji: "🤝", name: "Collab king", how: "Do 10 lives with guests.", test: (s) => s.collabLives >= 10, progress: (s) => [s.collabLives, 10] },
  { id: "live-chatter", cat: "Live", emoji: "⌨️", name: "Chat regular", how: "Write 500 messages in live chats.", test: (s) => s.liveChat >= 500, progress: (s) => [s.liveChat, 500] },
  { id: "songs-50", cat: "Music & film", emoji: "💽", name: "Discography", how: "Upload 50 songs.", test: (s) => s.songs >= 50, progress: (s) => [s.songs, 50] },
  { id: "albums-5", cat: "Music & film", emoji: "📀", name: "Album artist", how: "Release 5 albums.", test: (s) => s.albums >= 5, progress: (s) => [s.albums, 5] },
  { id: "plays-10k", cat: "Music & film", emoji: "🎧", name: "On repeat", how: "Get 10,000 plays on your songs.", test: (s) => s.songPlays >= 10000, progress: (s) => [s.songPlays, 10000] },
  { id: "plays-1m", cat: "Music & film", emoji: "🏆", name: "Platinum", how: "Get 1,000,000 plays on your songs.", test: (s) => s.songPlays >= 1000000, progress: (s) => [s.songPlays, 1000000] },
  { id: "movies-10", cat: "Music & film", emoji: "🎞", name: "Filmmaker", how: "Upload 10 movies.", test: (s) => s.movies >= 10, progress: (s) => [s.movies, 10] },
  { id: "series-5", cat: "Music & film", emoji: "📺", name: "Showrunner", how: "Make 5 series.", test: (s) => s.series >= 5, progress: (s) => [s.series, 5] },
  { id: "top-critic", cat: "Music & film", emoji: "🧐", name: "Top critic", how: "Rate 50 movies or series.", test: (s) => s.starsGiven >= 50, progress: (s) => [s.starsGiven, 50] },
  { id: "dj-100", cat: "Music & film", emoji: "🎛️", name: "Resident DJ", how: "DJ 100 times in voice channels.", test: (s) => s.voiceDJ >= 100, progress: (s) => [s.voiceDJ, 100] },
  { id: "sounds-10", cat: "Music & film", emoji: "🔊", name: "Sound designer", how: "Add 10 sounds of your own.", test: (s) => s.mySounds >= 10, progress: (s) => [s.mySounds, 10] },
  { id: "wins-10", cat: "Games", emoji: "🥇", name: "Winner", how: "Win 10 games.", test: (s) => s.gameWins >= 10, progress: (s) => [s.gameWins, 10] },
  { id: "wins-100", cat: "Games", emoji: "🏆", name: "Champion", how: "Win 100 games.", test: (s) => s.gameWins >= 100, progress: (s) => [s.gameWins, 100] },
  { id: "cards-100", cat: "Games", emoji: "🃏", name: "Card shark", how: "Win 100 card games.", test: (s) => s.cardWins >= 100, progress: (s) => [s.cardWins, 100] },
  { id: "games-500", cat: "Games", emoji: "🕹️", name: "No life", how: "Finish 500 games.", test: (s) => s.gamesFinished >= 500, progress: (s) => [s.gamesFinished, 500] },
  { id: "xmas", cat: "Just for fun", emoji: "🎄", name: "Merry LookBlog", how: "Post something on Christmas.", test: (s) => s.xmasPosts >= 1, progress: (s) => [s.xmasPosts, 1] },
  { id: "new-year", cat: "Just for fun", emoji: "🎆", name: "Happy New Year", how: "Post something on New Year’s Day.", test: (s) => s.newYearPosts >= 1, progress: (s) => [s.newYearPosts, 1] },
  { id: "spooky", cat: "Just for fun", emoji: "🎃", name: "Spooky", how: "Post something on Halloween.", test: (s) => s.halloweenPosts >= 1, progress: (s) => [s.halloweenPosts, 1] },
  { id: "valentine", cat: "Just for fun", emoji: "💘", name: "Valentine", how: "Post something on Valentine’s Day.", test: (s) => s.valentinePosts >= 1, progress: (s) => [s.valentinePosts, 1] },
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
    views: visible.reduce((n, p) => n + (p.views ?? p.viewedBy.length), 0),
    topViews: visible.reduce((n, p) => Math.max(n, (p.views ?? p.viewedBy.length)), 0),
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
    eventsHosted: (db.events || []).filter((e) => e.hostId === user.id).length,
    eventsJoined: (db.events || []).filter((e) => e.hostId !== user.id && (e.going || []).includes(user.id)).length,
    repostsMade: db.posts.filter((p) => p.userId !== user.id && p.reposts.some((r) => r.userId === user.id)).length,
    noteReplies: user.noteReplyCount || 0,
    notesShared: user.noteCount || 0,
    heartsReceived: db.comments.filter((c) => c.userId === user.id && c.creatorHeart).length,
    heartsGiven: (() => { const own = new Set(mine.map((p) => p.id)); return db.comments.filter((c) => c.creatorHeart && own.has(c.postId) && c.userId !== user.id).length; })(),
    mutuals: user.following.filter((id) => db.users.some((u) => u.id === id && u.following.includes(user.id))).length,
    topReplies: visible.reduce((n, p) => Math.max(n, p.commentCount || 0), 0),
    starsGiven: db.posts.filter((p) => p.film && p.stars?.[user.id]).length + db.playlists.filter((pl) => pl.stars?.[user.id]).length,
    specialBadges: (user.specialBadges || []).length,
    // For the newer badges
    ...(() => {
      const on = (p, m, d) => { const t = new Date(p.createdAt); return t.getMonth() === m && t.getDate() === d; };
      const look = user.look || {};
      return {
        looks: Object.keys(look).filter((k) => !["song", "songYt", "songFile", "featured", "status"].includes(k)).length,
        profileSong: look.song || look.songYt || look.songFile ? 1 : 0,
        statusSet: look.status ? 1 : 0,
        featuredBadges: (look.featured || []).length,
        msgStyled: user.msgStyle ? 1 : 0,
        msgSound: user.msgSound ? 1 : 0,
        searches: (user.searches || []).length,
        pins: (user.pins || []).length,
        photoDumps: mine.filter((p) => (p.media || []).filter((m) => m.kind === "image").length >= 4).length,
        longVideos: mine.filter((p) => p.type === "video" && (p.media?.[0]?.duration || 0) >= 600).length,
        longPosts: mine.filter((p) => (p.text || "").length >= 500).length,
        emojiPosts: mine.filter((p) => p.text && /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f\s]+$/u.test(p.text) && /\p{Extended_Pictographic}/u.test(p.text)).length,
        hypesGiven: db.posts.filter((p) => (p.hypes || []).includes(user.id)).length,
        hypesReceived: mine.reduce((n, p) => n + (p.hypes || []).length, 0),
        repostsReceived: mine.reduce((n, p) => n + p.reposts.length, 0),
        dislikesReceived: mine.reduce((n, p) => n + p.dislikes.length, 0),
        repliesReceived: mine.reduce((n, p) => n + (p.commentCount || 0), 0),
        filesSent: sent.filter((m) => m.media?.kind === "file").length,
        audioFilesSent: sent.filter((m) => m.media?.file).length,
        effectsSent: sent.filter((m) => m.effect).length,
        sharkAttacks: sent.filter((m) => m.effect === "shark").length,
        xmasPosts: mine.filter((p) => on(p, 11, 24) || on(p, 11, 25) || on(p, 11, 26)).length,
        newYearPosts: mine.filter((p) => on(p, 0, 1)).length,
        halloweenPosts: mine.filter((p) => on(p, 9, 31)).length,
        valentinePosts: mine.filter((p) => on(p, 1, 14)).length,
      };
    })(),
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
  const special = (user.specialBadges || []).map((b) => ({ id: b.id, emoji: b.emoji, image: b.image || null, color: b.color || null, unique: b.defId ? Boolean(b.unique) : true, name: b.name, givenAt: b.givenAt }));
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
