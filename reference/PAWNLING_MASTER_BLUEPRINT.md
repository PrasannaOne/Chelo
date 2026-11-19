# PAWNLING — Master Blueprint, Architecture & Complete Reference
**Created for:** Prasanna (`prasannaone.github.io`)  
**Project Name:** **Pawnling** *(Raise a clueless baby chess bot into a global monster)*

---

## 1. Executive Summary & Core Hook
**Pawnling** is a zero-install, offline-first "Tamagotchi Chess" web game hosted for free on **GitHub Pages** with an optional **Cloudflare Workers + D1 SQLite** global arena.

### Why This Project Stands Out
* **What Exists Today:** Standard browser chess bots (`Stockfish`, `chess-ai`, `Weakfish`) are static—they play the exact same way on Game 1 as on Game 100. Heavy human-like bots (`Maia Chess`, `Noctie`) require massive pre-trained neural networks and cloud servers.
* **The Pawnling Gap:** Every player hatches a clueless "baby" chess bot (`200 Elo`) that initially thinks a Pawn (`1.0`) and a Queen (`1.3`) are worth almost the same. It lives inside the player's browser (`localStorage`), learns directly from *their* games offline, copies their favorite openings, stops falling for their traps, and visibly evolves its piece values after every match.
* **The Online "Monster Arena":** Whenever the player goes online, they can claim a unique `@pet_name` handle (protected by an optional 8-digit PIN) and share a `?bot=pet_name` link so strangers around the world can fight their Pawnling and push it up the global leaderboard.

---

## 2. The 3-Layer Self-Learning Brain (`brain.js`)
Instead of heavy neural networks, Pawnling uses three fast, pure-JavaScript learning layers stored in a compact JSON object:

| Layer | Game Phase | How It Works | What the Player Sees |
| :--- | :--- | :--- | :--- |
| **1. Habit Mirroring** | **Moves 1–6 (Opening)** | Records the human player's moves in each simplified FEN position (`mirrorCount`) and gives the bot a % chance to play the user's favorite openings back at them. | *"Apprentice Mode"* — The bot starts copying your exact opening repertoire. |
| **2. FEN Trap Memory** | **Moves 1–12 (Traps)** | Stores simplified FEN strings + move scores. Winning moves gain `+15`; losing moves lose `-20`; draws gain `+2`. | *"Trap Memory"* — Refuses to fall for Scholar's Mate or your favorite traps twice. |
| **3. Genetic Piece Values** | **Entire Game (Minimax)** | Starts with `P:100, N:110, B:110, R:120, Q:130`. After every loss, weights mutate and nudge toward true chess material values (`100, 320, 330, 500, 900`). | *"Live IQ / Material Bars"* — Players physically watch the Queen bar climb from `1.3` toward `9.0` over 10–20 games. |

### Storage Size & Memory Cap (Why It Never Bloats)
* **Per-Bot Size:** Piece weights take ~100 bytes. Each memorized board state takes ~50 bytes.
* **Hard LRU Cap (`MAX_POSITIONS = 1000`):** Once a bot memorizes 1,000 board positions (~50 KB total), `pruneMemory()` automatically forgets the oldest, least-used position whenever a new one is learned. Even after 50,000 games, a maxed-out 4000-Elo monster bot stays under **50 KB**.

---

## 3. Cloud Backend: Why Cloudflare D1 (and How to Use All 5 GB)
* **Why D1 Beats KV:**
  * **KV Free Tier:** Only allows **1,000 writes/day** (breaks during a small traffic spike) and cannot sort leaderboards in SQL.
  * **D1 Free Tier:** Gives **100,000 row writes/day**, **5,000,000 row reads/day**, and **5 GB total storage** (up to 10 databases of 500 MB each, with a 2 MB per-row cap).
* **Capacity Math:** At ~50 KB per maxed-out bot, a single 500 MB D1 database holds **10,000+ veteran bots** (or **50,000+ casual bots**) for **₹0**. And if you ever fill DB #1, your Worker can shard new bots across `DB_2` through `DB_10` to utilize the full 5 GB free tier.

---

## 4. Zero-Account Security & Anti-Cheat Architecture
* **Unique Pet Handle (`pet_name`):** Lowercase unique primary key (e.g., `@pawn_eater`). Used in share links (`?bot=pawn_eater`).
* **Non-Unique Trainer Name (`trainer_name`):** Any display name the player wants (no uniqueness friction).
* **Optional 8-Digit PIN (`X-Pin-Hash`):**
  * Hashed inside the browser via Web Crypto (`SHA-256`) before being sent to the Cloudflare Worker.
  * Cached locally in `localStorage` so the owner never re-types it on their own phone—only when recovering their pet on a new device.
