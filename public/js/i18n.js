// Site language. The app is written in English; for other languages the words on screen are
// swapped as they appear (buttons, menus, titles, placeholders). What people write is never touched.
import { h, modal, toast } from "./ui.js";
import { api } from "./api.js";
import { dictionaryFor } from "./i18n-more.js";

export const LANGS = [
  { id: "en", name: "English", native: "English", flag: "🇬🇧" },
  { id: "bg", name: "Bulgarian", native: "Български", flag: "🇧🇬" },
  { id: "es", name: "Spanish", native: "Español", flag: "🇪🇸" },
  { id: "ru", name: "Russian", native: "Русский", flag: "🇷🇺" },
  { id: "de", name: "German", native: "Deutsch", flag: "🇩🇪" },
  { id: "sr", name: "Serbian", native: "Srpski", flag: "🇷🇸" },
  { id: "ro", name: "Romanian", native: "Română", flag: "🇷🇴" },
];

// English → Български
const BG = {
  // Navigation and menus
  "Feed": "Начало", "Shorts": "Шортс", "Videos": "Видеа", "Groups": "Групи", "Profile": "Профил", "Messages": "Съобщения",
  "Notifications": "Известия", "Your profile": "Твоят профил", "Analytics": "Статистика", "Get verified": "Верификация",
  "Privacy & blocking": "Поверителност и блокиране", "Language": "Език", "Help": "Помощ", "Log out": "Изход",
  "People to follow": "Хора за следване", "Search people and posts": "Търси хора и постове", "Search Look Blog": "Търси в LookBlog",
  "Search": "Търсене", "Events": "Събития", "Create": "Създай", "Switch account": "Смени профила", "Add account": "Добави профил", "Add another account": "Добави още един профил",
  "Upload video": "Качи видео", "Upload short": "Качи шорт", "Tag people": "Отбележи хора", "Tagged": "Отбелязан", "Playlists": "Плейлисти", "Reposts": "Споделени",
  "Add videos": "Добави видеа", "Still need help?": "Още ти трябва помощ?", "Send to the LookBlog team": "Изпрати на екипа на LookBlog", "Public": "Публично", "Unlisted": "Скрито", "Private": "Лично", "All": "Всички", "Latest": "Най-нови", "Scroll slowly. Someone made this.": "Разглеждай бавно. Някой е направил това.",
  "Hosting": "Организираш", "Past": "Минали", "About": "Информация", "Share event": "Сподели събитието", "Create event": "Създай събитие",
  "Edit event": "Редактирай събитието", "Cancel event": "Отмени събитието", "Settings": "Настройки", "Recent searches": "Последни търсения", "Clear": "Изчисти",
  "People": "Хора", "Your groups": "Твоите групи", "Chats": "Чатове", "Quality": "Качество", "Subtitles": "Субтитри",
  // Common actions
  "Save": "Запази", "Cancel": "Отказ", "Remove": "Премахни", "Delete": "Изтрий", "Reply": "Отговори", "Play": "Пусни",
  "Send": "Изпрати", "Report": "Докладвай", "Close": "Затвори", "Back": "Назад", "Accept": "Приеми", "Decline": "Откажи",
  "Share": "Сподели", "Undo": "Отмени", "Edit": "Редактирай", "Rename": "Преименувай", "Copy": "Копирай", "Copy link": "Копирай линка",
  "Open": "Отвори", "Next": "Напред", "Previous": "Назад", "More": "Още", "More…": "Още…", "Add": "Добави", "Apply": "Кандидатствай",
  "Reset": "Нулирай", "Restore": "Възстанови", "Settings": "Настройки", "Loading…": "Зарежда…", "Loading": "Зарежда",
  "Follow": "Последвай", "Following": "Следваш", "Unfollow": "Спри да следваш", "Requested": "Изпратена заявка", "Cancel request": "Откажи заявката",
  "Follows you": "Следва те", "Followers": "Последователи", "Message": "Съобщение", "Block": "Блокирай", "Unblock": "Отблокирай",
  "Like": "Харесай", "Dislike": "Не харесвам", "Repost": "Сподели отново", "Cool": "Cool", "Post": "Публикувай", "Posts": "Постове",
  "Short": "Шорт", "Video": "Видео", "Photo": "Снимка", "Views": "Гледания", "Replies": "Отговори", "Members": "Членове", "People": "Хора",
  "New": "Ново", "Story": "История", "New story": "Нова история", "You": "Ти", "Owner": "Собственик", "Link": "Линк", "Links": "Линкове",
  "Name": "Име", "Username": "Потребителско име", "Your name": "Твоето име", "Full name": "Пълно име", "Your full name": "Твоето пълно име",
  "Title": "Заглавие", "Category": "Категория", "Thumbnail": "Миниатюра", "Picture": "Снимка", "Badges": "Значки", "Awards": "Награди",
  "Nothing yet.": "Все още няма нищо.", "No one found.": "Няма намерени хора.", "Nothing found. Try other words.": "Няма резултати. Опитай с други думи.",
  // Posting
  "Write a post": "Напиши пост", "What do you want to post?": "Какво искаш да публикуваш?", "Add a poll": "Добави анкета", "Remove poll": "Премахни анкетата",
  "Poll length": "Продължителност на анкетата", "Poll answers": "Отговори в анкетата", "Add answer": "Добави отговор", "Add text (optional)": "Добави текст (по желание)",
  "Add a description": "Добави описание", "Who can watch": "Кой може да гледа", "Upload thumbnail": "Качи миниатюра", "Change thumbnail": "Смени миниатюрата",
  "Use a frame from the video": "Използвай кадър от видеото", "No thumbnail yet": "Още няма миниатюра", "Save thumbnail": "Запази миниатюрата",
  "MP4, MOV or WebM": "MP4, MOV или WebM", "See all posts": "Виж всички постове", "This post was deleted.": "Този пост е изтрит.",
  "Copy link · Send in a chat": "Копирай линка · Изпрати в чат", "Send in a chat": "Изпрати в чат", "Share a link or send it in a chat": "Сподели линк или го изпрати в чат",
  // Replies
  "Post your reply": "Напиши отговор", "Your reply": "Твоят отговор", "Reply with a GIF": "Отговори с GIF", "Reply with a video": "Отговори с видео",
  "Reply with text, a photo, a GIF or a video": "Отговори с текст, снимка, GIF или видео", "Delete reply": "Изтрий отговора",
  "Newest": "Най-нови", "Oldest": "Най-стари", "Top": "Топ", "Sort replies": "Подреди отговорите", "React": "Реагирай", "More reactions": "Още реакции",
  // Messages
  "New message": "Ново съобщение", "Write a message": "Напиши съобщение", "Your messages": "Твоите съобщения", "Voice call": "Гласово обаждане",
  "Video call": "Видео обаждане", "Call": "Обаждане", "Hang up": "Затвори", "Mute": "Заглуши", "Muted": "Заглушен", "Camera": "Камера",
  "Share your screen": "Сподели екрана", "Play a game": "Играй игра", "Play a game together": "Играйте заедно", "Voice message": "Гласово съобщение",
  "Record a voice message": "Запиши гласово съобщение", "Send voice message": "Изпрати гласово съобщение", "Cancel reply": "Откажи отговора",
  "Cancel recording": "Откажи записа", "Delete message": "Изтрий съобщението", "Stickers": "Стикери", "Emoji": "Емоджи", "Add emoji": "Добави емоджи",
  "Nickname": "Прякор", "Nicknames": "Прякори", "Find public groups": "Намери публични групи", "Show the original message": "Покажи оригиналното съобщение",
  "Original message was deleted": "Оригиналното съобщение е изтрито", "You can message people who follow you back.": "Можеш да пишеш на хора, които те следват обратно.",
  "Search GIFs": "Търси GIF-ове", "All GIFs": "Всички GIF-ове", "Yours": "Твоите", "Add GIF": "Добави GIF",
  // Games
  "Join game": "Влез в играта", "Resign": "Предай се", "Bigger": "По-голямо", "Chess": "Шах", "Tic-tac-toe": "Морски шах", "Connect four": "Четири в редица",
  "Your turn": "Твой ред", "Promote to": "Произведи в",
  // Groups
  "New group": "Нова група", "Create group": "Създай група", "Group name": "Име на групата", "What is this group about?": "За какво е групата?",
  "Find a group": "Намери група", "Group settings": "Настройки на групата", "Leave group": "Напусни групата", "Leave": "Напусни",
  "Delete group": "Изтрий групата", "Delete this group": "Изтрий тази група", "Who can see it": "Кой може да я вижда", "Group colour": "Цвят на групата",
  "Invite people": "Покани хора", "Roles": "Роли", "Text channels": "Текстови канали", "Voice channels": "Гласови канали",
  "New text channel": "Нов текстов канал", "New voice channel": "Нов гласов канал", "Delete channel": "Изтрий канала", "Channels": "Канали",
  "Overview": "Общи", "Sounds": "Звуци", "Soundboard": "Звуци", "Create and give roles": "Създавай и давай роли", "+ New role": "+ Нова роля",
  "+ Create a role": "+ Създай роля", "Delete role": "Изтрий ролята", "Role name, e.g. DJ": "Име на ролята, напр. DJ", "Your nickname here": "Твоят прякор тук",
  "Search people to invite": "Търси хора за покана", "Or send a link": "Или изпрати линк", "No limit": "Без ограничение", "Never expires": "Не изтича",
  "Expires in 7 days": "Изтича след 7 дни", "Expires in 1 day": "Изтича след 1 ден", "Join group": "Влез в групата", "Open group": "Отвори групата",
  "New event": "Ново събитие", "Create event": "Създай събитие", "Remove event": "Премахни събитието", "Where (optional)": "Къде (по желание)",
  "Event name, e.g. Movie night": "Име на събитието, напр. Кино вечер", "What’s happening? (optional)": "Какво ще се случва? (по желание)",
  "Add sound": "Добави звук", "Choose a sound file": "Избери звуков файл", "LookBlog sounds": "Звуци на LookBlog", "Voice connected": "Свързан с гласов канал",
  "Banner": "Банер", "Add banner": "Добави банер", "Change banner": "Смени банера", "Add a banner": "Добави банер", "Add a picture": "Добави снимка",
  // Privacy, safety, reports
  "🔒 Private account": "🔒 Личен профил", "Private account": "Личен профил", "Follow requests": "Заявки за следване", "Blocked accounts": "Блокирани профили",
  "This account is private": "Този профил е личен", "Send report": "Изпрати доклад", "What happened? (optional)": "Какво се случи? (по желание)",
  "Spam or a fake account": "Спам или фалшив профил", "Pretending to be someone else": "Представя се за някой друг", "Harassment or bullying": "Тормоз",
  "Hate speech": "Реч на омразата", "Violence or threats": "Насилие или заплахи", "Nudity or sexual content": "Голота или сексуално съдържание",
  "Self-harm or suicide": "Самонараняване", "They might be under 13": "Може да е под 13 години", "Something else": "Нещо друго",
  "Spam or scam": "Спам или измама", "False information": "Невярна информация", "Uses my work without permission": "Използва моя труд без разрешение",
  // Profile
  "Tell people a little about yourself": "Разкажи малко за себе си", "What do you do?": "С какво се занимаваш?", "Not in the list?": "Няма го в списъка?",
  "New playlist": "Нов плейлист", "Playlist": "Плейлист", "Play all": "Пусни всички", "Save to playlist": "Запази в плейлист", "Up next": "Следва",
  "Your categories": "Твоите категории", "New category": "Нова категория", "Choose a picture": "Избери снимка", "Adjust your photo": "Нагласи снимката",
  "Adjust your banner": "Нагласи банера", "Zoom": "Мащаб", "Your note": "Твоята бележка",
  // Player
  "Speed": "Скорост", "Volume": "Звук", "Full screen": "Цял екран", "Quality": "Качество", "Subtitles": "Субтитри", "Theater mode": "Режим театър",
  "Auto": "Автоматично", "Off": "Изкл.",
  // Verify and analytics
  "Get verified on LookBlog": "Верифицирай се в LookBlog", "What you need": "Какво ти трябва", "Content analytics": "Статистика на съдържанието",
  "Back to analytics": "Обратно към статистиката",
  // Events page
  "Public events": "Публични събития", "Join": "Включи се", "Going": "Отивам", "Going ✓": "Отивам ✓", "I’m going": "Отивам", "Discussion": "Дискусия",
  "Share to a group": "Сподели в група", "Create a public event": "Създай публично събитие", "Upcoming": "Предстоящи", "Attending": "Присъстват",
};
// Words that change with numbers ("3 members" → "3 членове")
const BG_PATTERNS = [
  [/^(\d[\d,.]*K?) (member|members)$/, (n) => `${n} ${n === "1" ? "член" : "членове"}`],
  [/^(\d[\d,.]*K?) (reply|replies)$/, (n) => `${n} ${n === "1" ? "отговор" : "отговора"}`],
  [/^(\d[\d,.]*K?) (follower|followers)$/, (n) => `${n} последователи`],
  [/^(\d[\d,.]*K?) (view|views)$/, (n) => `${n} гледания`],
  [/^(\d[\d,.]*K?) (person|people) going$/, (n) => `${n} отиват`],
  [/^(\d[\d,.]*K?) online$/, (n) => `${n} на линия`],
];
const DICTS = { bg: [BG, BG_PATTERNS] };

