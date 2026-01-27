/**
 * Link Validator Module
 *
 * Provides HTTP validation functionality for links:
 * - HEAD request with GET fallback
 * - HTTP status code classification
 * - Timeout management with AbortController
 * - Error categorization (timeout vs network_error)
 */

import type { LinkInfo, ValidationResult, StatusCategory } from '../shared/types.js';

// =============================================================================
// Constants
// =============================================================================

/** Default timeout for HTTP requests in milliseconds */
const DEFAULT_TIMEOUT_MS = 10000;

/** HTTP methods for link validation */
type HttpMethod = 'HEAD' | 'GET';

// =============================================================================
// Status Classification
// =============================================================================

/**
 * Classify HTTP status code into a category
 * @param status - HTTP status code (or null for errors)
 * @returns The status category
 */
export function classifyStatus(status: number | null): StatusCategory {
  if (status === null) {
    return 'network_error';
  }

  if (status >= 200 && status < 300) {
    return 'success';
  }

  if (status >= 300 && status < 400) {
    return 'redirect';
  }

  if (status >= 400 && status < 500) {
    return 'client_error';
  }

  if (status >= 500) {
    return 'server_error';
  }

  // For unexpected status codes (< 200), treat as network error
  return 'network_error';
}

/**
 * Get human-readable status text
 * @param status - HTTP status code (or null for errors)
 * @param category - Status category
 * @returns Human-readable status description
 */
export function getStatusText(status: number | null, category: StatusCategory): string {
  if (status !== null) {
    // Common status code descriptions
    const statusDescriptions: Record<number, string> = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      301: 'Moved Permanently',
      302: 'Found',
      303: 'See Other',
      304: 'Not Modified',
      307: 'Temporary Redirect',
      308: 'Permanent Redirect',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      408: 'Request Timeout',
      410: 'Gone',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout',
    };

    return statusDescriptions[status] ?? `Status ${status}`;
  }

  // Error category descriptions
  switch (category) {
    case 'timeout':
      return 'Request Timeout';
    case 'network_error':
      return 'Network Error';
    default:
      return 'Unknown Error';
  }
}

// =============================================================================
// HTTP Request Functions
// =============================================================================

/**
 * Create an AbortController with timeout
 * @param timeoutMs - Timeout in milliseconds
 * @returns Object with controller and cleanup function
 */
function createTimeoutController(timeoutMs: number): {
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
  clear: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    timeoutId,
    clear: () => clearTimeout(timeoutId),
  };
}

/**
 * Perform an HTTP request with the specified method
 * @param url - URL to request
 * @param method - HTTP method (HEAD or GET)
 * @param signal - AbortSignal for cancellation
 * @returns Response object
 */
async function performRequest(
  url: string,
  method: HttpMethod,
  signal: AbortSignal
): Promise<Response> {
  return fetch(url, {
    method,
    signal,
    // Don't follow redirects automatically to get actual redirect status
    redirect: 'manual',
    // Disable cache to get fresh status
    cache: 'no-store',
    // Set a generic user agent
    headers: {
      'User-Agent': 'Mozilla/5.0 Link Checker Extension',
    },
  });
}

/**
 * Determine if an error indicates the request method is not supported
 * Some servers don't support HEAD requests
 * @param error - The error from the request
 * @param response - The response (if any)
 * @returns true if we should retry with GET
 */
function shouldFallbackToGet(_error: unknown, response?: Response): boolean {
  // 405 Method Not Allowed - server explicitly rejects HEAD
  if (response?.status === 405) {
    return true;
  }

  // Some servers return 400 Bad Request for HEAD
  if (response?.status === 400) {
    return true;
  }

  return false;
}

// =============================================================================
// Main Validation Function
// =============================================================================

/**
 * Configuration for link validation
 */
export interface ValidatorConfig {
  /** Timeout for each request in milliseconds */
  timeoutMs?: number;
  /** External AbortSignal for cancellation */
  signal?: AbortSignal;
}

/**
 * Validate a single link by checking its HTTP status
 * Uses HEAD request first, falls back to GET if HEAD fails
 *
 * @param link - Link information to validate
 * @param config - Optional validation configuration
 * @returns Validation result
 */
