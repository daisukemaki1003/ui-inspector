/**
 * Popup UI Entry Point
 *
 * Handles user interactions and displays validation results:
 * - Start/Cancel/Export button actions
 * - Progress bar updates
 * - Summary statistics display
 * - Result list rendering with grouping
 * - State restoration from chrome.storage
 * - Port-based progress streaming
 */

import type {
  PopupPhase,
  ResultFilter,
  ResultSummary,
  ValidationProgress,
  ValidationResult,
  PopupState,
  ExtensionMessage,
} from '../shared/types.js';
import { connectToBackground, isMessageType } from '../shared/messaging.js';

// =============================================================================
// DOM Elements
// =============================================================================

/** Get DOM element by ID with type assertion */
function $(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element not found: ${id}`);
  }
  return element;
}

// Button elements
const startBtn = $('start-btn') as HTMLButtonElement;
const cancelBtn = $('cancel-btn') as HTMLButtonElement;
const exportBtn = $('export-btn') as HTMLButtonElement;

// Section elements
const progressSection = $('progress-section');
const summarySection = $('summary-section');
const filterSection = $('filter-section');
const resultsSection = $('results-section');
const emptyState = $('empty-state');
const errorState = $('error-state');

// Progress elements
const progressBar = $('progress-bar');
const progressCount = $('progress-count');
const progressCurrent = $('progress-current');

// Summary elements
const summaryTotal = $('summary-total');
const summarySuccess = $('summary-success');
const summaryRedirect = $('summary-redirect');
const summaryError = $('summary-error');

// Results elements
const resultsList = $('results-list');
const noResults = $('no-results');
const errorMessage = $('error-message');

// Filter buttons
const filterButtons = document.querySelectorAll<HTMLButtonElement>('.filter-btn');

// =============================================================================
// State
// =============================================================================

let state: PopupState = {
  phase: 'idle',
  progress: null,
  results: [],
  filter: 'all',
  summary: {
    total: 0,
    success: 0,
    redirect: 0,
    error: 0,
  },
};

// Port connection for progress streaming
let portConnection: { port: chrome.runtime.Port; disconnect: () => void } | null = null;

// =============================================================================
// UI Update Functions
// =============================================================================

/**
 * Update the UI based on current state
 */
export function updateUI(): void {
  updateButtons();
  updateSections();
  updateProgress();
  updateSummary();
  updateResults();
}

/**
 * Update button states
 */
function updateButtons(): void {
  switch (state.phase) {
    case 'idle':
      startBtn.disabled = false;
      cancelBtn.disabled = true;
      exportBtn.disabled = true;
      break;
    case 'checking':
      startBtn.disabled = true;
      cancelBtn.disabled = false;
      exportBtn.disabled = true;
      break;
    case 'completed':
      startBtn.disabled = false;
      cancelBtn.disabled = true;
      exportBtn.disabled = state.results.length === 0;
      break;
  }
}

/**
 * Update section visibility
 */
function updateSections(): void {
  // Hide all conditional sections first
  progressSection.classList.add('hidden');
  summarySection.classList.add('hidden');
  filterSection.classList.add('hidden');
  resultsSection.classList.add('hidden');
  emptyState.classList.add('hidden');
  errorState.classList.add('hidden');

  switch (state.phase) {
    case 'idle':
      emptyState.classList.remove('hidden');
      break;
    case 'checking':
      progressSection.classList.remove('hidden');
      break;
    case 'completed':
      summarySection.classList.remove('hidden');
      filterSection.classList.remove('hidden');
      resultsSection.classList.remove('hidden');
      break;
  }
}

/**
 * Update progress display
 */
function updateProgress(): void {
  if (!state.progress) {
    progressBar.style.width = '0%';
    progressCount.textContent = '0 / 0';
    progressCurrent.textContent = '';
    return;
  }

  const { completed, total, current } = state.progress;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  progressBar.style.width = `${percent}%`;
  progressCount.textContent = `${completed} / ${total}`;

  if (current) {
    progressCurrent.textContent = current.url;
  } else {
    progressCurrent.textContent = '';
  }
}

/**
 * Update summary statistics
 */
function updateSummary(): void {
  summaryTotal.textContent = String(state.summary.total);
  summarySuccess.textContent = String(state.summary.success);
  summaryRedirect.textContent = String(state.summary.redirect);
  summaryError.textContent = String(state.summary.error);
}

/**
 * Update filter button states
 */
function updateFilterButtons(): void {
  filterButtons.forEach((btn) => {
    const filter = btn.dataset['filter'] as ResultFilter;
    if (filter === state.filter) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

/**
 * Get filtered results based on current filter
 */
function getFilteredResults(): ValidationResult[] {
  if (state.filter === 'all') {
    return state.results;
  }

  return state.results.filter((result) => {
    switch (state.filter) {
      case 'success':
        return result.statusCategory === 'success';
      case 'redirect':
        return result.statusCategory === 'redirect';
      case 'error':
        return (
          result.statusCategory === 'client_error' ||
          result.statusCategory === 'server_error' ||
          result.statusCategory === 'timeout' ||
          result.statusCategory === 'network_error'
        );
      default:
        return true;
    }
  });
}

/**
 * Sort results by status category (errors first, then redirects, then success)
 */
function sortResultsByStatus(results: ValidationResult[]): ValidationResult[] {
  const categoryOrder: Record<string, number> = {
    client_error: 0,
    server_error: 0,
    timeout: 0,
    network_error: 0,
    redirect: 1,
    success: 2,
  };

  return [...results].sort((a, b) => {
    const orderA = categoryOrder[a.statusCategory] ?? 3;
    const orderB = categoryOrder[b.statusCategory] ?? 3;
    return orderA - orderB;
  });
}

/**
 * Get CSS class for status category
 */
function getStatusClass(category: string): string {
  switch (category) {
    case 'success':
      return 'status-success';
    case 'redirect':
      return 'status-redirect';
    default:
      return 'status-error';
  }
}

/**
 * Get display status text
 */
function getStatusDisplay(result: ValidationResult): string {
  if (result.status !== null) {
    return String(result.status);
  }
  return result.statusCategory === 'timeout' ? 'T/O' : 'ERR';
}

/**
 * Update results list with grouping by status
 */
function updateResults(): void {
  updateFilterButtons();

  const filtered = getFilteredResults();
  const sorted = sortResultsByStatus(filtered);

  // Clear existing results
  resultsList.innerHTML = '';

  if (sorted.length === 0) {
    noResults.classList.remove('hidden');
    return;
  }

  noResults.classList.add('hidden');

  // Render each result
  sorted.forEach((result) => {
    const li = document.createElement('li');
    li.className = 'result-item';
    li.dataset['elementId'] = result.elementId;

    const statusClass = getStatusClass(result.statusCategory);
    const statusDisplay = getStatusDisplay(result);

    li.innerHTML = `
      <span class="result-status ${statusClass}">${statusDisplay}</span>
      <div class="result-content">
        <div class="result-url">${escapeHtml(result.url)}</div>
        ${result.text ? `<div class="result-text">${escapeHtml(result.text)}</div>` : ''}
      </div>
      <span class="result-tag">${result.tagName}</span>
    `;

    resultsList.appendChild(li);
  });
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show error state
 */
export function showError(message: string): void {
  errorMessage.textContent = message;
  emptyState.classList.add('hidden');
  errorState.classList.remove('hidden');
}

/**
 * Hide error state
 */
export function hideError(): void {
  errorState.classList.add('hidden');
}

// =============================================================================
// State Management Functions
// =============================================================================

/**
 * Set phase and update UI
 */
export function setPhase(phase: PopupPhase): void {
  state.phase = phase;
  updateUI();
}

/**
 * Update progress and refresh display
 */
export function setProgress(progress: ValidationProgress): void {
  state.progress = progress;
  updateProgress();
}

/**
 * Set results and calculate summary
 */
export function setResults(results: ValidationResult[]): void {
  state.results = results;
  state.summary = calculateSummary(results);
  updateUI();
}

/**
 * Calculate summary from results
 */
function calculateSummary(results: ValidationResult[]): ResultSummary {
  const summary: ResultSummary = {
    total: results.length,
    success: 0,
    redirect: 0,
    error: 0,
  };

  results.forEach((result) => {
    switch (result.statusCategory) {
      case 'success':
        summary.success++;
        break;
      case 'redirect':
        summary.redirect++;
        break;
      default:
        summary.error++;
        break;
    }
  });

  return summary;
}

/**
 * Set filter and update results
 */
export function setFilter(filter: ResultFilter): void {
  state.filter = filter;
  updateResults();
}

/**
 * Get current state (for debugging/testing)
 */
export function getState(): PopupState {
  return { ...state };
}

// =============================================================================
// Port Connection for Progress Streaming
// =============================================================================

/**
 * Handle messages from the Service Worker via Port
 */
function handlePortMessage(message: ExtensionMessage): void {
  if (isMessageType(message, 'VALIDATION_PROGRESS')) {
    setProgress(message.payload);
    // Ensure we're in checking phase
    if (state.phase !== 'checking') {
      setPhase('checking');
    }
  } else if (isMessageType(message, 'VALIDATION_COMPLETE')) {
    setResults(message.payload);
    setPhase('completed');
  }
}

/**
 * Handle Port disconnection
 */
function handlePortDisconnect(): void {
  console.log('[Popup] Port disconnected');
  portConnection = null;
}

/**
 * Establish Port connection to Service Worker
 */
function connectPort(): void {
  if (portConnection) {
    return; // Already connected
  }

  try {
    portConnection = connectToBackground(handlePortMessage, handlePortDisconnect);
    console.log('[Popup] Port connected');
  } catch (error) {
    console.error('[Popup] Failed to connect port:', error);
  }
}

/**
 * Disconnect Port
 */
function disconnectPort(): void {
  if (portConnection) {
    portConnection.disconnect();
    portConnection = null;
  }
}

// =============================================================================
// State Restoration from chrome.storage
// =============================================================================

/**
 * Restore state from chrome.storage on Popup open
 */
async function restoreState(): Promise<void> {
  try {
    // Try to get stored session state
    const result = await chrome.storage.local.get(['currentSession', 'lastProgress', 'validationResults']);

    const session = result['currentSession'];
    const storedProgress = result['lastProgress'];
    const storedResults = result['validationResults'];

    // Check if there's an active checking session
    if (session && session.status === 'checking') {
      // Session is in progress, set to checking phase
      state.phase = 'checking';
      if (storedProgress?.progress) {
        state.progress = storedProgress.progress;
      }
      connectPort(); // Connect to receive further progress updates
    } else if (session && session.status === 'completed' && session.results) {
      // Session is complete, show results
      state.results = session.results;
      state.summary = calculateSummary(session.results);
      state.phase = 'completed';
    } else if (storedResults && storedResults.length > 0) {
      // Fallback to stored results
      state.results = storedResults;
      state.summary = calculateSummary(storedResults);
      state.phase = 'completed';
    }

    updateUI();
    console.log('[Popup] State restored:', state.phase);
  } catch (error) {
    console.error('[Popup] Failed to restore state:', error);
  }
}

// =============================================================================
// Event Handlers
// =============================================================================

/**
 * Handle start button click
 */
async function handleStartClick(): Promise<void> {
  console.log('[Popup] Start check clicked');
  hideError();
  setPhase('checking');

  // Connect Port for progress streaming
  connectPort();

  // Send START_CHECK message to service worker
  try {
    await chrome.runtime.sendMessage({ type: 'START_CHECK' });
  } catch (error) {
    console.error('[Popup] Failed to start check:', error);
    showError('チェックを開始できませんでした');
    setPhase('idle');
    disconnectPort();
  }
}

/**
 * Handle cancel button click
 */
async function handleCancelClick(): Promise<void> {
  console.log('[Popup] Cancel clicked');

  try {
    await chrome.runtime.sendMessage({ type: 'CANCEL_CHECK' });
    setPhase('idle');
    disconnectPort();
  } catch (error) {
    console.error('[Popup] Failed to cancel:', error);
  }
}

/**
 * Handle export button click
 */
async function handleExportClick(): Promise<void> {
  console.log('[Popup] Export clicked');

  try {
    await chrome.runtime.sendMessage({ type: 'EXPORT_CSV' });
  } catch (error) {
    console.error('[Popup] Failed to export:', error);
    showError('CSVエクスポートに失敗しました');
  }
}

/**
 * Handle filter button click
 */
function handleFilterClick(event: Event): void {
  const button = event.target as HTMLButtonElement;
  const filter = button.dataset['filter'] as ResultFilter;
  if (filter) {
    setFilter(filter);
  }
}

/**
 * Handle result item click (highlight element)
 */
async function handleResultClick(event: Event): Promise<void> {
  const target = event.target as HTMLElement;
  const resultItem = target.closest('.result-item') as HTMLElement | null;

  if (!resultItem) {
    return;
  }

  const elementId = resultItem.dataset['elementId'];
  if (!elementId) {
    return;
  }

  console.log('[Popup] Highlight element:', elementId);

  try {
    await chrome.runtime.sendMessage({
      type: 'HIGHLIGHT_ELEMENT',
      payload: { elementId },
    });
  } catch (error) {
    console.error('[Popup] Failed to highlight:', error);
  }
}

// =============================================================================
// Initialization
// =============================================================================

/**
 * Set up event listeners
 */
function setupEventListeners(): void {
  startBtn.addEventListener('click', handleStartClick);
  cancelBtn.addEventListener('click', handleCancelClick);
  exportBtn.addEventListener('click', handleExportClick);

  filterButtons.forEach((btn) => {
    btn.addEventListener('click', handleFilterClick);
  });

  resultsList.addEventListener('click', handleResultClick);
}

/**
 * Initialize popup
 */
async function initialize(): Promise<void> {
  setupEventListeners();

  // Restore previous state
  await restoreState();

  // If in checking phase, ensure Port is connected
  if (state.phase === 'checking') {
    connectPort();
  }

  console.log('[Popup] Initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initialize().catch(console.error);
  });
} else {
  initialize().catch(console.error);
}

// Export for external access
export { state };