export const currentLang = () => { try { return localStorage.getItem("lb-lang") || "en"; } catch { return "en"; } };

// Things people wrote are left alone
const SKIP = ".post-text, .bubble-text, .bio, .name-text, .handle, .ev-text p, .reply .post-text, .note-bubble, .notif-quote, .help-item p, textarea, [contenteditable], .no-translate";

function tr(text, dict, patterns) {
  const t = text.trim();
  if (!t) return null;
  const hit = dict[t];
  if (hit) return text.replace(t, hit);
  for (const [re, fn] of patterns) { const m = re.exec(t); if (m) return text.replace(t, fn(m[1])); }
  return null;
}
function translateTree(root, dict, patterns) {
  if (root.nodeType === 3) {
    const p = root.parentElement;
    if (p && !p.closest(SKIP)) { const n = tr(root.nodeValue, dict, patterns); if (n !== null && n !== root.nodeValue) root.nodeValue = n; }
    return;
  }
  if (root.nodeType !== 1 || root.closest?.(SKIP)) return;
  for (const el of [root, ...root.querySelectorAll("[placeholder], [title], [aria-label]")]) {
    for (const a of ["placeholder", "title", "aria-label"]) {
      const v = el.getAttribute?.(a);
      if (v) { const n = tr(v, dict, patterns); if (n !== null && n !== v) el.setAttribute(a, n); }
    }
  }
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walk.nextNode()) nodes.push(walk.currentNode);
  for (const n of nodes) {
    if (n.parentElement?.closest(SKIP)) continue;
    const v = tr(n.nodeValue, dict, patterns);
    if (v !== null && v !== n.nodeValue) n.nodeValue = v;
  }
}

