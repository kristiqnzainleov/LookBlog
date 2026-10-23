# Records of processing activities (GDPR Article 30)

Last reviewed: 22 October 2026. Review it whenever LookBlog starts collecting something new or uses a new service.

## Controller

| | |
|---|---|
| Controller | Kristiqn Zainelov, Bulgaria (runs LookBlog, https://lookblog.vercel.app) |
| Contact | https://lookblog.vercel.app/contact (no account needed) |
| Data protection officer | Not appointed (not required: no large-scale processing of special categories, no public authority) |
| Supervisory authority | Commission for Personal Data Protection (КЗЛД), https://cpdp.bg |

## Processing activities

| # | Activity | Purpose | Legal basis (Art. 6) | People | Data | Kept for |
|---|---|---|---|---|---|---|
| 1 | Accounts | Sign-up, log-in, security | Contract (b) | Users | Name, @username, email, password hash, 2-step code, recovery code hashes, consent record (version, date, age 14+) | Until the account is deleted |
| 2 | Content | Showing what people post | Contract (b) | Users, people shown in content | Posts, photos, videos, songs, comments, stories, highlights, notes, events, groups, stickers, sounds | Until deleted by the user. Stories: 24 h public, then 30 days in the private archive, unless in a highlight |
| 3 | Messages and calls | Direct and group chats, calls, voice rooms | Contract (b) | Users | Messages, media, reactions. Calls are peer-to-peer and not recorded | Until deleted (vanishing messages: as set by the chat) |
| 4 | Activity and presence | Online dot and "Last online", notifications | Contract (b) / legitimate interest (f) | Users | Online pings, last-seen time (users can hide it) | Until the account is deleted |
| 5 | Recommendations and analytics | "For you" feed and creator analytics | Legitimate interest (f) | Users | Follows, likes, views, watch time, plays, searches, watch history (can be paused and cleared) | Until the account is deleted or the history is cleared |
| 6 | Safety and moderation | Spam and abuse prevention, reports, automatic content checks, suspensions | Legitimate interest (f), legal obligation (c), DSA | Users, reporters | IP address (rate limits and lockouts, in memory), reports, moderation decisions | Reports: while needed for the case and possible appeals |
| 7 | Support and contact | Answering messages, privacy requests, legal notices | Legitimate interest (f), legal obligation (c) | Users and non-users | Email, name, @username, message, browser | While needed. After account deletion: kept without name or email |
| 8 | Account deletion feedback | Learning why people leave | Legitimate interest (f) | Former users | Reason, details, account age (no identity) | Kept anonymised |

No special categories of data (Art. 9) are collected on purpose. No automated decisions with legal or similar effects (Art. 22). Data is not sold and no ads are shown.

## Recipients (processors and third parties)

| Recipient | Role | What they get | Location / transfer safeguard |
|---|---|---|---|
| Vercel Inc. | Processor: hosting | All traffic | Functions run in Frankfurt (fra1). **DPA: not covered.** The team "look-blog" is on the Hobby plan, and Vercel's DPA (with 2021 SCCs) applies only to Pro and Enterprise plans (checked 23 Oct 2026). To close the gap: upgrade to Pro, or move hosting to a provider whose DPA covers free plans |
| Supabase Inc. | Processor: database, file storage, realtime | All stored data | eu-central-1 (Frankfurt). **DPA: in place.** Supabase's DPA is part of its Terms of Service and applies to every customer without a separate signature; it includes the 2021 EU SCCs (modules 2 and 3) plus UK and Swiss addenda (checked 23 Oct 2026) |
| Google (YouTube) | Third party, only when a YouTube song or video is played | IP address, what is played (youtube-nocookie.com) | USA: Data Privacy Framework |
| GIPHY | Third party | GIF searches (through our server), IP address when GIF pictures load | USA |
| Google Translate, MyMemory | Third party, only on "translate" | The text being translated | USA / EU |
| OpenStreetMap | Third party, event maps | IP address when map tiles load | UK / EU |
| TURN relay (Metered or own) | Processor, only when calls can't connect directly | Encrypted call audio | Depends on the configured server |
| TikTok, Instagram, Spotify, SoundCloud, Vimeo | Third party, only after the user taps "Load" on a link | IP address, their own cookies | Their own terms |

Fonts and the photo-check libraries and models (TensorFlow.js, NSFWJS, MobileNet) are self-hosted. Link preview pages and pictures are fetched by our server, so those sites don't see visitors.

## Technical and organisational security measures (Art. 32)

- HTTPS everywhere. HttpOnly, SameSite session cookies. A CSRF header is required on every write.
- Passwords hashed with scrypt. Per-account lockouts and per-IP limits on log-in, sign-up and reset, shared by all servers (stored in the database).
- Optional 2-step verification with an authenticator app (TOTP). The secret is stored encrypted (AES-256-GCM, key `MFA_KEY`) and each code works only once. Old fixed codes are stored only as hashes. One-time recovery codes are stored hashed.
- The admin panel requires 2-step verification for every admin, and every admin action is kept in a team log for 12 months.
- Uploaded files live in a private storage bucket. They are opened only through LookBlog, which checks whether the viewer may see what the file is attached to (a chat, a post, a story) and then sends a signed link that expires within an hour.
- Password reset needs a recovery code or 2-step code. It never says whether an account exists.
- Content Security Policy. Server-signed realtime events. Uploads limited by type and size. Server-side link fetching blocks private addresses (SSRF).
- Secrets live in environment variables, never in the code. GitHub secret scanning, push protection, Dependabot and CodeQL are on.
- Self-service data export and account deletion.

## Data subject requests

- Requests come in through /contact or Help, or are self-service (Settings: Download my data, Delete account).
- Answer within one month (can be extended by two more months for complex requests, with notice).
- Check identity in proportion to the request (for locked-out accounts: questions only the owner can answer).
- Log each request in the admin panel (support tickets).

## Personal data breaches (Art. 33/34)

- Notify КЗЛД within 72 hours of becoming aware, unless the breach is unlikely to result in a risk to people. Tell the affected people without undue delay if the risk is high.
- Record every breach and the decision, even when no notification is needed: what happened, what data, how many people, what was done.

### Breach log

| Date found | What happened | Data / people affected | Action taken | Notified КЗЛД? Why / why not |
|---|---|---|---|---|
| 2026-10 (folder deployed around 4 Oct) | A local configuration folder containing the Supabase service key (legacy service_role and a secret key), the Vercel CLI login token and the admin setup code was accidentally deployed as a separate Vercel project (".lookblog-vercel", since deleted) | Potentially the whole database: profiles, emails, password hashes, posts, messages. No evidence that anyone used the keys, but it can't be ruled out | **23 Oct 2026:** new Supabase secret key `lookblog_2026_10` put in production and tested. The leaked secret key deleted, legacy anon/service_role keys disabled (all three now return 401). ADMIN_SETUP_CODE removed. The leaked Vercel CLI token no longer exists (the CLI uses a new 8-hour token from 22 Oct). Supabase logs available through the API go back only to 15 Oct and don't include client IPs, so access around the leak date can't be checked | **Pending, the controller decides.** Because the keys gave full access and access can't be ruled out, the cautious choice is to notify КЗЛД now (explaining the delay: the extent wasn't clear until the keys were rotated and the logs checked). If notifying, consider also telling users to change their passwords |
