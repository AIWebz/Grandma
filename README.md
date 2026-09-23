<p align="center"><img src="assets/logo/grandma.png" alt="Grandma AI" width="200"></p>

<h1 align="center">Grandma AI</h1>

<p align="center"><strong>Grandma helps you take care of life.</strong></p>

Grandma AI is a mobile-first AI assistant with a warm, practical, slightly sassy grandmotherly personality. The chat is the center of the app, and Grandma can **act** as well as talk. She creates recipes, saves them, builds grocery lists, adds chores and reminders, plans your day, remembers your preferences, and helps you preserve family recipes.

Grandma's AI engine runs **entirely inside the web page**. There's nothing to install and no API key. The browser downloads an open AI model once, keeps it, and runs it on the device's graphics chip (WebGPU) or, on phones and tablets without that, on the processor, so it works on iPhones, iPads, and Android too. After that Grandma works offline, and conversations never leave the device.

It is plain **HTML, CSS, and vanilla JavaScript**. There is no Node.js, npm, `package.json`, bundler, or build step. You can edit the files directly on GitHub and host them on any static host, including GitHub Pages.

---

## Contents

1. [What's in the box](#whats-in-the-box)
2. [Project structure](#project-structure)
3. [Run the application](#1-run-the-application)
4. [Deploy it from GitHub](#2-deploy-it-from-github)
5. [Configure the AI API](#3-configure-the-ai-api)
6. [Configure authentication](#4-configure-authentication-and-sync)
7. [Configure ads](#5-configure-ads)
8. [Configure subscriptions](#6-configure-subscriptions)
9. [Package for iOS](#7-package-the-application-for-ios)
10. [Package for Android](#8-package-the-application-for-android)
11. [Notifications](#notifications)
12. [Security](#security)
13. [Customizing Grandma](#customizing-grandma)

---

## What's in the box

| Area | What it does |
| --- | --- |
| **Chat** | A modern AI chat with a welcome/home state (greeting, today's progress, prompt cards), clean message layout, auto-growing input (Enter sends, Shift+Enter adds a new line), photo attachments, voice input, copy and read-aloud, a stop button, retry on errors, and searchable, renamable conversations. |
| **Actions** | Grandma uses tool calling to change real app data: `add_tasks`, `update_tasks`, `add_grocery_items`, `update_grocery_items`, `create_recipe`, `scale_recipe`, `save_recipe`, `add_recipe_to_grocery`, `plan_day`, `remember`, `forget`. Each action shows a live card in the chat. You can tick off tasks and groceries right from the conversation. |
| **Recipes** | 18 built-in traditional recipes across Breakfast, Dinner, Desserts, Baking, Comfort Food, Southern, Italian, Mexican, and American Classics, plus any recipes Grandma generates. Includes search, categories, save, double/halve (units scale too), add to grocery list, Grandma's Tips, and full-screen **Start Cooking** mode with step timers, a screen wake lock, read-aloud, and "ask Grandma" mid-recipe. |
| **Tasks** | Today, Upcoming, and Completed tabs. Eight categories, due dates and times, daily/weekly/monthly repeats, reminders, drag-to-reorder, edit, and delete with undo. |
| **Grocery List** | Grouped into Produce, Meat, Dairy, Pantry, and Other. Add, check, uncheck, remove, clear completed, and share. |
| **Planner** | A day timeline Grandma can build and rearrange, with manual editing and **Plan My Day With Grandma**. |
| **Our Family Cookbook ❤️** | Typed recipes, stories, notes, and photos. Snap a handwritten recipe card and Grandma transcribes it into ingredients, steps, servings, and time. The original photo is always kept. |
| **Memory** | Grandma remembers useful preferences, such as "doesn't like onions". You can view, edit, and delete memories in Settings, or turn memory off. |
| **Personality** | Warm & Caring, Funny & Playful, Calm & Gentle, or Practical & Direct. The tone changes; the safety rules never do. |
| **Voice** | Speak to Grandma, and hear her reply (Grandma+). Hands-free back-and-forth works when you start by voice. |
| **Plans** | Free, Grandma+ ($7.99/mo), and Grandma Pro ($14.99/mo), with a Monthly/Yearly toggle (yearly saves 20%: $76.70/yr and $143.90/yr). Restore Purchases, plus links to the Terms and Privacy Policy. |
| **Ads** | Free plan only, never inside the conversation. Banners appear on selected screens, rare interstitials at page transitions, and rewarded ads are optional. The provider is modular. |
| **Households** (Pro) | A shared grocery list, a shared Family Cookbook, and shared tasks, joined with an invite code. |
| **PWA** | Installable, works offline (except the AI), has app icons, and is ready to wrap for the App Store and Google Play. |

### What works on its own vs. what needs a service

A static site can't safely hold secrets or run server code. This project is honest about that line.

| Feature | Without any setup | Needs |
| --- | --- | --- |
| Tasks, grocery, planner, recipes, cookbook, memory list, settings | ✅ Works, stored on the device (IndexedDB) | — |
| Talking to Grandma (real AI) | ✅ Runs in the browser after a one-time download (0.5–4.5 GB) | Any modern browser, including iPhone/iPad Safari. Optional: a hosted AI proxy |
| Reading handwritten recipes | ✅ In-browser text reading (Tesseract) + Grandma organizes it | Works best with neat handwriting |
| Accounts (email, Google), cloud sync, households | "This device only" mode | **Supabase** (free tier is fine) |
| Daily AI limits per plan | None needed: local AI runs on the person's own computer | Only for the optional hosted proxy |
| Web subscriptions | Buttons say "not set up yet" | **Stripe** Payment Links + the proxy's webhook |
| App Store / Google Play subscriptions | — | Native wrapper + **RevenueCat** (or your own store code) |
| AdMob ads | House ads (self-promotion) | Native wrapper with AdMob |
| Notifications while the app is fully closed | Works while open or installed and running | Native wrapper, or a push service |

---

## Project structure

```
index.html              App shell (sidebar, chat, pages)
style.css               All styles (light + dark, mobile-first)
app.js                  Routing, sidebar, onboarding, sign-in, global handlers
config.js               PUBLIC settings: AI endpoint, Supabase, Stripe links, ads
manifest.webmanifest    PWA manifest
sw.js                   Service worker (offline shell, notification clicks)
terms.html, privacy.html  Legal templates (edit before launch)
js/
  util.js               Helpers, icons, safe markdown, sheets, toasts
  store.js              Local-first data store (IndexedDB) with per-item merge
  account.js            Supabase auth, cloud sync, households, photo storage
  plans.js              Plans, pricing math, limits, purchases, restore
  ai.js                 Grandma's system prompt, tool definitions, request loop
  brain.js              Grandma's in-browser AI engine + the "Turn on Grandma" setup
  brain-worker.js       Runs the engine in a background thread
  actions.js            Tool implementations (tasks, groceries, recipes, plan, memory)
  chat.js               Conversation UI, action cards, composer, voice, retry
  recipe-ui.js          Recipe cards/detail and Start Cooking mode
  voice.js              Web Speech API (or native bridge)
  ads.js                Modular ad provider (house / AdSense / native AdMob)
  notify.js             Friendly notifications scheduler
  views/                Recipes, Tasks, Grocery, Planner, Cookbook, Settings/Profile/Pricing
data/recipes.js         Built-in traditional recipes
vendor/web-llm/         WebLLM engine (Apache-2.0): runs on the graphics chip (WebGPU)
vendor/wllama/          wllama engine (MIT, llama.cpp in WebAssembly): runs on the processor — iPhone, iPad, any phone
assets/logo, assets/icons  Grandma artwork, avatar, app icons (192, 512, maskable, Apple touch, 1024)
backend/
  cloudflare-worker.js  Payment/ad webhooks + optional hosted AI (paste into Cloudflare)
  supabase-schema.sql   Database tables, security policies, storage bucket
docs/NATIVE_BRIDGE.md   How an iOS/Android wrapper plugs in AdMob, purchases, voice, notifications
```

> **About `server/`, `mobile/`, `GETTING_STARTED.md`, and `docs/ARCHITECTURE.md`:** these belong to an earlier Node.js/Expo version of Grandma AI. The app in this README doesn't use them. They're kept for reference and can be deleted.

---

## 1. Run the application

Any static file server works. No install step is needed.

```bash
# from the repository folder
python3 -m http.server 8080
# then open http://localhost:8080
```

Other options: VS Code's "Live Server" extension, `php -S localhost:8080`, or `caddy file-server`. You can also double-click `index.html`, but some features (the service worker, installing as an app) need `http://`.

On first open, Grandma asks your name and preferred personality, then opens **Turn on Grandma** (step 3). Everything except the AI works right away, even before setup.

---

## 2. Deploy it from GitHub

**GitHub Pages (free):**

1. Push this repository to GitHub.
2. Go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then pick your branch and `/ (root)`. Save.
3. After a minute your app is live at `https://<you>.github.io/<repo>/`.
4. (Optional) Add a custom domain on the same page and enable **Enforce HTTPS**.

The included `.nojekyll` file tells Pages to serve the files as-is.

**When you ship changes**, bump `VERSION` at the top of `sw.js` (for example `grandma-v2`) so returning visitors get the new files.

Other static hosts work the same way: Cloudflare Pages, Netlify, Vercel (as static), or S3/CloudFront. Point them at the repository root with **no build command**.

> GitHub Pages only serves files. It can't keep secrets or run the payment webhooks; that's the job of the small backend in `backend/cloudflare-worker.js`. Grandma's AI runs inside the browser and needs no server.

---

## 3. Configure the AI API

**There's nothing to configure, nothing to install, and no API key.** Grandma's AI engine is built into the website:

- `vendor/web-llm/` is [WebLLM](https://github.com/mlc-ai/web-llm) (Apache-2.0). It runs open AI models on the device's graphics chip through **WebGPU**. This is the fast path for computers and newer phones.
- `vendor/wllama/` is [wllama](https://github.com/ngxson/wllama) (MIT), which is llama.cpp compiled to WebAssembly. It runs a small model on the device's **processor**, so it needs nothing special from the browser. It works on **every iPhone, iPad, and Android phone**, and on any computer. `vendor/wllama/compat/` is the build that Safari needs, and it's served from your site too.
- Both engines are bundled in the repo as plain files, so there's no CDN and no build step. `js/brain.js` picks the engine, runs it in a background thread so the page stays smooth, and connects it to Grandma's personality and her actions.

**Turning Grandma on.** The first time someone chats, or right after the welcome screen, a **Turn on Grandma** sheet checks the device and offers the brains it can run:

| Choice | Engine | Model | Download |
| --- | --- | --- | --- |
| **Recommended** | graphics chip | Qwen2.5 3B Instruct | about 2 GB |
| **Lighter** (newer phones, older computers) | graphics chip | Qwen2.5 1.5B Instruct | about 1 GB |
| **Smartest** (Grandma Pro, strong graphics card) | graphics chip | Qwen2.5 7B Instruct | about 4.5 GB |
| **Phone** (any iPhone, iPad, Android) | processor | Qwen2.5 0.5B Instruct (GGUF) | about 500 MB |
| **Phone+** (newer iPhones/iPads, computers) | processor | Qwen2.5 1.5B Instruct (GGUF) | about 1.1 GB |

- **No WebGPU** (older iPhones/iPads, older Android, Firefox): the sheet shows only **Phone** and **Phone+**.
- **Phones with WebGPU**: the sheet starts on **Lighter**.
- **Any device**: a "works-anywhere" link reveals the processor versions. If a download runs out of memory, the sheet automatically steps down to a smaller option.

The browser downloads the model once from Hugging Face, with a progress bar, and keeps it in its own storage (the app asks the browser to keep it). On later visits Grandma loads from the device in the background, even offline. You can change the size or remove the download in **Settings → Grandma's AI**.

**How the actions work.** Small on-device models do best with one clear format. Grandma answers in a strict JSON shape, `{"actions": [...], "reply": "..."}`, and the engine enforces that shape while it writes, so the output is always valid JSON. The actions (add tasks, create a recipe, grocery lists, plans, memories) run through the same handlers as everything else in the app, and each one shows a live card in the chat. Unknown action names are ignored.

**Photos.** Recipe cards and attached photos are read in the browser with [Tesseract.js](https://github.com/naptha/tesseract.js), loaded from jsDelivr only when needed. Grandma then organizes the text into ingredients, steps, servings, and time. The original photo is always kept. Neat handwriting and printed cards work best. Grandma can read text in photos, but she can't describe pictures.

**What browsers work.** All modern browsers work:

- **Graphics chip (fast):** Chrome and Edge on Windows, Mac, ChromeOS, and Android, and Safari on iOS 26 / macOS 26 or newer.
- **Processor (everywhere else):** iPhones and iPads on older iOS, Firefox, and other phones. Replies take longer to start there, because a phone's processor reads the prompt more slowly than a graphics chip. To keep them quick:
  - **Several cores.** A page can use more than one processor core only when it's "cross-origin isolated", which needs two response headers that GitHub Pages can't send. Once someone picks a Phone brain, `sw.js` adds `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` to the app's own responses, and the page reloads once to pick them up. Settings shows how many cores are in use. This is skipped when `ads.provider` is `"adsense"`, because ad frames can't load on isolated pages.
  - **A short, fixed prompt.** The Phone brains get a much shorter prompt and seven simple actions. The prompt never changes, so the engine reuses its work from one message to the next. Today's details ride along with the newest message.
  - **Exact output rules.** A grammar allows exactly the answer shape (`{"reply": ..., "actions": [...]}` with each action's real arguments), so a small model can't waste time on stray spaces or invalid actions.
  - **Shorter recipes** on the Phone brains (up to 12 ingredients and 8 steps).

Recipes, tasks, groceries, the planner, and the cookbook work everywhere.

**Trade-offs to know about:**

- The first download is big. The sheet recommends Wi-Fi.
- A small model running on a phone or laptop is slower and less clever than a large cloud model. It may occasionally miss an action or get a detail wrong. The Smartest option helps if the device can handle it.
- It uses the device's memory while running. If a device runs out, the sheet steps down to a smaller option.
- The Phone model (0.5B) is small. It handles chatting, lists, tasks, and reminders well, but its recipes are simpler. Phone+ is noticeably better if the device has the memory.

### Optional: hosted AI

If you, the app owner, would rather serve AI from a big cloud model, deploy `backend/cloudflare-worker.js` (see the comments at the top of that file) and put its URL in `config.js → ai.endpoint`. Your model key stays secret on Cloudflare; users never enter anything. When `ai.endpoint` is set, the app uses the hosted AI instead of the in-browser engine and enforces the plan limits (`LIMIT_FREE`, `LIMIT_PLUS`, `LIMIT_PRO`) through a KV namespace bound as `USAGE`.

---

## 4. Configure authentication and sync

Accounts use [Supabase](https://supabase.com), loaded from a CDN only when configured.

1. Create a Supabase project.
2. Open **SQL Editor**, paste all of `backend/supabase-schema.sql`, and click **Run**. This creates the tables, Row Level Security policies, household functions, account deletion, and a private `media` photo bucket.
3. **Authentication → Providers:**
   - **Email** is on by default. Keep "Confirm email" on.
   - **Google:** create an OAuth client in Google Cloud Console (Web application). Add Supabase's callback URL, shown on the provider page, as an authorized redirect URI. Then paste the client ID and secret into Supabase.
4. **Authentication → URL Configuration:** set **Site URL** to your app URL and add it under **Redirect URLs**.
5. **Project Settings → API:** copy the **Project URL** and the **anon public** key into `config.js`:
   ```js
   supabase: { url: "https://abcd.supabase.co", anonKey: "eyJ...", googleSignIn: true },
   ```
   The anon key is designed to be public. Row Level Security protects the data.
6. Give the worker access so it can read plans and verify users. Add `SUPABASE_URL` as a text variable and `SUPABASE_SERVICE_ROLE_KEY` as a **secret**. The service role key is secret: never put it in `config.js`.
7. Once accounts work, set `REQUIRE_AUTH=true` on the worker so only signed-in users can use the AI.

After sign-in, the app loads the user's conversations, recipes, tasks, grocery lists, preferences, memory, family cookbook, and subscription. Data is local-first: it works offline and syncs when back online. Each item merges separately, so two devices don't overwrite each other. **Delete all my data** in Settings removes cloud data and the account itself, which the App Store requires.

---

## 5. Configure ads

Only Free users see ads. Ads never appear inside Grandma's replies. Set `ads.provider` in `config.js`:

| Provider | Use for | Setup |
| --- | --- | --- |
| `"house"` (default) | Anywhere | Tasteful Grandma+ self-promotion. Needs no ad network. |
| `"adsense"` | The website | Fill `ads.adsense.client` (`ca-pub-…`) and `bannerSlot`, and add an `ads.txt` file to your site root as AdSense instructs. |
| `"native"` | iOS/Android apps | The wrapper shows **AdMob** banners, interstitials, and rewarded ads through `window.GrandmaNative` (see `docs/NATIVE_BRIDGE.md`). |
| `"none"` | — | No ads at all. |

Placement rules are built in (`js/ads.js`):

- Banners appear only on Recipes, Grocery List, and Planner.
- Interstitials appear only when switching sections, never mid-chat, never in the first 3 minutes, and at most once every `interstitialMinutes`.
- Rewarded ads are opt-in ("watch an ad for 5 more messages").

For rewarded ads to raise the *server* limit, set AdMob's server-side verification URL to `https://<worker>/admob/ssv` and pass the user's ID as custom data.

Before launch, complete Google's consent requirements (UMP / GDPR messages) and the app stores' ad disclosures.

---

## 6. Configure subscriptions

### What each plan unlocks

Every benefit on the pricing page is enforced in the app. Limits and perks are defined in one place, `js/plans.js` (`limits` and `perks`), and the **Compare plans in detail** table on the pricing page is generated from those same values.

| | Free | Grandma+ | Pro |
| --- | --- | --- | --- |
| AI messages per day | 25 | 150 | 600 |
| New recipes Grandma writes per day | 3 | 25 | Unlimited |
| Things Grandma remembers | 15 | 150 | Unlimited |
| Saved recipes | 10 | Unlimited | Unlimited |
| Planning horizon | 2 days | 3 days | 31 days |
| Ads | Yes | No | No |
| Personalized recipes (diet, dislikes, household size, skill, cuisines) | Allergies only | ✓ | ✓ |
| One-tap weekly dinner plan (Planner) | — | ✓ | ✓ |
| Grocery list built from the meal plan | — | ✓ | ✓ |
| Repeating tasks | — | ✓ | ✓ |
| Grandma reads replies aloud | — | ✓ | ✓ |
| Accent colors | — | ✓ | ✓ |
| "Plan my whole week" | — | — | ✓ |
| Household routines (daily tidy, weekly reset, laundry, pets, yard, monthly check) | — | — | ✓ |
| Hands-free voice conversation + choosing Grandma's voice and speed | — | — | ✓ |
| Household sharing: tasks, grocery list, Family Cookbook (needs Supabase) | — | — | ✓ |
| Smartest in-browser brain (7B) | — | — | ✓ |
| Labs (suggested replies and other experiments) | — | — | ✓ |

A plan is only granted by a verified purchase: a Stripe webhook, RevenueCat, or the native store bridge. To try every paid feature before billing is set up, set `billing.demoMode: true` in `config.js`. The plan buttons then switch plans instantly with no payment, and the pricing page says demo mode is on. **Turn demo mode off before launch.**


Plans, prices, and features live in `js/plans.js`. The worker enforces limits from the `subscriptions` table, which **only payment webhooks can write**. Nothing the browser does can grant a plan.

### Web (Stripe)

> **Where does my Stripe key go?** Your Stripe **secret key** (`sk_live_…`, or a restricted `rk_live_…` key) goes into **exactly one place**: the Cloudflare Worker that runs `backend/cloudflare-worker.js`, as an **encrypted secret** named `STRIPE_SECRET_KEY`. Set it in **Cloudflare dashboard → Workers → your worker → Settings → Variables and Secrets → Add → Type: Secret**. The webhook signing secret (`whsec_…`) goes there too, as `STRIPE_WEBHOOK_SECRET`.
>
> **Never** put either key in `config.js`, `index.html`, any `js/` file, or anywhere else in this repository. Everything in the repo is public and runs in the browser. `config.js` only holds **public** Payment Link URLs (`https://buy.stripe.com/…`) and the customer-portal link, which are safe to share. The Stripe *publishable* key (`pk_…`) isn't needed at all.

1. In Stripe, create two products: **Grandma+** and **Grandma Pro**. Each gets a monthly price ($7.99 / $14.99) and a yearly price ($76.70 / $143.90).
2. Create a **Payment Link** for each of the 4 prices. In each link's settings, set the confirmation redirect to `https://your-app/?checkout=success#/pricing`.
3. Paste the 4 links into `config.js → billing.stripe.paymentLinks`. The app appends `client_reference_id=<user id>` automatically.
4. Enable the **Customer portal** (Settings → Billing → Customer portal) and paste its link into `billing.stripe.customerPortalUrl` for "Manage subscription".
5. **Developers → Webhooks → Add endpoint:** use `https://<worker>/stripe/webhook` with the events `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
6. Add these to the worker:
   - Secrets: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
   - Variables: `STRIPE_PRICE_PLUS_MONTHLY`, `STRIPE_PRICE_PLUS_YEARLY`, `STRIPE_PRICE_PRO_MONTHLY`, and `STRIPE_PRICE_PRO_YEARLY` (the `price_…` IDs).

### iOS and Android (in-app purchases)

Apple and Google generally require their own billing for digital subscriptions sold inside apps, so the store builds use `billing.provider: "native"`:

1. Create the 4 subscription products in App Store Connect and Google Play Console, using the IDs in `config.js → billing.nativeProducts`.
2. Connect both stores to [RevenueCat](https://www.revenuecat.com). Create entitlements named exactly `plus` and `pro`.
3. In the native wrapper, set RevenueCat's `appUserID` to the Supabase user ID and implement `purchase` and `restorePurchases` (see `docs/NATIVE_BRIDGE.md`).
4. In RevenueCat, add a webhook to `https://<worker>/revenuecat/webhook` with an Authorization header value. Store that same value as the worker secret `REVENUECAT_WEBHOOK_AUTH`.

**Restore Purchases** asks the wrapper to restore and re-reads the plan from the server.

---

## Installing the app (no app store needed)

Grandma is a Progressive Web App, so anyone can install her from the website:

- **Chrome, Edge, Samsung Internet, Android:** a **Get the app** button (in the sidebar, in Settings, and on the phone welcome screen) opens the browser's one-tap install.
- **iPhone / iPad:** the same button shows three steps: **Share → Add to Home Screen → Add**.
- **Mac Safari (macOS 14+):** **File → Add to Dock**.
- **Firefox on computers:** can't install web apps, so the sheet suggests Chrome or Edge.

Once installed, Grandma opens in her own full-screen window, with her own icon on the home screen, dock, or Start menu, and works offline. The button hides itself when she's already running as an installed app. The code lives in `js/install.js`.

For the App Store and Google Play, see the next two sections.

## 7. Package the application for iOS

GitHub hosts your code; it does **not** publish to the App Store. You need an Apple Developer account ($99/yr), a Mac with Xcode, and to follow Apple's review process. None of this uses Node.

**Option A: PWABuilder (quickest)**

1. Deploy the site (step 2) over HTTPS.
2. Go to [pwabuilder.com](https://www.pwabuilder.com), enter your URL, and choose **Package for stores → iOS**. It generates an Xcode project that wraps your site. The packaging runs on their servers, so nothing is installed locally.
3. Open the project in Xcode. Set your **Bundle ID**, **Team** (signing), version, and app icon (use `assets/icons/icon-1024.png`).
4. Add the native bridge (`docs/NATIVE_BRIDGE.md`) for in-app purchases (StoreKit/RevenueCat), AdMob, native speech, and local notifications.
5. **Product → Archive → Distribute App → App Store Connect.** Then fill in the listing, privacy "nutrition labels", and screenshots, and submit.

**Option B: your own WKWebView app.** Create an Xcode "App" project and add a `WKWebView` that loads the bundled files (copy this repo's files into the app) or your HTTPS URL. Then add the same bridge.

**App Review checklist:**

- The app must be more than a website. Voice, notifications, in-app purchase, and offline use help here (guideline 4.2).
- Use in-app purchase for subscriptions (3.1.1).
- Offer in-app account deletion; Settings → Delete all my data does this (5.1.1(v)).
- State that Grandma is an AI and not a medical, legal, or financial professional. The app and `terms.html` already do this.
- Add usage descriptions to `Info.plist`: `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`, `NSCameraUsageDescription`, and `NSPhotoLibraryUsageDescription`.

---

## 8. Package the application for Android

You need a Google Play Console account ($25 one-time). None of this uses Node.

**Option A: PWABuilder → Trusted Web Activity (quickest)**

1. Deploy the site over HTTPS. At [pwabuilder.com](https://www.pwabuilder.com), enter your URL and choose **Package for stores → Android**. Set the package ID (e.g. `com.yourname.grandmaai`).
2. Download the ZIP. It contains a signed **`.aab`**, your **signing key** (back it up somewhere safe; you need it for every update), and an **`assetlinks.json`**.
3. Upload `assetlinks.json` to your site at `/.well-known/assetlinks.json`, so the app opens full-screen without a browser bar. On GitHub Pages this requires a custom domain at the root, or a user/org site (`<you>.github.io`).
4. In Play Console, create the app, upload the `.aab` to a testing track, complete the content rating, **Data safety** form, and ads declaration, then roll out.

A TWA runs your site in Chrome, so it uses web ads (`"adsense"` or `"house"`) rather than AdMob. Selling subscriptions inside it requires Google Play Billing: either implement the Digital Goods API or use Option B.

**Option B: native WebView app.** In Android Studio, create an "Empty Activity" app with a `WebView`, load the bundled files or your HTTPS URL, and add the bridge from `docs/NATIVE_BRIDGE.md`. That gives you AdMob, Play Billing via RevenueCat, native speech, and notifications. Then **Build → Generate Signed App Bundle** and upload the `.aab`.

---

## Notifications

Settings → Notifications lets people choose:

- the overall frequency: off, just reminders, or reminders plus encouragement
- a morning check-in time
- task reminders
- the pre-dinner recipe nudge

Messages sound like Grandma: *"Hey sweetheart ❤️ It's almost dinner time…"*, *"Don't forget about the laundry."*, *"You've only got two things left today. You've got this."*

On the web these fire while the app is open, or installed and running. For delivery while the app is fully closed, the native wrapper schedules local notifications through `GrandmaNative.notify` / `scheduleNotification`. You could also add Web Push with your own push server; that isn't included.

---

## Security

- **No API keys at all for the AI.** Grandma's brain runs inside the browser, so conversations stay on the device.
- **No secrets in the frontend or the repo.** `config.js` holds only public values: the Supabase anon key and payment *links*. The Stripe secret, webhook secrets, and Supabase service role key live only as encrypted Cloudflare secrets.
- The worker only accepts your `ALLOWED_ORIGINS`. It caps request size and output tokens, accepts only custom tools and uploaded images, and prepends safety rules the client can't remove.
- Plans are written only by verified webhooks: a Stripe signature, a RevenueCat auth header, or an AdMob ECDSA signature.
- Supabase Row Level Security limits every row and photo to its owner or household.
- Grandma is told not to store sensitive details (health beyond food allergies and diets, finances, IDs, passwords, addresses). People can review and delete everything she remembers.

---

## Customizing Grandma

- **Personality and rules:** `CORE_PROMPT` and `TONES` in `js/ai.js`. The worker's `SERVER_RULES` in `backend/cloudflare-worker.js` always apply.
- **Actions:** add a tool definition in `js/ai.js` (`TOOLS`) and its handler in `js/actions.js`, and render a card for it in `js/chat.js` (`renderCard`).
- **Plans and prices:** `js/plans.js`. Keep the worker's `LIMIT_*` values in sync.
- **Built-in recipes:** `data/recipes.js`.
- **Colors and type:** the CSS variables at the top of `style.css` (light and dark).
- **Legal pages:** `terms.html` and `privacy.html` are starting templates. Have them reviewed for your business and region before launch.

Grandma AI is an AI assistant with a grandmotherly personality. She isn't a person, isn't anyone's actual grandmother, and isn't a substitute for professional advice.
