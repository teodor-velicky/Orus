import Constants, { ExecutionEnvironment } from 'expo-constants'

/**
 * Running inside the Expo Go app. Native modules that aren't part of Expo Go
 * (HealthKit, Bluetooth) and custom URL schemes (Strava OAuth) are unavailable;
 * everything Supabase-backed — food, gym, sharing — works.
 */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient
