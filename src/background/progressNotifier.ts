/**
 * Progress Notifier Module
 *
 * Provides real-time progress notification system:
 * - Port API-based progress streaming to Popup
 * - Progress state persistence in chrome.storage.local
 * - State restoration when Popup reconnects
 * - Validation complete event firing
 */

import type {
  ValidationProgress,
  ValidationResult,
} from '../shared/types.js';
import { getPortManager } from '../shared/messaging.js';

// =============================================================================
// Constants
// =============================================================================

/** Storage key for last progress state */
const PROGRESS_STORAGE_KEY = 'lastProgress';

/** Storage key for validation results */
const RESULTS_STORAGE_KEY = 'validationResults';

// =============================================================================
// Types
// =============================================================================

/**
 * Stored progress state for restoration
 */
interface StoredProgressState {
  /** Current progress */
  progress: ValidationProgress;
  /** Whether validation is complete */
  isComplete: boolean;
  /** Timestamp when last updated */
  updatedAt: string;
}

/**
 * Callbacks for progress notifier events
 */
export interface ProgressNotifierCallbacks {
  /** Called when a Popup connects */
  onPopupConnect?: () => void;
  /** Called when all Popups disconnect */
  onPopupDisconnect?: () => void;
}

// =============================================================================
// Progress Notifier Class
// =============================================================================

/**
 * Progress notification system for link validation
 */
export class ProgressNotifier {
  private portManager = getPortManager();
  private currentProgress: ValidationProgress | null = null;
  private isValidationComplete = false;
  private completedResults: ValidationResult[] = [];
  private callbacks: ProgressNotifierCallbacks = {};

  constructor(callbacks?: ProgressNotifierCallbacks) {
    this.callbacks = callbacks ?? {};
    this.setupPortHandlers();
  }

  /**
   * Set up port connection/disconnection handlers
   */
  private setupPortHandlers(): void {
    this.portManager.onConnect(async (port) => {
      console.log('[ProgressNotifier] Popup connected');

      // Notify callback
      if (this.callbacks.onPopupConnect) {
        this.callbacks.onPopupConnect();
      }

      // Send current state to newly connected Popup
      await this.sendCurrentStateToPort(port);
    });

    this.portManager.onDisconnect(() => {
      console.log('[ProgressNotifier] Popup disconnected');

      // If no more connections, notify callback
      if (!this.portManager.hasConnections && this.callbacks.onPopupDisconnect) {
        this.callbacks.onPopupDisconnect();
      }
    });
  }

  /**
   * Send current state to a specific port
   */
  private async sendCurrentStateToPort(port: chrome.runtime.Port): Promise<void> {
    try {
      // If we have current progress, send it
      if (this.currentProgress) {
        port.postMessage({
          type: 'VALIDATION_PROGRESS',
          payload: this.currentProgress,
        });
      }

      // If validation is complete, send results
      if (this.isValidationComplete && this.completedResults.length > 0) {
        port.postMessage({
          type: 'VALIDATION_COMPLETE',
          payload: this.completedResults,
        });
      } else {
        // Try to restore from storage
        const storedState = await this.loadProgressState();
        if (storedState) {
          if (storedState.progress) {
            port.postMessage({
              type: 'VALIDATION_PROGRESS',
              payload: storedState.progress,
            });
          }
          if (storedState.isComplete) {
            const results = await this.loadResults();
            if (results) {
              port.postMessage({
                type: 'VALIDATION_COMPLETE',
                payload: results,
              });
            }
          }
        }
      }
    } catch (error) {
      console.warn('[ProgressNotifier] Failed to send state to port:', error);
    }
  }

