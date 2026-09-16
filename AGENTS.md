# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Orus conventions

- iOS-only Expo app (SDK 57, expo-router). HealthKit needs a dev build; `lib/health.ts` must keep degrading gracefully in Expo Go.
- Monotone design: never introduce hue. Use tokens from `lib/theme.ts` and components from `components/ui.tsx` / `components/charts.tsx`.
- Every table is read via `can_view(user_id)` (self + circle) and written by owner only. New tables must follow the same RLS pattern in a new migration.
- `lib/nutrients.ts` and `supabase/functions/_shared/nutrients.ts` are two copies of one registry — change both.
- Ring (Colmi R09): the user's own BLE decoder lives in `lib/ring/custom.ts` and only emits `RingEvent`s (`lib/ring/types.ts`, fixed units). Don't parse bytes anywhere else; raw accelerometer/RR data never leaves the phone — upload per-minute rows only. Ring HRV is RMSSD, Apple Health HRV is SDNN: never compare or average them together (`hrv_kind`). `npm run test:ring` after touching `lib/ring/aggregate.ts` or `packet.ts`.
- Scores are deterministic (`_shared/scoring.ts`); the LLM only extracts. Run `npm run test:engine` after touching the engine and `npm run typecheck` after app changes.