export async function validateLink(
  link: LinkInfo,
  config: ValidatorConfig = {}
): Promise<ValidationResult> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const externalSignal = config.signal;

  // Create base result structure
  const baseResult = {
    url: link.url,
    tagName: link.tagName,
    text: link.text,
    elementId: link.elementId,
    checkedAt: new Date().toISOString(),
  };

  // Check if already cancelled
  if (externalSignal?.aborted) {
    return {
      ...baseResult,
      status: null,
      statusCategory: 'network_error',
      statusText: 'Cancelled',
    };
  }

  // Try HEAD request first
  let response: Response | undefined;
  let lastError: Error | undefined;

  try {
    const timeout = createTimeoutController(timeoutMs);

    // Combine external signal with timeout
    const combinedController = new AbortController();
    const combinedSignal = combinedController.signal;

    // Abort combined controller when either signal fires
    const abortHandler = () => combinedController.abort();
    timeout.controller.signal.addEventListener('abort', abortHandler);
    externalSignal?.addEventListener('abort', abortHandler);

    try {
      response = await performRequest(link.url, 'HEAD', combinedSignal);
      timeout.clear();

      // Check if we should try GET instead
      if (shouldFallbackToGet(undefined, response)) {
        // Reset for GET request
        const getTimeout = createTimeoutController(timeoutMs);
        const getController = new AbortController();
        const getSignal = getController.signal;

        const getAbortHandler = () => getController.abort();
        getTimeout.controller.signal.addEventListener('abort', getAbortHandler);
        externalSignal?.addEventListener('abort', getAbortHandler);

        try {
          response = await performRequest(link.url, 'GET', getSignal);
        } finally {
          getTimeout.clear();
          getTimeout.controller.signal.removeEventListener('abort', getAbortHandler);
          externalSignal?.removeEventListener('abort', getAbortHandler);
        }
      }
    } finally {
      timeout.clear();
      timeout.controller.signal.removeEventListener('abort', abortHandler);
      externalSignal?.removeEventListener('abort', abortHandler);
    }
  } catch (caughtError) {
    lastError = caughtError instanceof Error ? caughtError : new Error(String(caughtError));

    // If HEAD failed with error, try GET
    if (!response) {
      try {
        const getTimeout = createTimeoutController(timeoutMs);
        const getController = new AbortController();
        const getSignal = getController.signal;

        const getAbortHandler = () => getController.abort();
        getTimeout.controller.signal.addEventListener('abort', getAbortHandler);
        externalSignal?.addEventListener('abort', getAbortHandler);

        try {
          response = await performRequest(link.url, 'GET', getSignal);
          lastError = undefined; // Clear error since GET succeeded
        } catch (getError) {
          // GET also failed, keep the original error
          lastError = getError instanceof Error ? getError : new Error(String(getError));
        } finally {
          getTimeout.clear();
          getTimeout.controller.signal.removeEventListener('abort', getAbortHandler);
          externalSignal?.removeEventListener('abort', getAbortHandler);
        }
      } catch {
        // Ignore errors setting up GET retry
      }
    }
  }

  // Process result
  if (response) {
    const status = response.status;
    const statusCategory = classifyStatus(status);
    const statusText = getStatusText(status, statusCategory);

    return {
      ...baseResult,
      status,
      statusCategory,
      statusText,
    };
  }

  // Handle error cases
  if (lastError) {
    // Check if it was a timeout
    const isTimeout =
      lastError.name === 'AbortError' ||
      lastError.name === 'TimeoutError' ||
      lastError.message.includes('timeout') ||
      lastError.message.includes('aborted');

    // Check if externally cancelled
    if (externalSignal?.aborted) {
      return {
        ...baseResult,
        status: null,
        statusCategory: 'network_error',
        statusText: 'Cancelled',
      };
    }

    if (isTimeout) {
      return {
        ...baseResult,
        status: null,
        statusCategory: 'timeout',
        statusText: getStatusText(null, 'timeout'),
      };
    }

    return {
      ...baseResult,
      status: null,
      statusCategory: 'network_error',
      statusText: lastError.message || getStatusText(null, 'network_error'),
    };
  }

  // Fallback for unexpected cases
  return {
    ...baseResult,
    status: null,
    statusCategory: 'network_error',
    statusText: getStatusText(null, 'network_error'),
  };
}

/**
 * Validate multiple links sequentially
 * Note: For parallel validation with concurrency control, see Task 4.2
 *
 * @param links - Array of links to validate
 * @param config - Validation configuration
 * @param onProgress - Optional callback for progress updates
 * @returns Array of validation results
 */
export async function validateLinks(
  links: LinkInfo[],
  config: ValidatorConfig = {},
  onProgress?: (progress: { completed: number; total: number; current: ValidationResult }) => void
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const total = links.length;

  for (let i = 0; i < links.length; i++) {
    // Check for cancellation
    if (config.signal?.aborted) {
      break;
    }

    const link = links[i]!;
    const result = await validateLink(link, config);
    results.push(result);

    // Report progress
    if (onProgress) {
      onProgress({
        completed: i + 1,
        total,
        current: result,
      });
    }
  }

  return results;
}
