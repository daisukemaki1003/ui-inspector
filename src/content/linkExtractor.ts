/**
 * Link Extractor Module
 *
 * Extracts all link elements from the current page DOM:
 * - <a href="..."> anchor links
 * - <img src="..."> image sources
 * - <link href="..."> stylesheets and other linked resources
 * - <script src="..."> external scripts
 *
 * Features:
 * - Assigns unique data-lc-id attributes for robust element identification
 * - Converts relative URLs to absolute URLs
 * - Filters out invalid schemes (javascript:, mailto:, data:, etc.)
 * - Extracts text content or alt attributes for display
 */

import type { LinkInfo, LinkTagName } from '../shared/types.js';

// =============================================================================
// Constants
// =============================================================================

/** Data attribute name for element identification */
const DATA_ATTRIBUTE = 'data-lc-id';

/** Schemes to exclude from link checking */
const EXCLUDED_SCHEMES = new Set([
  'javascript:',
  'mailto:',
  'tel:',
  'data:',
  'blob:',
  'about:',
  'chrome:',
  'chrome-extension:',
  'moz-extension:',
  'file:',
]);

/** Counter for generating unique element IDs */
let elementIdCounter = 0;

// =============================================================================
// URL Utilities
// =============================================================================

/**
 * Check if a URL scheme should be excluded
 * @param url - The URL to check
 * @returns true if the URL should be excluded
 */