export function startTranslation() {
  const lang = currentLang();
  document.documentElement.lang = lang;
  const d = DICTS[lang] || dictionaryFor(lang);
  if (!d) return;
  const [dict, patterns] = d;
  translateTree(document.body, dict, patterns);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") translateTree(m.target, dict, patterns);
      else if (m.type === "attributes") translateTree(m.target, dict, patterns);
      else m.addedNodes.forEach((n) => translateTree(n, dict, patterns));
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "title", "aria-label"] });
}

export function openLanguage() {
  const now = currentLang();
  const list = h("div", { class: "lang-list" }, ...LANGS.map((l) => {
    const b = h("button", { type: "button", class: "lang-option" + (l.id === now ? " on" : "") },
      h("span", { class: "lang-flag", text: l.flag }), h("span", { class: "lang-names" }, h("b", { text: l.native }), h("span", { class: "muted", text: l.name })),
      l.id === now ? h("span", { class: "lang-check", text: "✓" }) : null);
    b.addEventListener("click", async () => {
      if (l.id === now) return m.close();
      try { localStorage.setItem("lb-lang", l.id); } catch {}
      api("/api/me/lang", { method: "POST", body: { lang: l.id } }).catch(() => {});
      toast({ bg: "Езикът е сменен.", es: "Idioma cambiado.", ru: "Язык изменён.", de: "Sprache geändert.", sr: "Jezik je promenjen.", ro: "Limba a fost schimbată." }[l.id] || "Language changed.");
      setTimeout(() => location.reload(), 300);
    });
    return b;
  }));
  const m = modal({ title: "Language", body: h("div", { class: "create-form" }, list) });
}

// Bring the saved choice from the account (another device may have set it)
export function syncLanguage(me) {
  if (me?.lang && me.lang !== currentLang()) {
    try { localStorage.setItem("lb-lang", me.lang); } catch {}
    location.reload();
  }
}
