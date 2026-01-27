/**
 * Element Highlighter Module
 *
 * Provides visual highlighting for elements on the page:
 * - Identifies elements by data-lc-id attribute
 * - Scrolls element into view
 * - Applies CSS animation (pulsing outline)
 * - Auto-clears highlight after timeout
 */

import { findElementById } from './linkExtractor.js';

// =============================================================================
// Constants
// =============================================================================

/** CSS class for highlighted elements */
const HIGHLIGHT_CLASS = 'lc-highlight';

/** ID for the injected style element */
const STYLE_ID = 'lc-highlight-styles';

/** Duration in ms before auto-clearing highlight */
const HIGHLIGHT_DURATION = 3000;

/** Highlight outline color */
const HIGHLIGHT_COLOR = '#ff6b6b';

/** Highlight pulse color */
const HIGHLIGHT_PULSE_COLOR = '#ff3333';

// =============================================================================
// State
// =============================================================================

/** Currently highlighted element */
let currentHighlightedElement: HTMLElement | null = null;

/** Timeout for auto-clearing highlight */
let highlightTimeout: ReturnType<typeof setTimeout> | null = null;

// =============================================================================
// Style Management
// =============================================================================

/**
 * Get the CSS styles for highlighting
 */
function getHighlightStyles(): string {
  return `
    .${HIGHLIGHT_CLASS} {
      outline: 3px solid ${HIGHLIGHT_COLOR} !important;
      outline-offset: 2px !important;
      animation: lc-pulse 0.5s ease-in-out 3 !important;
      scroll-margin: 100px !important;
    }

    @keyframes lc-pulse {
      0%, 100% {
        outline-color: ${HIGHLIGHT_COLOR};
        box-shadow: 0 0 0 4px rgba(255, 107, 107, 0.3);
      }
      50% {
        outline-color: ${HIGHLIGHT_PULSE_COLOR};
        box-shadow: 0 0 0 8px rgba(255, 107, 107, 0.5);
      }
    }
  `;
}

/**
 * Inject highlight styles into the page if not already present
 */
function ensureHighlightStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = getHighlightStyles();
  document.head.appendChild(style);
}

/**
 * Remove injected highlight styles from the page
 */
export function removeHighlightStyles(): void {
  const style = document.getElementById(STYLE_ID);
  if (style) {
    style.remove();
  }
}

// =============================================================================
// Highlight Functions
// =============================================================================

/**
 * Highlight an element by its data-lc-id
 * @param elementId - The data-lc-id attribute value
 * @returns true if element was found and highlighted, false otherwise
 */
export function highlightElement(elementId: string): boolean {
  // Clear any existing highlight first
  clearHighlight();

  // Find the element by its ID
  const element = findElementById(elementId);
  if (!element) {
    console.warn(`[Link Checker] Element not found for highlighting: ${elementId}`);
    return false;
  }

  // Ensure styles are available
  ensureHighlightStyles();

  // Apply highlight class
  element.classList.add(HIGHLIGHT_CLASS);
  currentHighlightedElement = element;

  // Scroll element into view with smooth animation
  element.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
    inline: 'nearest',
  });

  // Set timeout to auto-clear highlight
  highlightTimeout = setTimeout(() => {
    clearHighlight();
  }, getHighlightDuration());

  console.log(`[Link Checker] Highlighted element: ${elementId}`);
  return true;
}

/**
 * Clear the current highlight
 */
export function clearHighlight(): void {
  // Clear timeout if pending
  if (highlightTimeout) {
    clearTimeout(highlightTimeout);
    highlightTimeout = null;
  }

  // Remove highlight class from current element
  if (currentHighlightedElement) {
    currentHighlightedElement.classList.remove(HIGHLIGHT_CLASS);
    currentHighlightedElement = null;
  }
}

/**
 * Check if an element is currently highlighted
 * @returns true if an element is highlighted
 */
export function isHighlighting(): boolean {
  return currentHighlightedElement !== null;
}

/**
 * Get the currently highlighted element
 * @returns The highlighted element or null
 */
export function getCurrentHighlightedElement(): HTMLElement | null {
  return currentHighlightedElement;
}

/**
 * Update highlight duration (for testing or customization)
 * Note: Only affects new highlights, not current one
 */
let customDuration: number | null = null;

export function setHighlightDuration(durationMs: number): void {
  customDuration = durationMs;
}

export function resetHighlightDuration(): void {
  customDuration = null;
}

function getHighlightDuration(): number {
  return customDuration ?? HIGHLIGHT_DURATION;
}
