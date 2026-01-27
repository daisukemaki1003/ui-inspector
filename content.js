// src/content/linkExtractor.ts
var DATA_ATTRIBUTE = "data-lc-id";
var EXCLUDED_SCHEMES = /* @__PURE__ */ new Set([
  "javascript:",
  "mailto:",
  "tel:",
  "data:",
  "blob:",
  "about:",
  "chrome:",
  "chrome-extension:",
  "moz-extension:",
  "file:"
]);
var elementIdCounter = 0;
function hasExcludedScheme(url) {
  const lowerUrl = url.toLowerCase().trim();
  for (const scheme of EXCLUDED_SCHEMES) {
    if (lowerUrl.startsWith(scheme)) {
      return true;
    }
  }
  return false;
}
function isValidUrl(url) {
  if (!url || typeof url !== "string") {
    return false;
  }
  const trimmedUrl = url.trim();
  if (trimmedUrl === "" || trimmedUrl === "#") {
    return false;
  }
  if (hasExcludedScheme(trimmedUrl)) {
    return false;
  }
  try {
    new URL(trimmedUrl, window.location.href);
    return true;
  } catch {
    return false;
  }
}
function toAbsoluteUrl(url) {
  if (!url || typeof url !== "string") {
    return null;
  }
  const trimmedUrl = url.trim();
  if (trimmedUrl === "" || trimmedUrl === "#") {
    return null;
  }
  try {
    const absoluteUrl = new URL(trimmedUrl, window.location.href);
    return absoluteUrl.href;
  } catch {
    return null;
  }
}
function generateElementId() {
  elementIdCounter += 1;
  return `lc-${Date.now()}-${elementIdCounter}`;
}
function getOrAssignElementId(element) {
  const existingId = element.getAttribute(DATA_ATTRIBUTE);
  if (existingId) {
    return existingId;
  }
  const newId = generateElementId();
  element.setAttribute(DATA_ATTRIBUTE, newId);
  return newId;
}
function getElementText(element, tagName) {
  switch (tagName) {
    case "A": {
      const text = element.textContent?.trim() ?? null;
      if (text && text.length > 0) {
        return text.length > 100 ? text.substring(0, 100) + "..." : text;
      }
      return element.getAttribute("title") ?? null;
    }
    case "IMG": {
      const alt = element.getAttribute("alt")?.trim() ?? null;
      if (alt && alt.length > 0) {
        return alt;
      }
      return element.getAttribute("title") ?? null;
    }
    case "LINK": {
      const rel = element.getAttribute("rel")?.trim() ?? null;
      return rel ?? "stylesheet";
    }
    case "SCRIPT": {
      const src = element.getAttribute("src");
      if (src) {
        try {
          const url = new URL(src, window.location.href);
          const pathname = url.pathname;
          const filename = pathname.split("/").pop();
          return filename ?? "script";
        } catch {
          return "script";
        }
      }
      return "script";
    }
    default:
      return null;
  }
}
function extractFromAnchor(element) {
  const href = element.getAttribute("href");
  if (!href || !isValidUrl(href)) {
    return null;
  }
  const absoluteUrl = toAbsoluteUrl(href);
  if (!absoluteUrl) {
    return null;
  }
  return {
    url: absoluteUrl,
    tagName: "A",
    text: getElementText(element, "A"),
    elementId: getOrAssignElementId(element)
  };
}
function extractFromImage(element) {
  const src = element.getAttribute("src");
  if (!src || !isValidUrl(src)) {
    return null;
  }
  const absoluteUrl = toAbsoluteUrl(src);
  if (!absoluteUrl) {
    return null;
  }
  return {
    url: absoluteUrl,
    tagName: "IMG",
    text: getElementText(element, "IMG"),
    elementId: getOrAssignElementId(element)
  };
}
function extractFromLink(element) {
  const href = element.getAttribute("href");
  if (!href || !isValidUrl(href)) {
    return null;
  }
  const absoluteUrl = toAbsoluteUrl(href);
  if (!absoluteUrl) {
    return null;
  }
  return {
    url: absoluteUrl,
    tagName: "LINK",
    text: getElementText(element, "LINK"),
    elementId: getOrAssignElementId(element)
  };
}
function extractFromScript(element) {
  const src = element.getAttribute("src");
  if (!src || !isValidUrl(src)) {
    return null;
  }
  const absoluteUrl = toAbsoluteUrl(src);
  if (!absoluteUrl) {
    return null;
  }
  return {
    url: absoluteUrl,
    tagName: "SCRIPT",
    text: getElementText(element, "SCRIPT"),
    elementId: getOrAssignElementId(element)
  };
}
function extractLinks() {
  const links = [];
  const seenUrls = /* @__PURE__ */ new Set();
  const anchors = document.querySelectorAll("a[href]");
  for (const anchor of anchors) {
    const linkInfo = extractFromAnchor(anchor);
    if (linkInfo && !seenUrls.has(linkInfo.url)) {
      seenUrls.add(linkInfo.url);
      links.push(linkInfo);
    }
  }
  const images = document.querySelectorAll("img[src]");
  for (const img of images) {
    const linkInfo = extractFromImage(img);
    if (linkInfo && !seenUrls.has(linkInfo.url)) {
      seenUrls.add(linkInfo.url);
      links.push(linkInfo);
    }
  }
  const linkElements = document.querySelectorAll("link[href]");
  for (const link of linkElements) {
    const linkInfo = extractFromLink(link);
    if (linkInfo && !seenUrls.has(linkInfo.url)) {
      seenUrls.add(linkInfo.url);
      links.push(linkInfo);
    }
  }
  const scripts = document.querySelectorAll("script[src]");
  for (const script of scripts) {
    const linkInfo = extractFromScript(script);
    if (linkInfo && !seenUrls.has(linkInfo.url)) {
      seenUrls.add(linkInfo.url);
      links.push(linkInfo);
    }
  }
  return links;
}
function findElementById(elementId) {
  return document.querySelector(`[${DATA_ATTRIBUTE}="${elementId}"]`);
}
function clearElementIds() {
  const elements = document.querySelectorAll(`[${DATA_ATTRIBUTE}]`);
  for (const element of elements) {
    element.removeAttribute(DATA_ATTRIBUTE);
  }
  elementIdCounter = 0;
}

