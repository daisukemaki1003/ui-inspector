/**
 * Service Worker (Background Script) Entry Point
 *
 * Handles:
 * - Message routing between Popup and Content Script
 * - Link validation orchestration
 * - Progress notification via Port API
 * - CSV export
 * - Session state management
 */

import type { LinkInfo, ValidationResult, CheckSession } from '../shared/types.js';
import { createMessageListener, sendToTab, getPortManager } from '../shared/messaging.js';
import { getBatchProcessor } from './batchProcessor.js';
import { getProgressNotifier } from './progressNotifier.js';
import { injectIntoActiveTab, initializeInjector, getActiveTab } from './contentScriptInjector.js';
import { exportToCSV } from './csvExporter.js';

// =============================================================================
// State
// =============================================================================

/** Current validation session */
let currentTabId: number | null = null;
let currentPageUrl: string | null = null;

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize Service Worker
 */
function initialize(): void {
  console.log('[ServiceWorker] Initializing...');

  // Initialize content script injector
  initializeInjector();

  // Initialize port manager
  getPortManager();

  // Initialize progress notifier
  getProgressNotifier();

  // Set up message handlers
  setupMessageHandlers();

  // Check for resumable session
  checkForResumableSession();

  console.log('[ServiceWorker] Initialized');
}

/**
 * Check for a session that can be resumed after Service Worker restart
 */
async function checkForResumableSession(): Promise<void> {
  try {
    const processor = getBatchProcessor();
    const session = await (processor.constructor as typeof import('./batchProcessor.js').BatchProcessor).getStoredSession();

    if (session && session.status === 'checking') {
      console.log('[ServiceWorker] Found resumable session, attempting to resume...');
      // Note: Auto-resume is complex due to tab context loss
      // For now, we preserve the session state for Popup to display
      // User can manually restart if needed
    }
  } catch (error) {
    console.error('[ServiceWorker] Failed to check for resumable session:', error);
  }
}

// =============================================================================
// Message Handlers
// =============================================================================

/**
 * Set up message handlers for all message types
 */
function setupMessageHandlers(): void {
  createMessageListener({
    START_CHECK: handleStartCheck,
    CANCEL_CHECK: handleCancelCheck,
    EXPORT_CSV: handleExportCSV,
    HIGHLIGHT_ELEMENT: handleHighlightElement,
    GET_SESSION: handleGetSession,
  });
}

/**
 * Handle START_CHECK message from Popup
 */
async function handleStartCheck(
  _message: { type: 'START_CHECK' },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): Promise<void> {
  console.log('[ServiceWorker] START_CHECK received');

  try {
    // Inject Content Script into active tab
    const injectionResult = await injectIntoActiveTab();

    if (!injectionResult.success || !injectionResult.tabId) {
      console.error('[ServiceWorker] Failed to inject:', injectionResult.error);
      sendResponse({ success: false, error: injectionResult.error });
      return;
    }

    currentTabId = injectionResult.tabId;
    currentPageUrl = injectionResult.url;

    // Request links from Content Script
    const links = await sendToTab<LinkInfo[]>(currentTabId, { type: 'EXTRACT_LINKS' });

    if (!links || links.length === 0) {
      console.log('[ServiceWorker] No links found on page');
      sendResponse({ success: true, linksFound: 0 });
      return;
    }

    console.log(`[ServiceWorker] Found ${links.length} links`);

    // Start validation
    await startValidation(links, currentPageUrl ?? '');
    sendResponse({ success: true, linksFound: links.length });
  } catch (error) {
    console.error('[ServiceWorker] START_CHECK error:', error);
    sendResponse({ success: false, error: String(error) });
  }
}

/**
 * Handle CANCEL_CHECK message from Popup
 */
function handleCancelCheck(
  _message: { type: 'CANCEL_CHECK' },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): void {
  console.log('[ServiceWorker] CANCEL_CHECK received');

  const processor = getBatchProcessor();
  processor.cancel();

  const notifier = getProgressNotifier();
  notifier.reportCancelled().catch(console.error);

  sendResponse({ success: true });
}