  /**
   * Report validation progress
   */
  async reportProgress(progress: ValidationProgress): Promise<void> {
    this.currentProgress = progress;
    this.isValidationComplete = false;

    // Broadcast to all connected Popups
    this.portManager.sendProgress(progress);

    // Save to storage for restoration
    await this.saveProgressState({
      progress,
      isComplete: false,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Report validation complete
   */
  async reportComplete(results: ValidationResult[]): Promise<void> {
    this.isValidationComplete = true;
    this.completedResults = results;

    // Update progress to show 100%
    if (this.currentProgress) {
      this.currentProgress = {
        ...this.currentProgress,
        completed: this.currentProgress.total,
      };
    }

    // Broadcast to all connected Popups
    this.portManager.sendComplete(results);

    // Save to storage
    await this.saveProgressState({
      progress: this.currentProgress ?? {
        total: results.length,
        completed: results.length,
        current: results[results.length - 1] ?? null,
      },
      isComplete: true,
      updatedAt: new Date().toISOString(),
    });

    await this.saveResults(results);
  }

  /**
   * Report validation cancelled
   */
  async reportCancelled(): Promise<void> {
    // Broadcast cancellation as a progress update with no current
    if (this.currentProgress) {
      this.portManager.broadcast({
        type: 'VALIDATION_PROGRESS',
        payload: {
          ...this.currentProgress,
          current: null,
        },
      });
    }

    // Clear stored state
    await this.clearState();
  }

  /**
   * Reset the notifier state
   */
  async reset(): Promise<void> {
    this.currentProgress = null;
    this.isValidationComplete = false;
    this.completedResults = [];
    await this.clearState();
  }

  /**
   * Check if there are connected Popups
   */
  get hasConnectedPopups(): boolean {
    return this.portManager.hasConnections;
  }

  /**
   * Get the number of connected Popups
   */
  get connectedPopupCount(): number {
    return this.portManager.connectedCount;
  }

  /**
   * Get current progress (may be null)
   */
  get progress(): ValidationProgress | null {
    return this.currentProgress;
  }

  /**
   * Check if validation is complete
   */
  get isComplete(): boolean {
    return this.isValidationComplete;
  }

  // ===========================================================================
  // Storage Functions
  // ===========================================================================

  /**
   * Save progress state to storage
   */
  private async saveProgressState(state: StoredProgressState): Promise<void> {
    try {
      await chrome.storage.local.set({ [PROGRESS_STORAGE_KEY]: state });
    } catch (error) {
      console.warn('[ProgressNotifier] Failed to save progress state:', error);
    }
  }

  /**
   * Load progress state from storage
   */
  private async loadProgressState(): Promise<StoredProgressState | null> {
    try {
      const result = await chrome.storage.local.get(PROGRESS_STORAGE_KEY);
      return result[PROGRESS_STORAGE_KEY] ?? null;
    } catch (error) {
      console.warn('[ProgressNotifier] Failed to load progress state:', error);
      return null;
    }
  }

  /**
   * Save results to storage
   */
  private async saveResults(results: ValidationResult[]): Promise<void> {
    try {
      await chrome.storage.local.set({ [RESULTS_STORAGE_KEY]: results });
    } catch (error) {
      console.warn('[ProgressNotifier] Failed to save results:', error);
    }
  }

  /**
   * Load results from storage
   */
  private async loadResults(): Promise<ValidationResult[] | null> {
    try {
      const result = await chrome.storage.local.get(RESULTS_STORAGE_KEY);
      return result[RESULTS_STORAGE_KEY] ?? null;
    } catch (error) {
      console.warn('[ProgressNotifier] Failed to load results:', error);
      return null;
    }
  }

  /**
   * Clear all stored state
   */
  private async clearState(): Promise<void> {
    try {
      await chrome.storage.local.remove([PROGRESS_STORAGE_KEY, RESULTS_STORAGE_KEY]);
    } catch (error) {
      console.warn('[ProgressNotifier] Failed to clear state:', error);
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let notifierInstance: ProgressNotifier | null = null;

/**
 * Get or create the ProgressNotifier singleton
 */
export function getProgressNotifier(callbacks?: ProgressNotifierCallbacks): ProgressNotifier {
  if (!notifierInstance) {
    notifierInstance = new ProgressNotifier(callbacks);
  }
  return notifierInstance;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a progress callback that reports to the notifier
 */
export function createProgressReporter(
  notifier: ProgressNotifier
): (progress: ValidationProgress) => void {
  return (progress: ValidationProgress) => {
    // Fire and forget - don't await
    notifier.reportProgress(progress).catch((error) => {
      console.warn('[ProgressNotifier] Failed to report progress:', error);
    });
  };
}

/**
 * Get stored validation results (for Popup initialization)
 */
export async function getStoredResults(): Promise<ValidationResult[] | null> {
  try {
    const result = await chrome.storage.local.get(RESULTS_STORAGE_KEY);
    return result[RESULTS_STORAGE_KEY] ?? null;
  } catch (error) {
    console.warn('[ProgressNotifier] Failed to get stored results:', error);
    return null;
  }
}

/**
 * Get stored progress state (for Popup initialization)
 */
export async function getStoredProgress(): Promise<{
  progress: ValidationProgress | null;
  isComplete: boolean;
} | null> {
  try {
    const result = await chrome.storage.local.get(PROGRESS_STORAGE_KEY);
    const state = result[PROGRESS_STORAGE_KEY] as StoredProgressState | undefined;
    if (!state) {
      return null;
    }
    return {
      progress: state.progress,
      isComplete: state.isComplete,
    };
  } catch (error) {
    console.warn('[ProgressNotifier] Failed to get stored progress:', error);
    return null;
  }
}
