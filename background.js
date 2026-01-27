// src/shared/types.ts
function isExtensionMessage(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const msg = value;
  return typeof msg["type"] === "string";
}

// src/shared/messaging.ts
var PROGRESS_PORT_NAME = "link-checker-progress";
async function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("sendToTab error:", chrome.runtime.lastError.message);
        resolve(void 0);
        return;
      }
      resolve(response);
    });
  });
}
function createMessageListener(handlers) {
  const listener = (message, sender, sendResponse) => {
    if (!isExtensionMessage(message)) {
      console.warn("Received invalid message:", message);
      return;
    }
    const handler = handlers[message.type];
    if (!handler) {
      return;
    }
    const result = handler(message, sender, sendResponse);
    if (result instanceof Promise) {
      result.then((response) => sendResponse(response)).catch((error) => {
        console.error("Message handler error:", error);
        sendResponse(void 0);
      });
      return true;
    }
    return result === true;
  };
  chrome.runtime.onMessage.addListener(listener);
  return listener;
}
var PortManager = class {
  ports = /* @__PURE__ */ new Set();
  onConnectHandlers = [];
  onDisconnectHandlers = [];
  constructor() {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== PROGRESS_PORT_NAME) {
        return;
      }
      this.ports.add(port);
      for (const handler of this.onConnectHandlers) {
        handler(port);
      }
      port.onDisconnect.addListener(() => {
        this.ports.delete(port);
        for (const handler of this.onDisconnectHandlers) {
          handler(port);
        }
      });
    });
  }
  /**
   * Add a handler for new port connections
   */
  onConnect(handler) {
    this.onConnectHandlers.push(handler);
  }
  /**
   * Add a handler for port disconnections
   */
  onDisconnect(handler) {
    this.onDisconnectHandlers.push(handler);
  }
  /**
   * Broadcast a message to all connected ports
   */
  broadcast(message) {
    for (const port of this.ports) {
      try {
        port.postMessage(message);
      } catch (error) {
        console.warn("Failed to send message to port:", error);
        this.ports.delete(port);
      }
    }
  }
  /**
   * Send progress update to all connected ports
   */
  sendProgress(progress) {
    this.broadcast({
      type: "VALIDATION_PROGRESS",
      payload: progress
    });
  }
  /**
   * Send validation complete to all connected ports
   */
  sendComplete(results) {
    this.broadcast({
      type: "VALIDATION_COMPLETE",
      payload: results
    });
  }
  /**
   * Get the number of connected ports
   */
  get connectedCount() {
    return this.ports.size;
  }
  /**
   * Check if any ports are connected
   */
  get hasConnections() {
    return this.ports.size > 0;
  }
};
var portManagerInstance = null;
function getPortManager() {
  if (!portManagerInstance) {
    portManagerInstance = new PortManager();
  }
  return portManagerInstance;
}

