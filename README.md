<h1 align="center">Orus</h1>

<p align="center">
  A health dashboard for two people.<br>
  Sleep, food, strength training and running in one dark, quiet iPhone app.
</p>

<p align="center">
  <img alt="iOS" src="https://img.shields.io/badge/iOS-000000?style=flat-square&logo=apple&logoColor=white">
  <img alt="Expo SDK 57" src="https://img.shields.io/badge/Expo-SDK%2057-000000?style=flat-square&logo=expo&logoColor=white">
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-000000?style=flat-square&logo=supabase&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-000000?style=flat-square&logo=typescript&logoColor=white">
</p>

---

My girlfriend and I both track a lot of things: sleep, runs, gym sessions, what we eat. That data was spread across Apple Health, Garmin Connect, Strava and a couple of food apps, and none of them let us look at each other's week without sending screenshots.

So I built one app for the two of us. It reads from the places our data already lives, adds proper food analysis from a photo, talks directly to a cheap smart ring over Bluetooth, and shows everything in the same calm, monochrome layout.

It's a personal project, not a product. I'm sharing it in case the ideas or the code are useful to someone.

## What's in it

| | |
|---|---|
| **Today** | A readiness score built from last night's sleep, HRV, resting heart rate, skin temperature and recent training load. Every input is listed underneath, so you can see why the number is what it is. |
| **Food** | Snap a photo or describe the meal. You get calories and macros, 25 micronutrients, how processed the food is, how many different plants you ate, glycemic load, omega balance and sodium. A body map scores gut, digestion, metabolism, hormones and heart health from your recent meals and suggests foods for the gaps. |
| **Strength** | Log sets, reps and weight as you train. Tracks estimated one-rep max, volume and weekly sets per muscle group. |
| **Running** | Record runs with the phone's GPS and the ring's heart rate, or let them sync in from Apple Health or Strava. Heart rate zones, splits, fitness and fatigue, race predictions and a goal (say, a sub 20 minute 5K) with a weekly plan that works toward it. |
| **Guided runs** | Any recommended session can be started as a workout. A voice tells you when to run, when to recover, and when you're going too fast on a threshold run. |
| **Calendar** | Every run, gym session and workout on one monthly view. |
| **Us** | Both of you side by side: readiness, sleep, food, training and running for the week. |
| **Ring** | Connects straight to a Colmi R09 for live heart rate, HRV, SpO2, skin temperature and sleep, without the vendor's app. |

## A few design choices

**No colour.** Everything is black, white and shades of grey. Brighter means more. It keeps the screens calm and makes the numbers easy to read at a glance.

**The AI reads, the code decides.** OpenAI looks at meal photos and writes a short summary after a run. Every score (readiness, body systems, zones, training load, race predictions) comes from plain TypeScript with unit tests, so it gives the same answer every time and you can read how it was calculated.

**Works with what you have.** No ring? Heart rate comes from Apple Health instead. Run with a Garmin? The run syncs in with its route and heart rate. Missing data just drops out of a score rather than breaking it.

**Private to the two of you.** Your data is visible to you and the one person you invite with a code, and nobody else. That's enforced in the database with row level security, not only in the app.

## Built with

- [Expo](https://expo.dev) and React Native, written in TypeScript
- [Supabase](https://supabase.com) for Postgres, auth, storage, realtime and edge functions
- Apple HealthKit, the Strava API and Bluetooth Low Energy
- OpenAI vision for meal photos and run summaries

```
app/          screens (expo-router)
components/   UI kit, charts and screen layouts
lib/          data, HealthKit sync, food scoring, running maths, ring decoder
supabase/     database migrations and edge functions
docs/         setup guide and internals
```

## Trying it yourself

You'll need an iPhone, a free Supabase project and an OpenAI API key. You don't need a Mac or a paid Apple developer account: a GitHub Action builds the app, and [Sideloadly](https://sideloadly.io) installs it with a normal Apple ID.

1. Create a Supabase project, then push the database and deploy the functions:
   ```bash
   supabase link --project-ref <your-project-ref>
   supabase db push
   supabase secrets set OPENAI_API_KEY=sk-...
   supabase functions deploy
   ```
2. Copy `.env.example` to `.env` and add your Supabase URL and anon key.
3. Try it in Expo Go with `npm install` and `npm run start:go`. Food, gym, running and sharing all work there.
4. For Apple Health, the ring and background GPS, build the app in GitHub Actions and install it with Sideloadly.

The [setup guide](docs/SETUP.md) walks through each step in detail, including Garmin, Strava and the ring.

## Status

Orus is built for two people, one ring model and my own habits, so expect rough edges. The ring decoder comes from public research into the Colmi protocol and hasn't been tested against a real R09 yet.