* **Anti-Griefing on Shared Links:**
  * When a stranger visits `?bot=pawn_eater`, they play against a read-only copy of that bot's brain in their browser.
  * Strangers **cannot** call `/sync` to overwrite the owner's brain with garbage moves.
  * Instead, finished challenge matches hit `POST /challenge`, sending the game's **PGN move list**. The Worker verifies the match length and outcome, updates public Elo/wins/losses, and rate-limits repeated Elo farming from the same IP/challenger.

---

## 5. Visual Design & Asset Options
1. **Zero-Image Unicode + Retro Styling (Included in Starter Kit):** Uses standard chess Unicode characters (`♔♕♖♗♘♙` / `♚♛♜♝♞♟`) styled with high-contrast shadows and 4 built-in handheld themes (**Classic Handheld**, **Game Boy DMG Green**, **Amber CRT**, **Midnight OLED**).
2. **Open-Source SVG Set (Optional Upgrade):** Drop in the free Creative Commons Lichess/Wikimedia piece SVGs from `cm-chessboard` or `chessboardjs`.
3. **Custom Pixel Art Spritesheet (Signature Look):** Draw 16x16 or 32x32 pixel pieces (with tiny eyes on the Pawns!) in Piskel or Aseprite.

---

## 6. Monetization, Pricing Ladder & Financial Roadmap
* **100% Ad-Free:** Keeps the retro Tamagotchi handheld aesthetic clean and cozy.
* **Pricing Ladder ("Pawnling Nursery Pro"):**
  * **Free Tier:** 1 Pawnling slot, full offline play, full online D1 Arena access, `.json` Soul export/import.
  * **Monthly Nursery Pass:** **$3.99 / month** (~$3.30 net after processor fees).
  * **Annual Nursery Pass:** **$24.99 / year** (~48% savings vs. monthly).
  * **Founder's 5-Year Pass (One-Time):** **$49.99** (Guaranteed 5 years of full Pro access, plus free extensions as long as Pawnling stays online—giving subscription-haters a one-time buy without infinite legal liability).
  * **Regional Pricing (PPP):** Enable Purchasing Power Parity so Indian players automatically see friendly local pricing (e.g., ₹149/mo or ₹1,499 one-time via UPI/cards) while global players pay USD.
* **What Pro Unlocks:**
  1. **5 Pawnling Slots (The Nursery):** Raise 5 bots with different personalities simultaneously.
  2. **Bot-vs-Bot Sparring Mode:** Pit two of your own Pawnlings against each other locally at 10x speed to auto-evolve them.
  3. **Custom Handheld Shells & Board Palettes:** Game Boy Green, Amber CRT, Midnight OLED.
  4. **Golden Crown Badge:** Displayed next to `@pet_name` on the global leaderboard.
* **Payment Provider Note (2026+):** Because Lemon Squeezy is sunsetting in March 2027, use **Dodo Payments** (supports Indian bank payouts, UPI, global cards, PPP, and built-in License Keys with 5-year expiration rules) or **Polar.sh** / **Paddle**.
* **Revenue & Reinvestment Targets:**
  * **Phase 1 Goal (~₹40,000/month / ~$475/mo):** Reached at just **~110–120 active subscribers** (or ~80 subscribers + 5 one-time passes/month).
  * **Stretch Independence Goal (~₹2.5 Lakh/month / ~$2,500/mo):** Reached at **~500 monthly subscribers + ~20 annual/one-time buyers/month**.
  * **Reinvestment Plan:** Custom domain (`pawnling.gg` or `pawnling.app` via Cloudflare Registrar for ~₹1,000/yr), top-tier AI coding subscriptions, studio hardware upgrade, and eventually hiring a part-time junior dev on a small retainer for maintenance.

---

## 7. Step-by-Step Build & Launch Roadmap
1. **Step 1 — Play & Tune Locally (`index.html` + `brain.js` + `app.js`):**
   * Open `index.html` in any browser (or push the folder to GitHub Pages).
   * Play 5–10 games against your baby Pawnling, test the **SparBots (Auto-Train)** button, and watch the live piece-value bars (`P, N, B, R, Q`) and IQ meter evolve.
2. **Step 2 — Deploy the Free Cloudflare D1 Arena (`worker/`):**
   * In Cloudflare Dashboard -> **Workers & Pages** -> **D1 SQL Database**, create a database named `pawnling-db`.
   * Paste and run `worker/schema.sql` in the D1 Console.
   * Create a Cloudflare Worker, bind `pawnling-db` to variable name `DB`, and paste `worker/index.js`.
   * Copy your Worker URL into `sync.js` (`API_BASE_URL`).
3. **Step 3 — Launch & Share:**
   * Post on Hacker News (`Show HN: Pawnling – An offline-first Tamagotchi chess bot in pure JS that learns from your games`), `r/chess`, and `r/IndieGaming`.
   * Share your own trained `@pet_name` link and dare players to beat it!
