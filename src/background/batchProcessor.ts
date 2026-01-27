/**
 * Batch Processor Module
 *
 * Provides batch processing with concurrency control:
 * - Promise-based semaphore for parallel request limiting
 * - Batch-based processing (20 links per batch)
 * - Intermediate result storage in chrome.storage.local
 * - Session resume logic after Service Worker restart
 * - Cancellation support with AbortController
 */

import type {
  LinkInfo,
  ValidationResult,
  CheckSession,
  SessionStatus,
  ValidationProgress,
} from '../shared/types.js';
import { validateLink, type ValidatorConfig } from './linkValidator.js';

// =============================================================================
// Constants
// =============================================================================

/** Default number of concurrent requests */
const DEFAULT_CONCURRENCY = 5;

/** Default batch size for processing */
const DEFAULT_BATCH_SIZE = 20;

/** Storage key for current session */
const SESSION_STORAGE_KEY = 'currentSession';

// =============================================================================
// Semaphore Implementation
// =============================================================================

/**
 * Promise-based semaphore for controlling concurrent operations
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  /**
   * Acquire a permit, waiting if necessary
   */
  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  /**
   * Release a permit
   */
  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      next();
    } else {
      this.permits++;
    }
  }

  /**
   * Get current available permits
   */
  get availablePermits(): number {
    return this.permits;
  }
}

// =============================================================================
// Session Storage Functions
// =============================================================================

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Save session to chrome.storage.local
 */
async function saveSession(session: CheckSession): Promise<void> {
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
}

/**
 * Load session from chrome.storage.local
 */
async function loadSession(): Promise<CheckSession | null> {
  const result = await chrome.storage.local.get(SESSION_STORAGE_KEY);
  return result[SESSION_STORAGE_KEY] ?? null;
}

/**
 * Clear session from chrome.storage.local
 */
async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(SESSION_STORAGE_KEY);
}

/**
 * Create a new check session
 */
