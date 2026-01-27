/**
 * Content Script Entry Point
 *
 * Handles DOM operations for the Link Checker extension:
 * - Link extraction from page elements
 * - Element highlighting for result navigation
 *
 * Communicates with Service Worker via chrome.runtime messaging.
 */

import { extractLinks, findElementById, clearElementIds } from './linkExtractor.js';
import { isExtensionMessage, isMessageType } from '../shared/types.js';

// =============================================================================
// Message Handling
// =============================================================================

/**
 * Handle incoming messages from Service Worker or Popup
 */
function handleMessage(
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): boolean {
  if (!isExtensionMessage(message)) {
    return false;
  }

  if (isMessageType(message, 'EXTRACT_LINKS')) {
    // Extract links and send response
    const links = extractLinks();
    console.log(`[Link Checker] Extracted ${links.length} links`);
    sendResponse(links);
    return false; // Synchronous response
  }

  if (isMessageType(message, 'HIGHLIGHT_ELEMENT')) {
    const { elementId } = message.payload;
    highlightElement(elementId);
    sendResponse({ success: true });
    return false;
  }

  if (isMessageType(message, 'CLEAR_HIGHLIGHT')) {
    clearHighlight();
    sendResponse({ success: true });
    return false;
  }

  return false;
}

// =============================================================================
// Highlighting
// =============================================================================

/** Currently highlighted element */
let currentHighlightedElement: HTMLElement | null = null;

/** Timeout for auto-clearing highlight */
let highlightTimeout: ReturnType<typeof setTimeout> | null = null;

/** CSS class for highlighted elements */
const HIGHLIGHT_CLASS = 'lc-highlight';

/** Duration in ms before auto-clearing highlight */
const HIGHLIGHT_DURATION = 3000;

/**
 * Inject highlight styles if not already present
 */
function ensureHighlightStyles(): void {
  const styleId = 'lc-highlight-styles';
  if (document.getElementById(styleId)) {
    return;
  }

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      outline: 3px solid #ff6b6b !important;
      outline-offset: 2px !important;
      animation: lc-pulse 0.5s ease-in-out 3 !important;
      scroll-margin: 100px !important;
    }

    @keyframes lc-pulse {
      0%, 100% {
        outline-color: #ff6b6b;
        box-shadow: 0 0 0 4px rgba(255, 107, 107, 0.3);
      }
      50% {
        outline-color: #ff3333;
        box-shadow: 0 0 0 8px rgba(255, 107, 107, 0.5);
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Highlight an element by its ID
 * @param elementId - The data-lc-id value
 */
function highlightElement(elementId: string): void {
  // Clear any existing highlight
  clearHighlight();

  // Find the element
  const element = findElementById(elementId);
  if (!element) {
    console.warn(`[Link Checker] Element not found: ${elementId}`);
    return;
  }

  // Ensure styles are injected
  ensureHighlightStyles();

  // Add highlight class
  element.classList.add(HIGHLIGHT_CLASS);
  currentHighlightedElement = element;

  // Scroll element into view
  element.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
    inline: 'nearest',
  });

  // Auto-clear after duration
  highlightTimeout = setTimeout(() => {
    clearHighlight();
  }, HIGHLIGHT_DURATION);
}

/**
 * Clear the current highlight
 */
function clearHighlight(): void {
  if (highlightTimeout) {
    clearTimeout(highlightTimeout);
    highlightTimeout = null;
  }

  if (currentHighlightedElement) {
    currentHighlightedElement.classList.remove(HIGHLIGHT_CLASS);
    currentHighlightedElement = null;
  }
}

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize the content script
 */
function initialize(): void {
  // Register message listener
  chrome.runtime.onMessage.addListener(handleMessage);

  console.log('[Link Checker] Content script initialized');
}

// Initialize when script loads
initialize();

// Export for testing
export { extractLinks, findElementById, clearElementIds, highlightElement, clearHighlight };