function hasExcludedScheme(url: string): boolean {
  const lowerUrl = url.toLowerCase().trim();
  for (const scheme of EXCLUDED_SCHEMES) {
    if (lowerUrl.startsWith(scheme)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a URL is valid and can be checked
 * @param url - The URL to validate
 * @returns true if the URL is valid for checking
 */
function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl === '' || trimmedUrl === '#') {
    return false;
  }

  if (hasExcludedScheme(trimmedUrl)) {
    return false;
  }

  // Try to parse as URL
  try {
    // Use URL constructor to validate
    new URL(trimmedUrl, window.location.href);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a URL to absolute URL
 * @param url - The URL (may be relative)
 * @returns The absolute URL, or null if invalid
 */
function toAbsoluteUrl(url: string): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const trimmedUrl = url.trim();
  if (trimmedUrl === '' || trimmedUrl === '#') {
    return null;
  }

  try {
    const absoluteUrl = new URL(trimmedUrl, window.location.href);
    return absoluteUrl.href;
  } catch {
    return null;
  }
}

// =============================================================================
// Element ID Management
// =============================================================================

/**
 * Generate a unique element ID
 * @returns A unique ID string
 */
function generateElementId(): string {
  elementIdCounter += 1;
  return `lc-${Date.now()}-${elementIdCounter}`;
}

/**
 * Get or assign an element ID
 * @param element - The HTML element
 * @returns The element's unique ID
 */
function getOrAssignElementId(element: HTMLElement): string {
  const existingId = element.getAttribute(DATA_ATTRIBUTE);
  if (existingId) {
    return existingId;
  }

  const newId = generateElementId();
  element.setAttribute(DATA_ATTRIBUTE, newId);
  return newId;
}

// =============================================================================
// Text Extraction
// =============================================================================

/**
 * Get display text for an element
 * @param element - The HTML element
 * @param tagName - The tag name of the element
 * @returns The display text or null
 */
function getElementText(element: HTMLElement, tagName: LinkTagName): string | null {
  switch (tagName) {
    case 'A': {
      // Get text content, trimmed and limited
      const text = element.textContent?.trim() ?? null;
      if (text && text.length > 0) {
        return text.length > 100 ? text.substring(0, 100) + '...' : text;
      }
      // Fall back to title attribute
      return element.getAttribute('title') ?? null;
    }

    case 'IMG': {
      // Get alt text
      const alt = element.getAttribute('alt')?.trim() ?? null;
      if (alt && alt.length > 0) {
        return alt;
      }
      // Fall back to title attribute
      return element.getAttribute('title') ?? null;
    }

    case 'LINK': {
      // Get rel attribute as description
      const rel = element.getAttribute('rel')?.trim() ?? null;
      return rel ?? 'stylesheet';
    }

    case 'SCRIPT': {
      // Scripts don't have meaningful text, use filename
      const src = element.getAttribute('src');
      if (src) {
        try {
          const url = new URL(src, window.location.href);
          const pathname = url.pathname;
          const filename = pathname.split('/').pop();
          return filename ?? 'script';
        } catch {
          return 'script';
        }
      }
      return 'script';
    }

    default:
      return null;
  }
}

// =============================================================================
// Link Extraction
// =============================================================================

/**
 * Extract link info from an anchor element
 * @param element - The anchor element
 * @returns LinkInfo or null if invalid
 */
function extractFromAnchor(element: HTMLAnchorElement): LinkInfo | null {
  const href = element.getAttribute('href');
  if (!href || !isValidUrl(href)) {
    return null;
  }

  const absoluteUrl = toAbsoluteUrl(href);
  if (!absoluteUrl) {
    return null;
  }

  return {
    url: absoluteUrl,
    tagName: 'A',
    text: getElementText(element, 'A'),
    elementId: getOrAssignElementId(element),
  };
}

/**
 * Extract link info from an image element
 * @param element - The image element
 * @returns LinkInfo or null if invalid
 */
function extractFromImage(element: HTMLImageElement): LinkInfo | null {
  const src = element.getAttribute('src');
  if (!src || !isValidUrl(src)) {
    return null;
  }

  const absoluteUrl = toAbsoluteUrl(src);
  if (!absoluteUrl) {
    return null;
  }

  return {
    url: absoluteUrl,
    tagName: 'IMG',
    text: getElementText(element, 'IMG'),
    elementId: getOrAssignElementId(element),
  };
}

/**
 * Extract link info from a link element
 * @param element - The link element
 * @returns LinkInfo or null if invalid
 */
function extractFromLink(element: HTMLLinkElement): LinkInfo | null {
  const href = element.getAttribute('href');
  if (!href || !isValidUrl(href)) {
    return null;
  }

  const absoluteUrl = toAbsoluteUrl(href);
  if (!absoluteUrl) {
    return null;
  }

  return {
    url: absoluteUrl,
    tagName: 'LINK',
    text: getElementText(element, 'LINK'),
    elementId: getOrAssignElementId(element),
  };
}

/**
 * Extract link info from a script element
 * @param element - The script element
 * @returns LinkInfo or null if invalid
 */
function extractFromScript(element: HTMLScriptElement): LinkInfo | null {
  const src = element.getAttribute('src');
  if (!src || !isValidUrl(src)) {
    return null;
  }

  const absoluteUrl = toAbsoluteUrl(src);
  if (!absoluteUrl) {
    return null;
  }

  return {
    url: absoluteUrl,
    tagName: 'SCRIPT',
    text: getElementText(element, 'SCRIPT'),
    elementId: getOrAssignElementId(element),
  };
}

// =============================================================================
// Main Export
// =============================================================================

/**
 * Extract all links from the current page
 * @returns Array of LinkInfo objects
 */
export function extractLinks(): LinkInfo[] {
  const links: LinkInfo[] = [];
  const seenUrls = new Set<string>();

  // Extract from anchor elements
  const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href]');
  for (const anchor of anchors) {
    const linkInfo = extractFromAnchor(anchor);
    if (linkInfo && !seenUrls.has(linkInfo.url)) {
      seenUrls.add(linkInfo.url);
      links.push(linkInfo);
    }
  }

  // Extract from image elements
  const images = document.querySelectorAll<HTMLImageElement>('img[src]');
  for (const img of images) {
    const linkInfo = extractFromImage(img);
    if (linkInfo && !seenUrls.has(linkInfo.url)) {
      seenUrls.add(linkInfo.url);
      links.push(linkInfo);
    }
  }

  // Extract from link elements
  const linkElements = document.querySelectorAll<HTMLLinkElement>('link[href]');
  for (const link of linkElements) {
    const linkInfo = extractFromLink(link);
    if (linkInfo && !seenUrls.has(linkInfo.url)) {
      seenUrls.add(linkInfo.url);
      links.push(linkInfo);
    }
  }

  // Extract from script elements
  const scripts = document.querySelectorAll<HTMLScriptElement>('script[src]');
  for (const script of scripts) {
    const linkInfo = extractFromScript(script);
    if (linkInfo && !seenUrls.has(linkInfo.url)) {
      seenUrls.add(linkInfo.url);
      links.push(linkInfo);
    }
  }

  return links;
}

/**
 * Find an element by its data-lc-id
 * @param elementId - The element ID to find
 * @returns The element or null if not found
 */
export function findElementById(elementId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${DATA_ATTRIBUTE}="${elementId}"]`);
}

/**
 * Clear all data-lc-id attributes from the page
 * Useful for cleanup or re-extraction
 */
export function clearElementIds(): void {
  const elements = document.querySelectorAll(`[${DATA_ATTRIBUTE}]`);
  for (const element of elements) {
    element.removeAttribute(DATA_ATTRIBUTE);
  }
  elementIdCounter = 0;
}
