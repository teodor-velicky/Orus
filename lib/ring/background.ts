// Collecting ring data while Orus is closed.
//
// iOS has no always-running background service, so this uses the two openings
// Apple does give:
//
//  1. Bluetooth state restoration (lib/ring/service.ts). The system keeps the
//     ring connection after Orus is closed and relaunches the app in the
//     background when the ring sends something. This is the one that keeps
//     minute-by-minute data flowing.
//  2. A background task (here). iOS runs it when it feels like it, typically
//     every few hours and more often for apps you open daily. Each run
//     connects, pulls whatever the ring stored, uploads, and stops.
//
// Nothing is lost either way: the ring keeps its own history, so an ordinary
// sync catches up on everything since the last one.

import { Platform } from 'react-native'
import * as BackgroundTask from 'expo-background-task'
import * as TaskManager from 'expo-task-manager'
import { isExpoGo } from '../env'
import { backgroundSync } from './service'

export const RING_SYNC_TASK = 'orus-ring-sync'

try {
  if (Platform.OS !== 'web') {
    TaskManager.defineTask(RING_SYNC_TASK, async () => {
      try {
        const result = await backgroundSync()
        return result === 'synced'
          ? BackgroundTask.BackgroundTaskResult.Success
          : BackgroundTask.BackgroundTaskResult.Failed
      } catch (e) {
        console.warn('ring background sync', e)
        return BackgroundTask.BackgroundTaskResult.Failed
      }
    })
  }
} catch (e) {
  console.warn('background task unavailable', e)
}

/** Ask iOS to run the sync periodically. Safe to call on every launch. */
export async function registerRingSync(): Promise<void> {
  if (Platform.OS === 'web' || isExpoGo) return
  try {
    const status = await BackgroundTask.getStatusAsync()
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return
    if (await TaskManager.isTaskRegisteredAsync(RING_SYNC_TASK)) return
    // A floor, not a promise: iOS decides how often it actually runs.
    await BackgroundTask.registerTaskAsync(RING_SYNC_TASK, { minimumInterval: 60 })
  } catch (e) {
    console.warn('could not register ring sync', e)
  }
}

export async function unregisterRingSync(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(RING_SYNC_TASK)) {
      await BackgroundTask.unregisterTaskAsync(RING_SYNC_TASK)
    }
  } catch { /* never registered */ }
}