// src/content/elementHighlighter.ts
var HIGHLIGHT_CLASS = "lc-highlight";
var STYLE_ID = "lc-highlight-styles";
var HIGHLIGHT_DURATION = 3e3;
var HIGHLIGHT_COLOR = "#ff6b6b";
var HIGHLIGHT_PULSE_COLOR = "#ff3333";
var currentHighlightedElement = null;
var highlightTimeout = null;
function getHighlightStyles() {
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
function ensureHighlightStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = getHighlightStyles();
  document.head.appendChild(style);
}
function highlightElement(elementId) {
  clearHighlight();
  const element = findElementById(elementId);
  if (!element) {
    console.warn(`[Link Checker] Element not found for highlighting: ${elementId}`);
    return false;
  }
  ensureHighlightStyles();
  element.classList.add(HIGHLIGHT_CLASS);
  currentHighlightedElement = element;
  element.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "nearest"
  });
  highlightTimeout = setTimeout(() => {
    clearHighlight();
  }, getHighlightDuration());
  console.log(`[Link Checker] Highlighted element: ${elementId}`);
  return true;
}
function clearHighlight() {
  if (highlightTimeout) {
    clearTimeout(highlightTimeout);
    highlightTimeout = null;
  }
  if (currentHighlightedElement) {
    currentHighlightedElement.classList.remove(HIGHLIGHT_CLASS);
    currentHighlightedElement = null;
  }
}
var customDuration = null;
function getHighlightDuration() {
  return customDuration ?? HIGHLIGHT_DURATION;
}

// src/shared/types.ts
function isExtensionMessage(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const msg = value;
  return typeof msg["type"] === "string";
}
function isMessageType(message, type) {
  return message.type === type;
}

// src/content/content.ts
function handleMessage(message, _sender, sendResponse) {
  if (!isExtensionMessage(message)) {
    return false;
  }
  if (isMessageType(message, "EXTRACT_LINKS")) {
    const links = extractLinks();
    console.log(`[Link Checker] Extracted ${links.length} links`);
    sendResponse(links);
    return false;
  }
  if (isMessageType(message, "HIGHLIGHT_ELEMENT")) {
    const { elementId } = message.payload;
    const success = highlightElement(elementId);
    sendResponse({ success });
    return false;
  }
  if (isMessageType(message, "CLEAR_HIGHLIGHT")) {
    clearHighlight();
    sendResponse({ success: true });
    return false;
  }
  return false;
}
function initialize() {
  chrome.runtime.onMessage.addListener(handleMessage);
  console.log("[Link Checker] Content script initialized");
}
initialize();
export {
  clearElementIds,
  clearHighlight,
  extractLinks,
  findElementById,
  highlightElement
};