function createSession(pageUrl: string, links: LinkInfo[]): CheckSession {
  return {
    id: generateSessionId(),
    pageUrl,
    links,
    results: [],
    status: 'checking',
    completedCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
}

// =============================================================================
// Batch Processor Configuration
// =============================================================================

/**
 * Configuration for batch processing
 */
export interface BatchProcessorConfig {
  /** Number of concurrent requests (default: 5) */
  concurrency?: number;
  /** Number of links per batch (default: 20) */
  batchSize?: number;
  /** Timeout per request in milliseconds (default: 10000) */
  timeoutMs?: number;
}

/**
 * Callback for progress updates
 */
export type ProgressCallback = (progress: ValidationProgress) => void;

// =============================================================================
// Batch Processor Class
// =============================================================================

/**
 * Batch processor for link validation with concurrency control
 */
export class BatchProcessor {
  private config: Required<BatchProcessorConfig>;
  private abortController: AbortController | null = null;
  private currentSession: CheckSession | null = null;
  private isRunning = false;
  private progressCallback: ProgressCallback | null = null;

  constructor(config: BatchProcessorConfig = {}) {
    this.config = {
      concurrency: config.concurrency ?? DEFAULT_CONCURRENCY,
      batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
      timeoutMs: config.timeoutMs ?? 10000,
    };
  }

  /**
   * Check if processor is currently running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Get current session
   */
  get session(): CheckSession | null {
    return this.currentSession;
  }

  /**
   * Set progress callback
   */
  onProgress(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Start a new validation session
   */
  async start(
    pageUrl: string,
    links: LinkInfo[]
  ): Promise<ValidationResult[]> {
    if (this.isRunning) {
      throw new Error('Batch processor is already running');
    }

    // Create new session
    this.currentSession = createSession(pageUrl, links);
    this.abortController = new AbortController();
    this.isRunning = true;

    // Save initial session
    await saveSession(this.currentSession);

    try {
      // Process all links
      const results = await this.processLinks(links);

      // Update session as completed
      if (this.currentSession) {
        this.currentSession.status = 'completed';
        this.currentSession.completedAt = new Date().toISOString();
        await saveSession(this.currentSession);
      }

      return results;
    } catch (error) {
      // Handle cancellation
      if (this.abortController?.signal.aborted) {
        if (this.currentSession) {
          this.currentSession.status = 'cancelled';
          await saveSession(this.currentSession);
        }
      }
      throw error;
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  /**
   * Resume a previously interrupted session
   */
  async resume(): Promise<ValidationResult[] | null> {
    if (this.isRunning) {
      throw new Error('Batch processor is already running');
    }

    // Load existing session
    const session = await loadSession();
    if (!session || session.status !== 'checking') {
      return null; // No session to resume
    }

    this.currentSession = session;
    this.abortController = new AbortController();
    this.isRunning = true;

    try {
      // Get remaining links to process
      const remainingLinks = session.links.slice(session.completedCount);

      // Process remaining links
      const newResults = await this.processLinks(remainingLinks);

      // Combine with existing results
      const allResults = [...session.results, ...newResults];

      // Update session as completed
      if (this.currentSession) {
        this.currentSession.status = 'completed';
        this.currentSession.results = allResults;
        this.currentSession.completedAt = new Date().toISOString();
        await saveSession(this.currentSession);
      }

      return allResults;
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        if (this.currentSession) {
          this.currentSession.status = 'cancelled';
          await saveSession(this.currentSession);
        }
      }
      throw error;
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  /**
   * Cancel the current validation
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Clear the current session from storage
   */
  async clearSession(): Promise<void> {
    this.currentSession = null;
    await clearSession();
  }

  /**
   * Get the current session from storage (static method)
   */
  static async getStoredSession(): Promise<CheckSession | null> {
    return loadSession();
  }

  /**
   * Process links with batching and concurrency control
   */
  private async processLinks(links: LinkInfo[]): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    const totalLinks = this.currentSession?.links.length ?? links.length;
    const startIndex = this.currentSession?.completedCount ?? 0;

    // Split into batches
    const batches: LinkInfo[][] = [];
    for (let i = 0; i < links.length; i += this.config.batchSize) {
      batches.push(links.slice(i, i + this.config.batchSize));
    }

    // Process each batch
    for (const batch of batches) {
      if (this.abortController?.signal.aborted) {
        break;
      }

      const batchResults = await this.processBatch(batch, startIndex + results.length, totalLinks);
      results.push(...batchResults);

      // Save intermediate results after each batch
      if (this.currentSession) {
        this.currentSession.results = [
          ...(this.currentSession.results.slice(0, startIndex)),
          ...results,
        ];
        this.currentSession.completedCount = startIndex + results.length;
        await saveSession(this.currentSession);
      }
    }

    return results;
  }

  /**
   * Process a single batch with concurrency control
   */
  private async processBatch(
    batch: LinkInfo[],
    startIndex: number,
    totalLinks: number
  ): Promise<ValidationResult[]> {
    const semaphore = new Semaphore(this.config.concurrency);
    const results: ValidationResult[] = new Array(batch.length);
    let completedInBatch = 0;

    const validatorConfig: ValidatorConfig = {
      timeoutMs: this.config.timeoutMs,
      ...(this.abortController?.signal && { signal: this.abortController.signal }),
    };

    const tasks = batch.map(async (link, index) => {
      // Check for cancellation before acquiring semaphore
      if (this.abortController?.signal.aborted) {
        return;
      }

      await semaphore.acquire();

      try {
        // Check for cancellation after acquiring semaphore
        if (this.abortController?.signal.aborted) {
          return;
        }

        const result = await validateLink(link, validatorConfig);
        results[index] = result;
        completedInBatch++;

        // Report progress
        if (this.progressCallback) {
          const totalCompleted = startIndex + completedInBatch;
          this.progressCallback({
            total: totalLinks,
            completed: totalCompleted,
            current: result,
          });
        }
      } finally {
        semaphore.release();
      }
    });

    await Promise.all(tasks);

    // Filter out undefined results (from cancelled requests)
    return results.filter((r): r is ValidationResult => r !== undefined);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let processorInstance: BatchProcessor | null = null;

/**
 * Get or create the BatchProcessor singleton
 */
export function getBatchProcessor(config?: BatchProcessorConfig): BatchProcessor {
  if (!processorInstance) {
    processorInstance = new BatchProcessor(config);
  }
  return processorInstance;
}

/**
 * Check if there's a session that can be resumed
 */
export async function hasResumableSession(): Promise<boolean> {
  const session = await loadSession();
  return session !== null && session.status === 'checking';
}

/**
 * Get stored session status
 */
export async function getSessionStatus(): Promise<{
  hasSession: boolean;
  status: SessionStatus | null;
  progress: { completed: number; total: number } | null;
}> {
  const session = await loadSession();
  if (!session) {
    return { hasSession: false, status: null, progress: null };
  }

  return {
    hasSession: true,
    status: session.status,
    progress: {
      completed: session.completedCount,
      total: session.links.length,
    },
  };
}
