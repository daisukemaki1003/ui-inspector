/**
 * Content Script Injector Module
 *
 * Provides on-demand Content Script injection:
 * - Uses chrome.scripting.executeScript for dynamic injection
 * - Tracks injected tabs to prevent duplicate execution
 * - Gets current active tab for script execution
 */

// =============================================================================
// State Management
// =============================================================================

/**
 * In-memory set of tabs where Content Script has been injected
 * Note: This is cleared when Service Worker restarts
 */
const injectedTabs = new Set<number>();

// =============================================================================
// Tab Utilities
// =============================================================================

/**
 * Get the currently active tab
 * @returns The active tab or null if not available
 */
export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/**
 * Check if a URL is injectable (http/https only)
 * @param url - The URL to check
 * @returns true if the URL can have Content Script injected
 */
export function isInjectableUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return url.startsWith('http://') || url.startsWith('https://');
}

// =============================================================================
// Injection Functions
// =============================================================================

/**
 * Check if Content Script is already injected in a tab
 * @param tabId - The tab ID to check
 * @returns true if already injected
 */
export function isInjected(tabId: number): boolean {
  return injectedTabs.has(tabId);
}

/**
 * Mark a tab as having Content Script injected
 * @param tabId - The tab ID to mark
 */
export function markInjected(tabId: number): void {
  injectedTabs.add(tabId);
}

/**
 * Clear injection status for a tab
 * @param tabId - The tab ID to clear
 */
export function clearInjectionStatus(tabId: number): void {
  injectedTabs.delete(tabId);
}

/**
 * Clear all injection status (e.g., on Service Worker restart)
 */
export function clearAllInjectionStatus(): void {
  injectedTabs.clear();
}

/**
 * Inject Content Script into the specified tab
 * Uses chrome.scripting.executeScript for Manifest V3 compliance
 *
 * @param tabId - The tab ID to inject into
 * @returns true if injection was successful
 */
export async function injectContentScript(tabId: number): Promise<boolean> {
  // Check if already injected
  if (injectedTabs.has(tabId)) {
    console.log(`[ContentScriptInjector] Tab ${tabId} already injected, skipping`);
    return true;
  }

  try {
    // Inject the Content Script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });

    // Mark as injected
    injectedTabs.add(tabId);
    console.log(`[ContentScriptInjector] Successfully injected into tab ${tabId}`);
    return true;
  } catch (error) {
    console.error(`[ContentScriptInjector] Failed to inject into tab ${tabId}:`, error);
    return false;
  }
}

/**
 * Inject Content Script into the current active tab
 * @returns Object with success status, tabId, and tab URL
 */
export async function injectIntoActiveTab(): Promise<{
  success: boolean;
  tabId: number | null;
  url: string | null;
  error?: string;
}> {
  // Get the active tab
  const tab = await getActiveTab();

  if (!tab || !tab.id) {
    return {
      success: false,
      tabId: null,
      url: null,
      error: 'No active tab found',
    };
  }

  // Check if URL is injectable
  if (!isInjectableUrl(tab.url)) {
    return {
      success: false,
      tabId: tab.id,
      url: tab.url ?? null,
      error: 'Cannot inject into this page (only http/https pages are supported)',
    };
  }

  // Inject the script
  const success = await injectContentScript(tab.id);

  if (success) {
    return {
      success: true,
      tabId: tab.id,
      url: tab.url ?? null,
    };
  }

  return {
    success: false,
    tabId: tab.id,
    url: tab.url ?? null,
    error: 'Failed to inject Content Script',
  };
}

/**
 * Execute a function in the Content Script context and get results
 * This is useful for extracting links without needing message passing
 *
 * @param tabId - The tab ID to execute in
 * @param func - The function to execute
 * @returns The result of the function execution
 */
export async function executeInContentScript<T>(
  tabId: number,
  func: () => T
): Promise<T | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
    });

    if (results && results.length > 0) {
      return results[0]!.result as T;
    }
    return null;
  } catch (error) {
    console.error(`[ContentScriptInjector] Failed to execute in tab ${tabId}:`, error);
    return null;
  }
}

// =============================================================================
// Tab Event Handlers
// =============================================================================

/**
 * Set up listeners to clear injection status when tabs are updated or removed
 */
export function setupTabListeners(): void {
  // Clear injection status when tab navigates to a new page
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      // Tab is navigating, clear injection status
      clearInjectionStatus(tabId);
    }
  });

  // Clear injection status when tab is closed
  chrome.tabs.onRemoved.addListener((tabId) => {
    clearInjectionStatus(tabId);
  });
}

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the Content Script Injector
 * Call this when Service Worker starts
 */
export function initializeInjector(): void {
  // Clear any stale injection status
  clearAllInjectionStatus();

  // Set up tab listeners
  setupTabListeners();

  console.log('[ContentScriptInjector] Initialized');
}
