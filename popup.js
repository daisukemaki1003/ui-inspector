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

// src/shared/messaging.ts
var PROGRESS_PORT_NAME = "link-checker-progress";
function connectToBackground(onMessage, onDisconnect) {
  const port = chrome.runtime.connect({ name: PROGRESS_PORT_NAME });
  port.onMessage.addListener((message) => {
    if (isExtensionMessage(message)) {
      onMessage(message);
    }
  });
  if (onDisconnect) {
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        console.warn("Port disconnect error:", chrome.runtime.lastError.message);
      }
      onDisconnect();
    });
  }
  return {
    port,
    disconnect: () => port.disconnect()
  };
}

// src/popup/popup.ts
function $(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element not found: ${id}`);
  }
  return element;
}
var startBtn = $("start-btn");
var cancelBtn = $("cancel-btn");
var exportBtn = $("export-btn");
var progressSection = $("progress-section");
var summarySection = $("summary-section");
var filterSection = $("filter-section");
var resultsSection = $("results-section");
var emptyState = $("empty-state");
var errorState = $("error-state");
var progressBar = $("progress-bar");
var progressCount = $("progress-count");
var progressCurrent = $("progress-current");
var summaryTotal = $("summary-total");
var summarySuccess = $("summary-success");
var summaryRedirect = $("summary-redirect");
var summaryError = $("summary-error");
var resultsList = $("results-list");
var noResults = $("no-results");
var errorMessage = $("error-message");
var filterButtons = document.querySelectorAll(".filter-btn");
var state = {
  phase: "idle",
  progress: null,
  results: [],
  filter: "all",
  summary: {
    total: 0,
    success: 0,
    redirect: 0,
    error: 0
  }
};
var portConnection = null;
function updateUI() {
  updateButtons();
  updateSections();
  updateProgress();
  updateSummary();
  updateResults();
}
function updateButtons() {
  switch (state.phase) {
    case "idle":
      startBtn.disabled = false;
      cancelBtn.disabled = true;
      exportBtn.disabled = true;
      break;
    case "checking":
      startBtn.disabled = true;
      cancelBtn.disabled = false;
      exportBtn.disabled = true;
      break;
    case "completed":
      startBtn.disabled = false;
      cancelBtn.disabled = true;
      exportBtn.disabled = state.results.length === 0;
      break;
  }
}
function updateSections() {
  progressSection.classList.add("hidden");
  summarySection.classList.add("hidden");
  filterSection.classList.add("hidden");
  resultsSection.classList.add("hidden");
  emptyState.classList.add("hidden");
  errorState.classList.add("hidden");
  switch (state.phase) {
    case "idle":
      emptyState.classList.remove("hidden");
      break;
    case "checking":
      progressSection.classList.remove("hidden");
      break;
    case "completed":
      summarySection.classList.remove("hidden");
      filterSection.classList.remove("hidden");
      resultsSection.classList.remove("hidden");
      break;
  }
}
function updateProgress() {
  if (!state.progress) {
    progressBar.style.width = "0%";
    progressCount.textContent = "0 / 0";
    progressCurrent.textContent = "";
    return;
  }
  const { completed, total, current } = state.progress;
  const percent = total > 0 ? Math.round(completed / total * 100) : 0;
  progressBar.style.width = `${percent}%`;
  progressCount.textContent = `${completed} / ${total}`;
  if (current) {
    progressCurrent.textContent = current.url;
  } else {
    progressCurrent.textContent = "";
  }
}
function updateSummary() {
  summaryTotal.textContent = String(state.summary.total);
  summarySuccess.textContent = String(state.summary.success);
  summaryRedirect.textContent = String(state.summary.redirect);
  summaryError.textContent = String(state.summary.error);
}
function updateFilterButtons() {
  filterButtons.forEach((btn) => {
    const filter = btn.dataset["filter"];
    if (filter === state.filter) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}
function getFilteredResults() {
  if (state.filter === "all") {
    return state.results;
  }
  return state.results.filter((result) => {
    switch (state.filter) {
      case "success":
        return result.statusCategory === "success";
      case "redirect":
        return result.statusCategory === "redirect";
      case "error":
        return result.statusCategory === "client_error" || result.statusCategory === "server_error" || result.statusCategory === "timeout" || result.statusCategory === "network_error";
      default:
        return true;
    }
  });
}
function sortResultsByStatus(results) {
  const categoryOrder = {
    client_error: 0,
    server_error: 0,
    timeout: 0,
    network_error: 0,
    redirect: 1,
    success: 2
  };
  return [...results].sort((a, b) => {
    const orderA = categoryOrder[a.statusCategory] ?? 3;
    const orderB = categoryOrder[b.statusCategory] ?? 3;
    return orderA - orderB;
  });
}
function getStatusClass(category) {
  switch (category) {
    case "success":
      return "status-success";
    case "redirect":
      return "status-redirect";
    default:
      return "status-error";
  }
}
function getStatusDisplay(result) {
  if (result.status !== null) {
    return String(result.status);
  }
  return result.statusCategory === "timeout" ? "T/O" : "ERR";
}
function updateResults() {
  updateFilterButtons();
  const filtered = getFilteredResults();
  const sorted = sortResultsByStatus(filtered);
  resultsList.innerHTML = "";
  if (sorted.length === 0) {
    noResults.classList.remove("hidden");
    return;
  }
  noResults.classList.add("hidden");
  sorted.forEach((result) => {
    const li = document.createElement("li");
    li.className = "result-item";
    li.dataset["elementId"] = result.elementId;
    const statusClass = getStatusClass(result.statusCategory);
    const statusDisplay = getStatusDisplay(result);
    li.innerHTML = `
      <span class="result-status ${statusClass}">${statusDisplay}</span>
      <div class="result-content">
        <div class="result-url">${escapeHtml(result.url)}</div>
        ${result.text ? `<div class="result-text">${escapeHtml(result.text)}</div>` : ""}
      </div>
      <span class="result-tag">${result.tagName}</span>
    `;
    resultsList.appendChild(li);
  });
}
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
function showError(message) {
  errorMessage.textContent = message;
  emptyState.classList.add("hidden");
  errorState.classList.remove("hidden");
}
function hideError() {
  errorState.classList.add("hidden");
}
function setPhase(phase) {
  state.phase = phase;
  updateUI();
}
function setProgress(progress) {
  state.progress = progress;
  updateProgress();
}
function setResults(results) {
  state.results = results;
  state.summary = calculateSummary(results);
  updateUI();
}
function calculateSummary(results) {
  const summary = {
    total: results.length,
    success: 0,
    redirect: 0,
    error: 0
  };
  results.forEach((result) => {
    switch (result.statusCategory) {
      case "success":
        summary.success++;
        break;
      case "redirect":
        summary.redirect++;
        break;
      default:
        summary.error++;
        break;
    }
  });
  return summary;
}
function setFilter(filter) {
  state.filter = filter;
  updateResults();
}
function getState() {
  return { ...state };
}
function handlePortMessage(message) {
  if (isMessageType(message, "VALIDATION_PROGRESS")) {
    setProgress(message.payload);
    if (state.phase !== "checking") {
      setPhase("checking");
    }
  } else if (isMessageType(message, "VALIDATION_COMPLETE")) {
    setResults(message.payload);
    setPhase("completed");
  }
}
function handlePortDisconnect() {
  console.log("[Popup] Port disconnected");
  portConnection = null;
}
function connectPort() {
  if (portConnection) {
    return;
  }
  try {
    portConnection = connectToBackground(handlePortMessage, handlePortDisconnect);
    console.log("[Popup] Port connected");
  } catch (error) {
    console.error("[Popup] Failed to connect port:", error);
  }
}
function disconnectPort() {
  if (portConnection) {
    portConnection.disconnect();
    portConnection = null;
  }
}
async function restoreState() {
  try {
    const result = await chrome.storage.local.get(["currentSession", "lastProgress", "validationResults"]);
    const session = result["currentSession"];
    const storedProgress = result["lastProgress"];
    const storedResults = result["validationResults"];
    if (session && session.status === "checking") {
      state.phase = "checking";
      if (storedProgress?.progress) {
        state.progress = storedProgress.progress;
      }
      connectPort();
    } else if (session && session.status === "completed" && session.results) {
      state.results = session.results;
      state.summary = calculateSummary(session.results);
      state.phase = "completed";
    } else if (storedResults && storedResults.length > 0) {
      state.results = storedResults;
      state.summary = calculateSummary(storedResults);
      state.phase = "completed";
    }
    updateUI();
    console.log("[Popup] State restored:", state.phase);
  } catch (error) {
    console.error("[Popup] Failed to restore state:", error);
  }
}
async function handleStartClick() {
  console.log("[Popup] Start check clicked");
  hideError();
  setPhase("checking");
  connectPort();
  try {
    await chrome.runtime.sendMessage({ type: "START_CHECK" });
  } catch (error) {
    console.error("[Popup] Failed to start check:", error);
    showError("\u30C1\u30A7\u30C3\u30AF\u3092\u958B\u59CB\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F");
    setPhase("idle");
    disconnectPort();
  }
}
async function handleCancelClick() {
  console.log("[Popup] Cancel clicked");
  try {
    await chrome.runtime.sendMessage({ type: "CANCEL_CHECK" });
    setPhase("idle");
    disconnectPort();
  } catch (error) {
    console.error("[Popup] Failed to cancel:", error);
  }
}
async function handleExportClick() {
  console.log("[Popup] Export clicked");
  try {
    await chrome.runtime.sendMessage({ type: "EXPORT_CSV" });
  } catch (error) {
    console.error("[Popup] Failed to export:", error);
    showError("CSV\u30A8\u30AF\u30B9\u30DD\u30FC\u30C8\u306B\u5931\u6557\u3057\u307E\u3057\u305F");
  }
}
function handleFilterClick(event) {
  const button = event.target;
  const filter = button.dataset["filter"];
  if (filter) {
    setFilter(filter);
  }
}
async function handleResultClick(event) {
  const target = event.target;
  const resultItem = target.closest(".result-item");
  if (!resultItem) {
    return;
  }
  const elementId = resultItem.dataset["elementId"];
  if (!elementId) {
    return;
  }
  console.log("[Popup] Highlight element:", elementId);
  try {
    await chrome.runtime.sendMessage({
      type: "HIGHLIGHT_ELEMENT",
      payload: { elementId }
    });
  } catch (error) {
    console.error("[Popup] Failed to highlight:", error);
  }
}
function setupEventListeners() {
  startBtn.addEventListener("click", handleStartClick);
  cancelBtn.addEventListener("click", handleCancelClick);
  exportBtn.addEventListener("click", handleExportClick);
  filterButtons.forEach((btn) => {
    btn.addEventListener("click", handleFilterClick);
  });
  resultsList.addEventListener("click", handleResultClick);
}
async function initialize() {
  setupEventListeners();
  await restoreState();
  if (state.phase === "checking") {
    connectPort();
  }
  console.log("[Popup] Initialized");
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initialize().catch(console.error);
  });
} else {
  initialize().catch(console.error);
}
export {
  getState,
  hideError,
  setFilter,
  setPhase,
  setProgress,
  setResults,
  showError,
  state,
  updateUI
};
