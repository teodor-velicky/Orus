# Orus: setup and internals

The full guide: Supabase, Expo Go, sideloading, Garmin, Strava, the ring decoder, running maths and development notes. For what Orus is, see the [README](../README.md).

## What's inside

| Area | What it does |
|---|---|
| **Today** | Readiness score (sleep vs goal, HRV and resting HR vs your 28-day baseline, skin temperature, training load), sleep, heart, activity, nutrition (the calorie target grows with the day's running) and training at a glance |
| **Food** | Meal logging from photos or a text description. The food-analysis engine is ported from Somata: macros, 25 micronutrients (with sex-specific daily targets), NOVA processing level, plant species, fermented foods, FODMAP load, gut irritants, glycemic load, omega-6:3 ratio, sodium/potassium ranges and additives. Also 5 body-system scores, gap-filling food suggestions and symptom↔food pattern detection |
| **Train** | Two modes. **Strength:** gym sessions with exercises, weight × reps × sets, warm-up sets, previous-performance hints, estimated 1RM (e1RM), volume and weekly sets per muscle. **Running:** GPS runs recorded on the phone with ring heart rate (or imported from Apple Health / Strava), heart-rate zones, splits, fitness and form, VDOT paces, a race goal with a predicted time, a weekly plan that adapts to readiness, and an optional AI run analysis. A monthly calendar shows every training activity |
| **Us** | You and your partner side by side, plus weekly sleep. The person switch on the other tabs opens your partner's full dashboard (read-only) |
| **Ring** | Colmi R09 over Bluetooth with your own decoder: live HR, HRV, SpO₂, skin temperature and motion, history sync, and live sharing with your partner |
| **Sleep / Heart** | Hypnogram, sleep stages, bedtime consistency and per-source selection; trends for resting HR, HRV (ring and Apple Health values kept separate), skin-temperature deviation, weight, SpO₂ and VO₂max |

### Architecture

```
iPhone ─┬─ Colmi R09 ─BLE─► lib/ring (decoder → minutes → days) ───┐
        ├─ Apple Health (Watch, scale, iPhone steps) ─► lib/health.ts ┤
        ├─ Phone GPS + ring HR ─► lib/run (recorder → runs) ────────┤
        ├─ Camera → analyze-meal (edge fn, OpenAI vision) ──────────┤
        └─ Strava OAuth → strava (edge fn) ─────────────────────────┤
                                                                     ▼
                         Supabase Postgres (RLS: you + your circle)
                         compute-system-scores (deterministic engine)
```

* Data is readable by you and the people in your **circle**, and writable only by its owner. This is enforced with RLS through `can_view()`. You can only join a circle with its invite code.
* The AI only extracts what's on the plate. Body-system scores come from a deterministic, unit-tested engine: `supabase/functions/_shared/scoring.ts`.
* Meal photos live in a private storage bucket that your circle can read.

## Setup

### 1. Supabase

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
supabase secrets set OPENAI_API_KEY=sk-...
supabase functions deploy analyze-meal
supabase functions deploy compute-system-scores
supabase functions deploy strava
supabase functions deploy analyze-run
```

Optionally, pick a different vision model with `supabase secrets set ANALYZE_MODEL=gpt-4.1`.

### 2. App env

Copy `.env.example` to `.env` and fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

### 3. Test in Expo Go (today, no build needed)

Expo Go runs everything Supabase-backed: sign-in, onboarding, the shared space, **food logging and analysis**, body systems, symptom check-ins, **gym logging**, **running** (GPS recording while the app is open, goal, plan, calendar, run analysis), the Us tab and Settings.

Three things need the installed app instead, and the screens say so:

* **Apple Health**, and so Garmin data too
* **Ring Bluetooth**
* **Connecting Strava**, because the `orus://` sign-in redirect doesn't exist inside Expo Go
* **Recording runs with the screen locked.** Expo Go can't use background location, so keep the screen on during test runs

1. **Supabase → Authentication → Sign In / Providers → Email:** turn off **Confirm email**. Otherwise sign-up sends a confirmation link that tries to open localhost. It's just the two of you, so it isn't needed.
2. Install **Expo Go** from the App Store on your iPhone. It must support SDK 57; the current App Store version does.
3. On the PC, from the project folder:

   ```bash
   npm install
   npm run start:go
   ```

   `start:go` matters. `expo-dev-client` is installed, so plain `expo start` would try to open a development build instead of Expo Go.

   If the iPhone can't reach the PC (different Wi-Fi, guest network, firewall), use `npx expo start --go --tunnel`.
4. Scan the QR code with the iPhone Camera app. It opens in Expo Go.
5. Walk through this checklist:
   - [ ] Create account → onboarding → create a shared space → note the invite code
   - [ ] Your girlfriend: Expo Go on her phone → scan the same QR → create account → join with the code
   - [ ] Log a meal from a photo, with and without a description → review → save
   - [ ] Open the meal: components, NOVA, plants, FODMAP, micronutrients, "How it was analyzed"
   - [ ] Food tab: day totals, micronutrient tabs, "Fill the gaps", body systems (confidence rises as meals accumulate)
   - [ ] Check-in (＋ → How do you feel) a few hours after a meal
   - [ ] Gym: ＋ → Gym session → add exercise → weight/reps → tick sets → Finish → Train tab → exercise progress
   - [ ] Running: Train → Running → set a goal (e.g. sub 20:00 5K) → Start run → walk around the block → Pause → Finish → Save → run screen (route, splits) → Analyze run
   - [ ] Guided: Running → Recommended → pick a day → Start this run → listen for the step cues, try Skip and running too fast
   - [ ] Calendar: the run and the gym session show on today's date
   - [ ] Us tab and the person switch: see each other's food and training
6. Errors from the analysis usually show up in **Supabase → Edge Functions → analyze-meal → Logs**. Common causes are a missing `OPENAI_API_KEY` or a function that wasn't deployed.

Expo Go only runs while `npm run start:go` is running on the PC. For a standalone app, sideload it (next section).

### 4. Sideload onto iPhones with Sideloadly (free Apple ID)

This gives you the real app, with Apple Health, Garmin via Health, Bluetooth for the rings, and Strava, without the paid developer program. The catch: **apps signed with a free Apple ID expire after 7 days** and have to be re-signed (Sideloadly can do this automatically).

#### A. Build the `.ipa` (no Mac needed; GitHub builds it)

1. Push this project to a GitHub repository. A private repo is fine.
   - Private repos get a limited number of free macOS minutes.
   - Each build takes roughly 20–40 minutes of runner time.
2. In the repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_STRAVA_CLIENT_ID` (optional)
3. Go to **Actions → "iOS IPA for Sideloadly" → Run workflow**.
4. When the run turns green, open it and download the **Orus-ipa** artifact. Unzip it to get `Orus.ipa`.

If the build fails on the Xcode or macOS image, edit `runs-on` / `xcode-version` in `.github/workflows/ios-sideload.yml`. SDK 57 needs Xcode 26.4 or newer.

#### B. Install with Sideloadly (Windows)

1. Install **iTunes** and **iCloud** from Apple's website, *not* the Microsoft Store versions. Sideloadly needs their device drivers.
2. Install Sideloadly from https://sideloadly.io/#download.
3. Connect the iPhone by USB, unlock it, and tap **Trust This Computer**.
4. In Sideloadly:
   - Drag `Orus.ipa` in.
   - Choose your iPhone.
   - Enter **your Apple ID**. Using a secondary Apple ID is sensible.
   - Click **Start**. Enter the 2FA code if asked.
5. On the iPhone, trust the certificate: **Settings → General → VPN & Device Management → your Apple ID → Trust**.
6. Turn on Developer Mode (iOS 16+): **Settings → Privacy & Security → Developer Mode → On**. The phone restarts; confirm when it comes back.
7. Open Orus → sign in → **Settings → Apple Health → Sync now** and allow all categories.

#### C. Your girlfriend's iPhone

Repeat step B with her phone connected. She can use her own Apple ID, which is recommended because each one has its own limits, or yours.

#### D. Keeping it alive (7-day expiry)

Before the 7 days are up, re-sign the app, or it stops launching. Your data is safe either way: it lives in Supabase, not on the phone.

* **Manual:** open Sideloadly with the phone connected and install the same `.ipa` again. It updates in place.
* **Automatic:** in Sideloadly's advanced options, enable **Automatic app refresh**. Leave Sideloadly running on the PC with the phone on the same Wi-Fi and Wi-Fi sync enabled for the phone in iTunes.

Free Apple ID limits:

* At most 3 sideloaded apps per device.
* About 10 new app IDs per 7 days. Reinstalling the same app doesn't use a new one.

**Updating the app** means running the workflow again and sideloading the new `.ipa` over the old one.

Why this works without the paid program: Apple lists HealthKit and background modes (used for Bluetooth) as available to free Apple accounts. The build requests only the base HealthKit entitlement, and HealthKit background delivery is off, to keep free signing simple. If Sideloadly ever reports an entitlement error, tell me the exact message.

### 5. Garmin (optional)

Garmin has no personal API. Its data reaches Orus through Apple Health and Strava, which Orus already reads:

1. **Garmin Connect** app → **Settings → Connected Apps → Apple Health** → enable writing. Garmin exports steps, sleep, heart rate, workouts and weight to Health. Which types it exports depends on Garmin; check in Apple Health → Browse → Heart / Sleep → Data Sources.
2. For activities with GPS and heart-rate detail, go to **Garmin Connect → Connected Apps → Strava** and connect Strava in Orus. Activities that appear in both Strava and Apple Health are shown once.
3. **Readiness** works with whatever arrives: sleep, resting HR and (if Garmin exports it) HRV. Missing inputs just drop out of the score. Once the rings are paired, ring data takes priority for heart, HRV, SpO₂ and temperature.
4. **Runs** recorded on the Garmin become full runs in Orus. The Apple Health sync imports each running workout with its GPS route and heart-rate samples, and Strava runs come in with their GPS and heart-rate streams. If you record a run in Orus without the ring while wearing the Garmin, open the run and tap **Get heart rate from Apple Health** once Garmin Connect has synced.

### 6. Strava (optional)

1. Create an app at https://www.strava.com/settings/api and set **Authorization Callback Domain** to `orus.app`.
2. Run `supabase secrets set STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=...`
3. Add `EXPO_PUBLIC_STRAVA_CLIENT_ID=...` to `.env`.
4. In the app, go to Settings → Connect Strava. This imports the last 90 days. Pull to refresh or tap Sync for newer activities.

Strava apps start in single-player mode (the owner only). Your partner needs to be added as an athlete in the Strava API settings, or connect Strava through their own Strava app registration.

## Running

Train → **Running**. Everything works without the rings; the ring only adds live heart rate.

**Where a run comes from**

| Source | GPS | Heart rate |
|---|---|---|
| Recorded in Orus (＋ → Record a run, or Start run) | this iPhone | the ring, live (HR-only streaming, no gaps) |
| Recorded in Orus, no ring | this iPhone | pulled from Apple Health on save (Garmin / Apple Watch), or later with **Get heart rate from Apple Health** |
| Garmin / Apple Watch → Apple Health | workout route | heart-rate samples during the workout |
| Strava | GPS stream | heart-rate stream |

If the same run arrives from two sources (for example Orus and Garmin), it appears once, using the copy with the most detail. Running workouts that only have a summary (no route permission, older syncs) still count, as summary-only runs.

**Free run or guided run.** **Free run** (the button under the weekly summary, or ＋ → Record a run) has no targets. Every recommended session also has **Start this run**, which opens it as a guided workout; the start screen lets you switch between the workout and a free run.

A guided workout is a list of steps: warm-up, reps, recoveries and cool-down, each measured in distance or time with a target pace. While you run:

* The top panel shows the current step, what's left of it, the target pace, a progress bar and what's next. **Skip** ends a step early.
* **Intervals:** a voice cue and a vibration say "Rep 3 of 5. Go", then "Recover. Easy jog for 2 minutes 30 seconds", with a warning 10 seconds or 100 metres before each change.
* **Threshold, race pace and marathon pace:** "Too fast, ease back to 4:15" or "A bit slow, pick it up", at most every 30 seconds and not in the first 20 seconds of a step.
* **Easy, long and recovery runs:** only too-fast warnings, because running slower is fine.
* The voice can be muted; vibrations stay. Pace comes from GPS averaged over 20 seconds, so short reps settle after a few seconds.
* A guided run is saved with the workout's name and type.

**Recording.** In the sideloaded app, GPS keeps recording with the screen locked (background location; iOS shows the blue location pill). Pauses are cut out of distance, pace and splits. The run is saved on the phone every few seconds, so if iOS kills the app it comes back paused with nothing lost.

**What's computed** (all in `lib/run/`, unit-tested)

* **Heart-rate zones.** Karvonen: 5 zones from max and resting HR. Max HR is estimated as 208 − 0.7 × age (or the highest recent run max, whichever is higher) and resting HR comes from your data. Set exact values in Settings → Heart-rate zones; changing them re-buckets past runs.
* **Per run:** splits per km, the fastest 1K / 5K / 10K / half inside the run, time in zones, TRIMP load, aerobic decoupling, first- vs second-half pace, training effect (Base, Tempo, Threshold, VO₂ max) and calories (heart-rate based when heart rate exists).
* **Fitness.** VDOT (Jack Daniels) from your best effort of the last 8 weeks, giving predicted race times and training paces (easy, marathon, threshold, interval, repetition).
* **Goal.** Pick a distance, target time and race date. Orus shows the status (on track, stretch, long-term), your predicted time now and the goal pace.
* **Recommended runs.** A 7-day plan built from your last 4 weeks of volume (+~8 % a week toward what the goal distance needs), with two key sessions and a long run. For a sub-20 5K that means VO₂ intervals alternating with race-pace 800s, a threshold run and a long run. Today's session changes when readiness is low, form is deep in the red or yesterday was hard.
* **Load.** Runs, gym sessions and other workouts become daily load, giving fitness (42-day), fatigue (7-day) and form. Form is a readiness input, so a big training week lowers readiness.
* **Calories.** 75 % of the day's running calories is added to the food target (as carbs) on Today and Food.

**AI run analysis.** On a run, **Analyze run** sends a compact summary (splits, zones, decoupling, goal, weekly km; never the raw GPS or heart rate) to the `analyze-run` edge function. It returns a headline, observations and next steps, stored on the run. It uses the same `OPENAI_API_KEY` as meal analysis, with a limit of 20 per day; set `RUN_MODEL` to change the model.

**When the rings arrive, check:**

* Start a run with the ring connected: the heart-rate tile updates every few seconds and the zone bar moves.
* Compare a run's average HR with the Garmin on the same run. Optical rings can read low during intervals and fast arm swing; if the gap is large, record interval sessions on the Garmin and let them sync in.

## Smart ring

**Optional.** Every screen works without a ring. Until one is paired, the ring layer doesn't even create the Bluetooth manager, so there's no permission prompt. Pair later from **Settings → Smart ring** (installed app only).

You both wear a **Colmi R09**. Orus talks to it directly over Bluetooth and uses **your own decoder** for the undocumented data, so nothing depends on the QRing app or Apple Health.

```
ring ─notify─► service.ts ─► colmi.ts ─► custom.ts (your decoder) ─► RingEvent[]
                                                                        │
      live.ts (UI) ◄────────────┬───────────────────────────────────────┤
      share.ts ─Realtime─► partner's Us tab (live, not stored)          │
                                └─► aggregate.ts: 1 row/minute ─► ring_minutes
                                                  1 row/day    ─► ring_daily
                                    sleep_segment events       ─► sleep_sessions
```

### Writing the decoder

Implement `lib/ring/custom.ts`. Everything else consumes typed `RingEvent`s (see `lib/ring/types.ts`), so you never touch storage or UI code.

| Emit | Units | Used for |
|---|---|---|
| `hr` | bpm | live HR, per-minute avg/min/max, resting HR (lowest 30-min mean during sleep) |
| `hrv` or `rr` | ms (RMSSD) / RR intervals | nightly HRV and the readiness score; with `rr`, Orus computes RMSSD itself and rejects artifacts |
| `skin_temp` | °C | nightly mean and deviation vs a 14-night median (readiness, illness/cycle signal) |
| `accel` | g, with `hz` | per-minute motion (ENMO, gravity removed) and the live motion chart; raw samples stay on the phone |
| `sleep_segment` | stage + start/end | sleep sessions, hypnogram, stage split |
| `spo2`, `steps`, `battery` | %, step delta, % | vitals, activity, status |

* The decoder hooks are `onConnect`, `historyRequests(since)`, `liveStart`/`liveKeepAlive`/`liveStop`, `decode`, and `attach`/`reset` for multi-step exchanges.
* `decode` returns `null` for packets it doesn't handle, so the built-in parser can take them.

### What `custom.ts` already decodes

This is built from public protocol research (Gadgetbridge, colmi_r02_client, mk590901/colmi-r09-r12, Nosh118). It's covered by `npm run test:ring` using packets built to those layouts, but hasn't been checked against a real R09 yet.

| Data | How | Status |
|---|---|---|
| Heart-rate log | `0x15` per day, 5-min slots | Documented |
| Steps | `0x43` per day, 15-min slots; live `0x73 0x12` totals turned into step deltas | Documented |
| HRV log | `0x39` per day, 30-min slots | Documented |
| SpO₂ history | big-data `0x27`/`0x2a` service, hourly min/max | Documented |
| Sleep + stages | big-data `0x27`: light→core, deep, REM, awake | Documented |
| Live HR / SpO₂ / HRV / **skin temp** | `0x69` kinds 1/3/10/**11**; temp °C = raw/10 + 20 | Documented, temperature observed on an R09 |
| Auto-logging on connect | HR every 5 min, all-day SpO₂ and HRV | Documented |
| Raw motion | `A1 04 04` on, `A1 02` off; `A1 03` packed 12-bit Y/Z/X at 512 LSB/g | **Verify on R09.** The format comes from R02-family firmware; a ring lying still should read about 1 g |
| Skin-temperature **history** | — | **Not documented.** Only live spot readings for now, so nightly temperature depends on the ring being connected. To find the record type, log unknown big-data frames (see the TODO in `decodeBigData`) |

**History sync:** requests run one at a time, because a response doesn't say which day it's for. The order is activity → HR → SpO₂ → sleep → HRV, going back up to 7 days. A step that goes silent for 10 seconds is skipped, since older firmware ignores some requests.

**Live mode:** the ring runs one optical measurement at a time, so live mode rotates HR 90 s → temp 30 s → HRV 45 s → SpO₂ 35 s while raw motion streams.

### Live heart rate comes from the beat stream

On the R09 firmware we have, the documented heart-rate channel (`0x69` kind `0x01`) replies with all zeros forever. Kind `0x0a` instead streams every heartbeat: bytes 6-7 are the last beat-to-beat interval in milliseconds (little endian), around twice a second, with each frame repeated. Orus reads live heart rate from the median of the last 8 intervals and HRV (RMSSD) from the intervals themselves, and live mode rotates beats → temperature → SpO₂. Frames captured from a real ring are in `lib/ring/__tests__/custom.test.ts`.

### Raw motion and the beat stream cannot run together

Sending `a1 04 04` (raw motion on) also starts the ring’s raw optical producers, and while those run the beat stream on kind `0x0a` returns only zeros: no live heart rate, no HRV. `LIVE_RAW_MOTION` in `lib/ring/custom.ts` is therefore off. Turn it on only when you are deliberately working on the accelerometer, and expect heart rate to stop while it is on.

### Things to know

* **One connection at a time.** Force-quit QRing, or unpair the ring from it, before pairing in Orus.
* **HRV kinds are never mixed.** Ring HRV (RMSSD) and Apple Watch HRV (SDNN) are different measures. Readiness only compares like with like.
* **Merging with Apple Health.** Ring rollups override Apple Health for heart, HRV, SpO₂ and temperature. Steps take the larger count.
* **Sleep sources.** If a watch also records the night, choose the preferred sleep source on the Sleep screen.
* **Background.** The ring stores its history on-device. Orus connects whenever the app is open, pulls history since the last sync, and only streams live data while the Ring screen is visible. This keeps battery drain low. The Bluetooth background mode is enabled so the upload can finish after you leave the app.
* **Live sharing** uses a private Realtime channel per circle (RLS on `realtime.messages`). It sends at most one message every 5 seconds, and only while you've switched sharing on.

## Development

```bash
npm run typecheck
npm run test:engine
npm run test:ring
npm run test:run
```

`test:run` covers guided-workout steps and pace alerts, GPS distance, pauses, splits, best efforts, route simplification, HR zones, TRIMP, VDOT, goal assessment, the weekly plan and training load. `test:ring` covers the ring's packet framing, per-minute aggregation, RMSSD calculation and daily rollups. `test:engine` runs the scoring and correlation engine tests with node, using Git Bash on Windows.

### Map

```
app/(tabs)/        today · food · train (strength + running) · together
app/run/           record (live GPS run) · [id] (run detail) · app/run-goal.tsx
app/               log-meal · meal/[id] · system/[id] · symptoms · sleep · heart
                   session/[id] · exercises · exercise/[id] · settings · add · onboarding · sign-in
components/        ui.tsx (kit) · charts.tsx (monotone viz) · MealAnalysisView.tsx
app/ring.tsx       pairing, live vitals, partner sharing
lib/ring/          types (event contract) · custom (YOUR decoder) · colmi · packet
                   service (BLE + upload) · aggregate (minutes/days) · live · share
lib/               health (HealthKit sync) · meals · metrics (readiness, ring merge) · gym · strava
                   nutrients (keep in sync with supabase/functions/_shared/nutrients.ts)
lib/run/           geo (GPS math) · zones · plan (VDOT, goal, weekly plan) · workout (guided steps) · load · kcal: pure, tested
                   cues (voice + haptics)
                   training (derive, dedupe, load events) · recorder (GPS + ring) · data (Supabase)
                   model · detail · goalModel (view models) · analysis (insights + LLM summary)
components/run.tsx RouteMap · ZoneBars · ZoneStrip · HrZoneChart · SplitsTable · PlanStrip · MonthCalendar
supabase/          migrations · functions/{analyze-meal, analyze-run, compute-system-scores, strava, _shared}
```

### Design rules

* **Mono panels.** The structure follows Bevel: centered headers and heroes, gauges, rounded raised panels, dense tiles and smooth charts. There's no hue anywhere. Hierarchy comes from luminance, weight and space, and data intensity is white at varying opacity (`ink()`).
* **Type.** Geist for everything, with tabular numerals. Geist Mono is only for small uppercase labels and units.
* **Components.**
  * `components/ui.tsx` (kit): `Card`/`Panel`, `Tile`, `Header`, centered `Label`, `Stat`, `Segmented`, `PersonSwitch`, and so on.
  * `components/charts.tsx`: `Gauge`, `Ring`, `MiniRing`, `Donut`, `AreaChart`, `Bars`, `Sparkline`, `RangeBar`, `WeekStrip`, `Hypnogram`, `StackBar`.
* **Views.** Main screens are split into a presentational view (`components/views/*View.tsx`) and a data container (`app/...`).

### Design preview (no account needed)

```bash
npm run preview
```

Open `http://localhost:8081/preview?screen=today` in a browser narrowed to phone width (DevTools device mode).

* Other screens: `food`, `food-empty`, `sleep`, `heart`, `train`, `train-run`, `run`, `run-ready`, `run-live`, `run-workout`, `run-guided`, `run-summary`, `run-goal`, `together`, `meal`, `settings`, `log`, `log-analyzing`, `exercises`.
* They render with sample data from `lib/demo.ts`.
* The route only exists in development builds.
