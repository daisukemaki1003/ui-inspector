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
import { highlightElement, clearHighlight } from './elementHighlighter.js';
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
    const success = highlightElement(elementId);
    sendResponse({ success });
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

// Export for testing and external access
export { extractLinks, findElementById, clearElementIds, highlightElement, clearHighlight };