// src/background/linkValidator.ts
var DEFAULT_TIMEOUT_MS = 1e4;
function classifyStatus(status) {
  if (status === null) {
    return "network_error";
  }
  if (status >= 200 && status < 300) {
    return "success";
  }
  if (status >= 300 && status < 400) {
    return "redirect";
  }
  if (status >= 400 && status < 500) {
    return "client_error";
  }
  if (status >= 500) {
    return "server_error";
  }
  return "network_error";
}
function getStatusText(status, category) {
  if (status !== null) {
    const statusDescriptions = {
      200: "OK",
      201: "Created",
      204: "No Content",
      301: "Moved Permanently",
      302: "Found",
      303: "See Other",
      304: "Not Modified",
      307: "Temporary Redirect",
      308: "Permanent Redirect",
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      405: "Method Not Allowed",
      408: "Request Timeout",
      410: "Gone",
      429: "Too Many Requests",
      500: "Internal Server Error",
      502: "Bad Gateway",
      503: "Service Unavailable",
      504: "Gateway Timeout"
    };
    return statusDescriptions[status] ?? `Status ${status}`;
  }
  switch (category) {
    case "timeout":
      return "Request Timeout";
    case "network_error":
      return "Network Error";
    default:
      return "Unknown Error";
  }
}
function createTimeoutController(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return {
    controller,
    timeoutId,
    clear: () => clearTimeout(timeoutId)
  };
}
async function performRequest(url, method, signal) {
  return fetch(url, {
    method,
    signal,
    // Don't follow redirects automatically to get actual redirect status
    redirect: "manual",
    // Disable cache to get fresh status
    cache: "no-store",
    // Set a generic user agent
    headers: {
      "User-Agent": "Mozilla/5.0 Link Checker Extension"
    }
  });
}
function shouldFallbackToGet(_error, response) {
  if (response?.status === 405) {
    return true;
  }
  if (response?.status === 400) {
    return true;
  }
  return false;
}
async function validateLink(link, config = {}) {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const externalSignal = config.signal;
  const baseResult = {
    url: link.url,
    tagName: link.tagName,
    text: link.text,
    elementId: link.elementId,
    checkedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (externalSignal?.aborted) {
    return {
      ...baseResult,
      status: null,
      statusCategory: "network_error",
      statusText: "Cancelled"
    };
  }
  let response;
  let lastError;
  try {
    const timeout = createTimeoutController(timeoutMs);
    const combinedController = new AbortController();
    const combinedSignal = combinedController.signal;
    const abortHandler = () => combinedController.abort();
    timeout.controller.signal.addEventListener("abort", abortHandler);
    externalSignal?.addEventListener("abort", abortHandler);
    try {
      response = await performRequest(link.url, "HEAD", combinedSignal);
      timeout.clear();
      if (shouldFallbackToGet(void 0, response)) {
        const getTimeout = createTimeoutController(timeoutMs);
        const getController = new AbortController();
        const getSignal = getController.signal;
        const getAbortHandler = () => getController.abort();
        getTimeout.controller.signal.addEventListener("abort", getAbortHandler);
        externalSignal?.addEventListener("abort", getAbortHandler);
        try {
          response = await performRequest(link.url, "GET", getSignal);
        } finally {
          getTimeout.clear();
          getTimeout.controller.signal.removeEventListener("abort", getAbortHandler);
          externalSignal?.removeEventListener("abort", getAbortHandler);
        }
      }
    } finally {
      timeout.clear();
      timeout.controller.signal.removeEventListener("abort", abortHandler);
      externalSignal?.removeEventListener("abort", abortHandler);
    }
  } catch (caughtError) {
    lastError = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
    if (!response) {
      try {
        const getTimeout = createTimeoutController(timeoutMs);
        const getController = new AbortController();
        const getSignal = getController.signal;
        const getAbortHandler = () => getController.abort();
        getTimeout.controller.signal.addEventListener("abort", getAbortHandler);
        externalSignal?.addEventListener("abort", getAbortHandler);
        try {
          response = await performRequest(link.url, "GET", getSignal);
          lastError = void 0;
        } catch (getError) {
          lastError = getError instanceof Error ? getError : new Error(String(getError));
        } finally {
          getTimeout.clear();
          getTimeout.controller.signal.removeEventListener("abort", getAbortHandler);
          externalSignal?.removeEventListener("abort", getAbortHandler);
        }
      } catch {
      }
    }
  }
  if (response) {
    const status = response.status;
    const statusCategory = classifyStatus(status);
    const statusText = getStatusText(status, statusCategory);
    return {
      ...baseResult,
      status,
      statusCategory,
      statusText
    };
  }
  if (lastError) {
    const isTimeout = lastError.name === "AbortError" || lastError.name === "TimeoutError" || lastError.message.includes("timeout") || lastError.message.includes("aborted");
    if (externalSignal?.aborted) {
      return {
        ...baseResult,
        status: null,
        statusCategory: "network_error",
        statusText: "Cancelled"
      };
    }
    if (isTimeout) {
      return {
        ...baseResult,
        status: null,
        statusCategory: "timeout",
        statusText: getStatusText(null, "timeout")
      };
    }
    return {
      ...baseResult,
      status: null,
      statusCategory: "network_error",
      statusText: lastError.message || getStatusText(null, "network_error")
    };
  }
  return {
    ...baseResult,
    status: null,
    statusCategory: "network_error",
    statusText: getStatusText(null, "network_error")
  };
}

// src/background/batchProcessor.ts
var DEFAULT_CONCURRENCY = 5;
var DEFAULT_BATCH_SIZE = 20;
var SESSION_STORAGE_KEY = "currentSession";
var Semaphore = class {
  permits;
  waiting = [];
  constructor(permits) {
    this.permits = permits;
  }
  /**
   * Acquire a permit, waiting if necessary
   */
  async acquire() {
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
  release() {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      next();
    } else {
      this.permits++;
    }
  }
  /**
   * Get current available permits
   */
  get availablePermits() {
    return this.permits;
  }
};
function generateSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
async function saveSession(session) {
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
}
async function loadSession() {
  const result = await chrome.storage.local.get(SESSION_STORAGE_KEY);
  return result[SESSION_STORAGE_KEY] ?? null;
}
async function clearSession() {
  await chrome.storage.local.remove(SESSION_STORAGE_KEY);
}
function createSession(pageUrl, links) {
  return {
    id: generateSessionId(),
    pageUrl,
    links,
    results: [],
    status: "checking",
    completedCount: 0,
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    completedAt: null
  };
}
var BatchProcessor = class {
  config;
  abortController = null;
  currentSession = null;
  isRunning = false;
  progressCallback = null;
  constructor(config = {}) {
    this.config = {
      concurrency: config.concurrency ?? DEFAULT_CONCURRENCY,
      batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
      timeoutMs: config.timeoutMs ?? 1e4
    };
  }
  /**
   * Check if processor is currently running
   */
  get running() {
    return this.isRunning;
  }
  /**
   * Get current session
   */
  get session() {
    return this.currentSession;
  }
  /**
   * Set progress callback
   */
  onProgress(callback) {
    this.progressCallback = callback;
  }
  /**
   * Start a new validation session
   */
  async start(pageUrl, links) {
    if (this.isRunning) {
      throw new Error("Batch processor is already running");
    }
    this.currentSession = createSession(pageUrl, links);
    this.abortController = new AbortController();
    this.isRunning = true;
    await saveSession(this.currentSession);
    try {
      const results = await this.processLinks(links);
      if (this.currentSession) {
        this.currentSession.status = "completed";
        this.currentSession.completedAt = (/* @__PURE__ */ new Date()).toISOString();
        await saveSession(this.currentSession);
      }
      return results;
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        if (this.currentSession) {
          this.currentSession.status = "cancelled";
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
  async resume() {
    if (this.isRunning) {
      throw new Error("Batch processor is already running");
    }
    const session = await loadSession();
    if (!session || session.status !== "checking") {
      return null;
    }
    this.currentSession = session;
    this.abortController = new AbortController();
    this.isRunning = true;
    try {
      const remainingLinks = session.links.slice(session.completedCount);
      const newResults = await this.processLinks(remainingLinks);
      const allResults = [...session.results, ...newResults];
      if (this.currentSession) {
        this.currentSession.status = "completed";
        this.currentSession.results = allResults;
        this.currentSession.completedAt = (/* @__PURE__ */ new Date()).toISOString();
        await saveSession(this.currentSession);
      }
      return allResults;
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        if (this.currentSession) {
          this.currentSession.status = "cancelled";
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
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }
  /**
   * Clear the current session from storage
   */
  async clearSession() {
    this.currentSession = null;
    await clearSession();
  }
  /**
   * Get the current session from storage (static method)
   */
  static async getStoredSession() {
    return loadSession();
  }
  /**
   * Process links with batching and concurrency control
   */
  async processLinks(links) {
    const results = [];
    const totalLinks = this.currentSession?.links.length ?? links.length;
    const startIndex = this.currentSession?.completedCount ?? 0;
    const batches = [];
    for (let i = 0; i < links.length; i += this.config.batchSize) {
      batches.push(links.slice(i, i + this.config.batchSize));
    }
    for (const batch of batches) {
      if (this.abortController?.signal.aborted) {
        break;
      }
      const batchResults = await this.processBatch(batch, startIndex + results.length, totalLinks);
      results.push(...batchResults);
      if (this.currentSession) {
        this.currentSession.results = [
          ...this.currentSession.results.slice(0, startIndex),
          ...results
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
  async processBatch(batch, startIndex, totalLinks) {
    const semaphore = new Semaphore(this.config.concurrency);
    const results = new Array(batch.length);
    let completedInBatch = 0;
    const validatorConfig = {
      timeoutMs: this.config.timeoutMs,
      ...this.abortController?.signal && { signal: this.abortController.signal }
    };
    const tasks = batch.map(async (link, index) => {
      if (this.abortController?.signal.aborted) {
        return;
      }
      await semaphore.acquire();
      try {
        if (this.abortController?.signal.aborted) {
          return;
        }
        const result = await validateLink(link, validatorConfig);
        results[index] = result;
        completedInBatch++;
        if (this.progressCallback) {
          const totalCompleted = startIndex + completedInBatch;
          this.progressCallback({
            total: totalLinks,
            completed: totalCompleted,
            current: result
          });
        }
      } finally {
        semaphore.release();
      }
    });
    await Promise.all(tasks);
    return results.filter((r) => r !== void 0);
  }
};
var processorInstance = null;
function getBatchProcessor(config) {
  if (!processorInstance) {
    processorInstance = new BatchProcessor(config);
  }
  return processorInstance;
}

// src/background/progressNotifier.ts
var PROGRESS_STORAGE_KEY = "lastProgress";
var RESULTS_STORAGE_KEY = "validationResults";
var ProgressNotifier = class {
  portManager = getPortManager();
  currentProgress = null;
  isValidationComplete = false;
  completedResults = [];
  callbacks = {};
  constructor(callbacks) {
    this.callbacks = callbacks ?? {};
    this.setupPortHandlers();
  }
  /**
   * Set up port connection/disconnection handlers
   */
  setupPortHandlers() {
    this.portManager.onConnect(async (port) => {
      console.log("[ProgressNotifier] Popup connected");
      if (this.callbacks.onPopupConnect) {
        this.callbacks.onPopupConnect();
      }
      await this.sendCurrentStateToPort(port);
    });
    this.portManager.onDisconnect(() => {
      console.log("[ProgressNotifier] Popup disconnected");
      if (!this.portManager.hasConnections && this.callbacks.onPopupDisconnect) {
        this.callbacks.onPopupDisconnect();
      }
    });
  }
  /**
   * Send current state to a specific port
   */
  async sendCurrentStateToPort(port) {
    try {
      if (this.currentProgress) {
        port.postMessage({
          type: "VALIDATION_PROGRESS",
          payload: this.currentProgress
        });
      }
      if (this.isValidationComplete && this.completedResults.length > 0) {
        port.postMessage({
          type: "VALIDATION_COMPLETE",
          payload: this.completedResults
        });
      } else {
        const storedState = await this.loadProgressState();
        if (storedState) {
          if (storedState.progress) {
            port.postMessage({
              type: "VALIDATION_PROGRESS",
              payload: storedState.progress
            });
          }
          if (storedState.isComplete) {
            const results = await this.loadResults();
            if (results) {
              port.postMessage({
                type: "VALIDATION_COMPLETE",
                payload: results
              });
            }
          }
        }
      }
    } catch (error) {
      console.warn("[ProgressNotifier] Failed to send state to port:", error);
    }
  }
  /**
   * Report validation progress
   */
  async reportProgress(progress) {
    this.currentProgress = progress;
    this.isValidationComplete = false;
    this.portManager.sendProgress(progress);
    await this.saveProgressState({
      progress,
      isComplete: false,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  /**
   * Report validation complete
   */
  async reportComplete(results) {
    this.isValidationComplete = true;
    this.completedResults = results;
    if (this.currentProgress) {
      this.currentProgress = {
        ...this.currentProgress,
        completed: this.currentProgress.total
      };
    }
    this.portManager.sendComplete(results);
    await this.saveProgressState({
      progress: this.currentProgress ?? {
        total: results.length,
        completed: results.length,
        current: results[results.length - 1] ?? null
      },
      isComplete: true,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    await this.saveResults(results);
  }
  /**
   * Report validation cancelled
   */
  async reportCancelled() {
    if (this.currentProgress) {
      this.portManager.broadcast({
        type: "VALIDATION_PROGRESS",
        payload: {
          ...this.currentProgress,
          current: null
        }
      });
    }
    await this.clearState();
  }
  /**
   * Reset the notifier state
   */
  async reset() {
    this.currentProgress = null;
    this.isValidationComplete = false;
    this.completedResults = [];
    await this.clearState();
  }
  /**
   * Check if there are connected Popups
   */
  get hasConnectedPopups() {
    return this.portManager.hasConnections;
  }
  /**
   * Get the number of connected Popups
   */
  get connectedPopupCount() {
    return this.portManager.connectedCount;
  }
  /**
   * Get current progress (may be null)
   */
  get progress() {
    return this.currentProgress;
  }
  /**
   * Check if validation is complete
   */
  get isComplete() {
    return this.isValidationComplete;
  }
  // ===========================================================================
  // Storage Functions
  // ===========================================================================
  /**
   * Save progress state to storage
   */
  async saveProgressState(state) {
    try {
      await chrome.storage.local.set({ [PROGRESS_STORAGE_KEY]: state });
    } catch (error) {
      console.warn("[ProgressNotifier] Failed to save progress state:", error);
    }
  }
  /**
   * Load progress state from storage
   */
  async loadProgressState() {
    try {
      const result = await chrome.storage.local.get(PROGRESS_STORAGE_KEY);
      return result[PROGRESS_STORAGE_KEY] ?? null;
    } catch (error) {
      console.warn("[ProgressNotifier] Failed to load progress state:", error);
      return null;
    }
  }
  /**
   * Save results to storage
   */
  async saveResults(results) {
    try {
      await chrome.storage.local.set({ [RESULTS_STORAGE_KEY]: results });
    } catch (error) {
      console.warn("[ProgressNotifier] Failed to save results:", error);
    }
  }
  /**
   * Load results from storage
   */
  async loadResults() {
    try {
      const result = await chrome.storage.local.get(RESULTS_STORAGE_KEY);
      return result[RESULTS_STORAGE_KEY] ?? null;
    } catch (error) {
      console.warn("[ProgressNotifier] Failed to load results:", error);
      return null;
    }
  }
  /**
   * Clear all stored state
   */
  async clearState() {
    try {
      await chrome.storage.local.remove([PROGRESS_STORAGE_KEY, RESULTS_STORAGE_KEY]);
    } catch (error) {
      console.warn("[ProgressNotifier] Failed to clear state:", error);
    }
  }
};
var notifierInstance = null;
function getProgressNotifier(callbacks) {
  if (!notifierInstance) {
    notifierInstance = new ProgressNotifier(callbacks);
  }
  return notifierInstance;
}

// src/background/contentScriptInjector.ts
var injectedTabs = /* @__PURE__ */ new Set();
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}
function isInjectableUrl(url) {
  if (!url) {
    return false;
  }
  return url.startsWith("http://") || url.startsWith("https://");
}
function clearInjectionStatus(tabId) {
  injectedTabs.delete(tabId);
}
function clearAllInjectionStatus() {
  injectedTabs.clear();
}
async function injectContentScript(tabId) {
  if (injectedTabs.has(tabId)) {
    console.log(`[ContentScriptInjector] Tab ${tabId} already injected, skipping`);
    return true;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    injectedTabs.add(tabId);
    console.log(`[ContentScriptInjector] Successfully injected into tab ${tabId}`);
    return true;
  } catch (error) {
    console.error(`[ContentScriptInjector] Failed to inject into tab ${tabId}:`, error);
    return false;
  }
}
async function injectIntoActiveTab() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    return {
      success: false,
      tabId: null,
      url: null,
      error: "No active tab found"
    };
  }
  if (!isInjectableUrl(tab.url)) {
    return {
      success: false,
      tabId: tab.id,
      url: tab.url ?? null,
      error: "Cannot inject into this page (only http/https pages are supported)"
    };
  }
  const success = await injectContentScript(tab.id);
  if (success) {
    return {
      success: true,
      tabId: tab.id,
      url: tab.url ?? null
    };
  }
  return {
    success: false,
    tabId: tab.id,
    url: tab.url ?? null,
    error: "Failed to inject Content Script"
  };
}
function setupTabListeners() {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") {
      clearInjectionStatus(tabId);
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    clearInjectionStatus(tabId);
  });
}
function initializeInjector() {
  clearAllInjectionStatus();
  setupTabListeners();
  console.log("[ContentScriptInjector] Initialized");
}

// src/background/csvExporter.ts
var UTF8_BOM = "\uFEFF";
var SEPARATOR = ",";
var LINE_TERMINATOR = "\r\n";
function escapeCSVValue(value) {
  if (value === null || value === void 0) {
    return "";
  }
  const stringValue = String(value);
  const needsEscaping = stringValue.includes(SEPARATOR) || stringValue.includes('"') || stringValue.includes("\n") || stringValue.includes("\r");
  if (!needsEscaping) {
    return stringValue;
  }
  const escaped = stringValue.replace(/"/g, '""');
  return `"${escaped}"`;
}
function createCSVRow(values) {
  return values.map(escapeCSVValue).join(SEPARATOR);
}
var CSV_HEADERS = [
  "URL",
  "\u30B9\u30C6\u30FC\u30BF\u30B9\u30B3\u30FC\u30C9",
  "\u30B9\u30C6\u30FC\u30BF\u30B9",
  "\u30BF\u30B0",
  "\u30EA\u30F3\u30AF\u30C6\u30AD\u30B9\u30C8",
  "\u691C\u8A3C\u65E5\u6642"
];
function generateCSV(results, pageUrl, checkedAt) {
  const lines = [];
  lines.push(createCSVRow(["Link Checker - \u691C\u8A3C\u7D50\u679C\u30EC\u30DD\u30FC\u30C8", "", "", "", "", ""]));
  lines.push(createCSVRow(["\u30DA\u30FC\u30B8URL", pageUrl, "", "", "", ""]));
  lines.push(createCSVRow(["\u691C\u8A3C\u65E5\u6642", formatDateTime(checkedAt), "", "", "", ""]));
  lines.push(createCSVRow(["\u7DCF\u30EA\u30F3\u30AF\u6570", results.length, "", "", "", ""]));
  lines.push("");
  lines.push(createCSVRow(CSV_HEADERS));
  for (const result of results) {
    const row = [
      result.url,
      result.status,
      result.statusText,
      result.tagName,
      result.text,
      formatDateTime(result.checkedAt)
    ];
    lines.push(createCSVRow(row));
  }
  return UTF8_BOM + lines.join(LINE_TERMINATOR);
}
function formatDateTime(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return isoString;
  }
}
function generateFilename(pageUrl) {
  let hostname = "unknown";
  try {
    const url = new URL(pageUrl);
    hostname = url.hostname.replace(/[^a-zA-Z0-9.-]/g, "_");
  } catch {
  }
  const now = /* @__PURE__ */ new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5).replace(":", "");
  return `link-checker_${hostname}_${dateStr}_${timeStr}.csv`;
}
async function exportToCSV(results, pageUrl) {
  if (results.length === 0) {
    console.warn("[CSVExporter] No results to export");
    return null;
  }
  const checkedAt = (/* @__PURE__ */ new Date()).toISOString();
  const csvContent = generateCSV(results, pageUrl, checkedAt);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const dataUrl = await blobToDataUrl(blob);
  const filename = generateFilename(pageUrl);
  try {
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: true
      // Show save dialog
    });
    console.log(`[CSVExporter] Download started: ${filename} (ID: ${downloadId})`);
    return downloadId;
  } catch (error) {
    console.error("[CSVExporter] Download failed:", error);
    return null;
  }
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to convert blob to data URL"));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// src/background/background.ts
var currentTabId = null;
var currentPageUrl = null;
function initialize() {
  console.log("[ServiceWorker] Initializing...");
  initializeInjector();
  getPortManager();
  getProgressNotifier();
  setupMessageHandlers();
  checkForResumableSession();
  console.log("[ServiceWorker] Initialized");
}
async function checkForResumableSession() {
  try {
    const processor = getBatchProcessor();
    const session = await processor.constructor.getStoredSession();
    if (session && session.status === "checking") {
      console.log("[ServiceWorker] Found resumable session, attempting to resume...");
    }
  } catch (error) {
    console.error("[ServiceWorker] Failed to check for resumable session:", error);
  }
}
function setupMessageHandlers() {
  createMessageListener({
    START_CHECK: handleStartCheck,
    CANCEL_CHECK: handleCancelCheck,
    EXPORT_CSV: handleExportCSV,
    HIGHLIGHT_ELEMENT: handleHighlightElement,
    GET_SESSION: handleGetSession
  });
}
async function handleStartCheck(_message, _sender, sendResponse) {
  console.log("[ServiceWorker] START_CHECK received");
  try {
    const injectionResult = await injectIntoActiveTab();
    if (!injectionResult.success || !injectionResult.tabId) {
      console.error("[ServiceWorker] Failed to inject:", injectionResult.error);
      sendResponse({ success: false, error: injectionResult.error });
      return;
    }
    currentTabId = injectionResult.tabId;
    currentPageUrl = injectionResult.url;
    const links = await sendToTab(currentTabId, { type: "EXTRACT_LINKS" });
    if (!links || links.length === 0) {
      console.log("[ServiceWorker] No links found on page");
      sendResponse({ success: true, linksFound: 0 });
      return;
    }
    console.log(`[ServiceWorker] Found ${links.length} links`);
    await startValidation(links, currentPageUrl ?? "");
    sendResponse({ success: true, linksFound: links.length });
  } catch (error) {
    console.error("[ServiceWorker] START_CHECK error:", error);
    sendResponse({ success: false, error: String(error) });
  }
}
function handleCancelCheck(_message, _sender, sendResponse) {
  console.log("[ServiceWorker] CANCEL_CHECK received");
  const processor = getBatchProcessor();
  processor.cancel();
  const notifier = getProgressNotifier();
  notifier.reportCancelled().catch(console.error);
  sendResponse({ success: true });
}
async function handleExportCSV(_message, _sender, sendResponse) {
  console.log("[ServiceWorker] EXPORT_CSV received");
  try {
    const result = await chrome.storage.local.get(["currentSession", "validationResults"]);
    const session = result["currentSession"];
    const storedResults = result["validationResults"];
    const results = session?.results ?? storedResults;
    const pageUrl = session?.pageUrl ?? currentPageUrl ?? "unknown";
    if (!results || results.length === 0) {
      sendResponse({ success: false, error: "No results to export" });
      return;
    }
    const downloadId = await exportToCSV(results, pageUrl);
    sendResponse({ success: downloadId !== null, downloadId });
  } catch (error) {
    console.error("[ServiceWorker] EXPORT_CSV error:", error);
    sendResponse({ success: false, error: String(error) });
  }
}
async function handleHighlightElement(message, _sender, sendResponse) {
  console.log("[ServiceWorker] HIGHLIGHT_ELEMENT received:", message.payload.elementId);
  try {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      sendResponse({ success: false, error: "No active tab" });
      return;
    }
    const injectionResult = await injectIntoActiveTab();
    if (!injectionResult.success) {
      sendResponse({ success: false, error: "Cannot inject Content Script" });
      return;
    }
    const result = await sendToTab(tab.id, {
      type: "HIGHLIGHT_ELEMENT",
      payload: { elementId: message.payload.elementId }
    });
    sendResponse(result ?? { success: false });
  } catch (error) {
    console.error("[ServiceWorker] HIGHLIGHT_ELEMENT error:", error);
    sendResponse({ success: false, error: String(error) });
  }
}
async function handleGetSession(_message, _sender, sendResponse) {
  try {
    const result = await chrome.storage.local.get("currentSession");
    const session = result["currentSession"];
    sendResponse({ session });
  } catch (error) {
    console.error("[ServiceWorker] GET_SESSION error:", error);
    sendResponse({ session: null });
  }
}
async function startValidation(links, pageUrl) {
  const processor = getBatchProcessor();
  const notifier = getProgressNotifier();
  processor.onProgress((progress) => {
    notifier.reportProgress(progress).catch(console.error);
  });
  try {
    console.log(`[ServiceWorker] Starting validation of ${links.length} links`);
    const results = await processor.start(pageUrl, links);
    console.log(`[ServiceWorker] Validation complete: ${results.length} results`);
    await notifier.reportComplete(results);
  } catch (error) {
    console.error("[ServiceWorker] Validation error:", error);
    if (processor.session?.status === "cancelled") {
      await notifier.reportCancelled();
    }
  }
}
initialize();
self.addEventListener("install", () => {
  console.log("[ServiceWorker] Installed");
});
self.addEventListener("activate", () => {
  console.log("[ServiceWorker] Activated");
});