/**
 * Handle EXPORT_CSV message from Popup
 */
async function handleExportCSV(
  _message: { type: 'EXPORT_CSV' },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): Promise<void> {
  console.log('[ServiceWorker] EXPORT_CSV received');

  try {
    // Get results from storage
    const result = await chrome.storage.local.get(['currentSession', 'validationResults']);
    const session = result['currentSession'] as CheckSession | undefined;
    const storedResults = result['validationResults'] as ValidationResult[] | undefined;

    const results = session?.results ?? storedResults;
    const pageUrl = session?.pageUrl ?? currentPageUrl ?? 'unknown';

    if (!results || results.length === 0) {
      sendResponse({ success: false, error: 'No results to export' });
      return;
    }

    const downloadId = await exportToCSV(results, pageUrl);
    sendResponse({ success: downloadId !== null, downloadId });
  } catch (error) {
    console.error('[ServiceWorker] EXPORT_CSV error:', error);
    sendResponse({ success: false, error: String(error) });
  }
}

/**
 * Handle HIGHLIGHT_ELEMENT message from Popup
 */
async function handleHighlightElement(
  message: { type: 'HIGHLIGHT_ELEMENT'; payload: { elementId: string } },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): Promise<void> {
  console.log('[ServiceWorker] HIGHLIGHT_ELEMENT received:', message.payload.elementId);

  try {
    // Get the active tab (may be different from when check started)
    const tab = await getActiveTab();

    if (!tab || !tab.id) {
      sendResponse({ success: false, error: 'No active tab' });
      return;
    }

    // Ensure Content Script is injected
    const injectionResult = await injectIntoActiveTab();
    if (!injectionResult.success) {
      sendResponse({ success: false, error: 'Cannot inject Content Script' });
      return;
    }

    // Send highlight message to Content Script
    const result = await sendToTab<{ success: boolean }>(tab.id, {
      type: 'HIGHLIGHT_ELEMENT',
      payload: { elementId: message.payload.elementId },
    });

    sendResponse(result ?? { success: false });
  } catch (error) {
    console.error('[ServiceWorker] HIGHLIGHT_ELEMENT error:', error);
    sendResponse({ success: false, error: String(error) });
  }
}

/**
 * Handle GET_SESSION message from Popup
 */
async function handleGetSession(
  _message: { type: 'GET_SESSION' },
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): Promise<void> {
  try {
    const result = await chrome.storage.local.get('currentSession');
    const session = result['currentSession'] as CheckSession | null;
    sendResponse({ session });
  } catch (error) {
    console.error('[ServiceWorker] GET_SESSION error:', error);
    sendResponse({ session: null });
  }
}

// =============================================================================
// Validation Flow
// =============================================================================

/**
 * Start link validation process
 */
async function startValidation(links: LinkInfo[], pageUrl: string): Promise<void> {
  const processor = getBatchProcessor();
  const notifier = getProgressNotifier();

  // Set up progress callback
  processor.onProgress((progress) => {
    notifier.reportProgress(progress).catch(console.error);
  });

  try {
    console.log(`[ServiceWorker] Starting validation of ${links.length} links`);

    // Start batch processing
    const results = await processor.start(pageUrl, links);

    console.log(`[ServiceWorker] Validation complete: ${results.length} results`);

    // Report completion
    await notifier.reportComplete(results);
  } catch (error) {
    console.error('[ServiceWorker] Validation error:', error);

    // If cancelled, the processor handles the state
    if (processor.session?.status === 'cancelled') {
      await notifier.reportCancelled();
    }
  }
}

// =============================================================================
// Service Worker Lifecycle
// =============================================================================

// Initialize when Service Worker starts
initialize();

// Handle Service Worker install
self.addEventListener('install', () => {
  console.log('[ServiceWorker] Installed');
});

// Handle Service Worker activate
self.addEventListener('activate', () => {
  console.log('[ServiceWorker] Activated');
});
