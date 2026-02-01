/**
 * Link Checker Extension - Shared Type Definitions
 *
 * This file contains all shared types used across the extension components:
 * - Popup UI
 * - Service Worker (Background)
 * - Content Script
 */

// =============================================================================
// Link Information Types
// =============================================================================

/** Supported HTML tag names for link extraction */
export type LinkTagName = 'A' | 'IMG' | 'LINK' | 'SCRIPT';

/** Information about a link extracted from the page DOM */
export interface LinkInfo {
  /** The absolute URL of the link */
  url: string;
  /** The HTML tag type that contained this link */
  tagName: LinkTagName;
  /** The text content or alt attribute of the element */
  text: string | null;
  /** Unique identifier for the element (data-lc-id attribute value) */
  elementId: string;
}

// =============================================================================
// Validation Result Types
// =============================================================================

/** Categories for HTTP status codes and error conditions */
export type StatusCategory =
  | 'success'       // 2xx responses
  | 'redirect'      // 3xx responses
  | 'client_error'  // 4xx responses
  | 'server_error'  // 5xx responses
  | 'timeout'       // Request timed out
  | 'network_error'; // Network/connection error

/** Result of validating a single link */
export interface ValidationResult {
  /** The URL that was validated */
  url: string;
  /** HTTP status code (null if request failed) */
  status: number | null;
  /** Categorized status for UI grouping */
  statusCategory: StatusCategory;
  /** Human-readable status description */
  statusText: string;
  /** The HTML tag type of the source element */
  tagName: string;
  /** The text content or alt attribute */
  text: string | null;
  /** Unique identifier for the element */
  elementId: string;
  /** ISO 8601 timestamp when the check was performed */
  checkedAt: string;
}

/** Progress information during validation */
export interface ValidationProgress {
  /** Total number of links to validate */
  total: number;
  /** Number of links already validated */
  completed: number;
  /** The most recently completed validation result */
  current: ValidationResult | null;
}

// =============================================================================
// Message Types for Component Communication
// =============================================================================

/** Message to start link checking */
export interface StartCheckMessage {
  type: 'START_CHECK';
}

/** Message to cancel ongoing check */
export interface CancelCheckMessage {
  type: 'CANCEL_CHECK';
}

/** Message to request link extraction from content script */
export interface ExtractLinksMessage {
  type: 'EXTRACT_LINKS';
}

/** Message containing extracted links */
export interface LinksExtractedMessage {
  type: 'LINKS_EXTRACTED';
  payload: LinkInfo[];
}

/** Message with validation progress update */
export interface ValidationProgressMessage {
  type: 'VALIDATION_PROGRESS';
  payload: ValidationProgress;
}

/** Message indicating validation is complete */
export interface ValidationCompleteMessage {
  type: 'VALIDATION_COMPLETE';
  payload: ValidationResult[];
}

/** Message to highlight an element on the page */
export interface HighlightElementMessage {
  type: 'HIGHLIGHT_ELEMENT';
  payload: {
    elementId: string;
  };
}

/** Message to clear element highlight */
export interface ClearHighlightMessage {
  type: 'CLEAR_HIGHLIGHT';
}

/** Message to export results as CSV */
export interface ExportCsvMessage {
  type: 'EXPORT_CSV';
}

/** Message to get current session state */
export interface GetSessionMessage {
  type: 'GET_SESSION';
}

/** Response with current session state */
export interface SessionStateMessage {
  type: 'SESSION_STATE';
  payload: CheckSession | null;
}

/** Union type of all possible messages */
export type ExtensionMessage =
  | StartCheckMessage
  | CancelCheckMessage
  | ExtractLinksMessage
  | LinksExtractedMessage
  | ValidationProgressMessage
  | ValidationCompleteMessage
  | HighlightElementMessage
  | ClearHighlightMessage
  | ExportCsvMessage
  | GetSessionMessage
  | SessionStateMessage;

// =============================================================================
// State Types
// =============================================================================

/** Current phase of the popup UI */
export type PopupPhase = 'idle' | 'checking' | 'completed';

/** Filter options for result display by status */
export type ResultFilter = 'all' | 'success' | 'redirect' | 'error';

/** Filter options for result display by tag type */
export type TagFilter = 'all' | 'A' | 'IMG' | 'LINK' | 'SCRIPT';

/** Summary statistics for validation results */
export interface ResultSummary {
  /** Total number of links checked */
  total: number;
  /** Number of successful links (2xx) */
  success: number;
  /** Number of redirected links (3xx) */
  redirect: number;
  /** Number of error links (4xx, 5xx, timeout, network_error) */
  error: number;
}

/** State of the popup UI */
export interface PopupState {
  /** Current phase of the check process */
  phase: PopupPhase;
  /** Current progress (null when idle) */
  progress: ValidationProgress | null;
  /** All validation results */
  results: ValidationResult[];
  /** Current status filter selection */
  filter: ResultFilter;
  /** Current tag type filter selection */
  tagFilter: TagFilter;
  /** Summary statistics */
  summary: ResultSummary;
}

// =============================================================================
// Storage Types
// =============================================================================

/** Status of a check session */
export type SessionStatus = 'checking' | 'completed' | 'cancelled';

/** A check session stored in chrome.storage.local */
export interface CheckSession {
  /** Unique session identifier */
  id: string;
  /** URL of the page being checked */
  pageUrl: string;
  /** All extracted links */
  links: LinkInfo[];
  /** Validation results (may be partial if in progress) */
  results: ValidationResult[];
  /** Current session status */
  status: SessionStatus;
  /** Number of completed validations */
  completedCount: number;
  /** ISO 8601 timestamp when session started */
  startedAt: string;
  /** ISO 8601 timestamp when session completed (null if in progress) */
  completedAt: string | null;
}

/** Schema for chrome.storage.local */
export interface StorageSchema {
  /** Current active session (null if none) */
  currentSession: CheckSession | null;
}

// =============================================================================
// Type Guards
// =============================================================================

/** Type guard for ExtensionMessage */
export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const msg = value as Record<string, unknown>;
  return typeof msg['type'] === 'string';
}

/** Type guard for specific message types */
export function isMessageType<T extends ExtensionMessage['type']>(
  message: ExtensionMessage,
  type: T
): message is Extract<ExtensionMessage, { type: T }> {
  return message.type === type;
}
