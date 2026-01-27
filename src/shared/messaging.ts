/**
 * Link Checker Extension - Type-Safe Messaging Module
 *
 * Provides type-safe wrappers around Chrome's messaging APIs:
 * - chrome.runtime.sendMessage / onMessage for one-time messages
 * - chrome.runtime.connect / Port for streaming (progress updates)
 */

import type {
  ExtensionMessage,
  ValidationProgress,
  ValidationResult,
} from './types.js';
import { isExtensionMessage, isMessageType } from './types.js';

// =============================================================================
// Port Names
// =============================================================================

/** Port name for progress streaming */
export const PROGRESS_PORT_NAME = 'link-checker-progress';

// =============================================================================
// Message Sending
// =============================================================================

/**
 * Send a message to the service worker (background script)
 * @param message - The message to send
 * @returns Promise resolving to the response, or undefined if no response
 */
export async function sendToBackground<T = unknown>(
  message: ExtensionMessage
): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: T | undefined) => {
      // Handle potential chrome.runtime.lastError
      if (chrome.runtime.lastError) {
        console.warn(
          'sendToBackground error:',
          chrome.runtime.lastError.message
        );
        resolve(undefined);
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Send a message to a specific tab's content script
 * @param tabId - The tab ID to send to
 * @param message - The message to send
 * @returns Promise resolving to the response, or undefined if no response
 */
export async function sendToTab<T = unknown>(
  tabId: number,
  message: ExtensionMessage
): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response: T | undefined) => {
      if (chrome.runtime.lastError) {
        console.warn('sendToTab error:', chrome.runtime.lastError.message);
        resolve(undefined);
        return;
      }
      resolve(response);
    });
  });
}

// =============================================================================
// Message Listening
// =============================================================================

/** Callback type for message handlers */
export type MessageHandler<T extends ExtensionMessage = ExtensionMessage> = (
  message: T,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | void | Promise<unknown>;

/** Map of message type to handler */
type MessageHandlerMap = {
  [K in ExtensionMessage['type']]?: MessageHandler<
    Extract<ExtensionMessage, { type: K }>
  >;
};

/**
 * Create a message listener that routes messages to typed handlers
 * @param handlers - Map of message types to their handlers
 * @returns The listener function (for removal if needed)
 */
export function createMessageListener(
  handlers: MessageHandlerMap
): (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | undefined {
  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean | undefined => {
    // Validate message structure
    if (!isExtensionMessage(message)) {
      console.warn('Received invalid message:', message);
      return;
    }

    // Find handler for this message type
    const handler = handlers[message.type] as MessageHandler | undefined;
    if (!handler) {
      // No handler for this message type, ignore
      return;
    }

    // Call the handler
    const result = handler(message as never, sender, sendResponse);

    // If handler returns a Promise, handle async response
    if (result instanceof Promise) {
      result
        .then((response) => sendResponse(response))
        .catch((error) => {
          console.error('Message handler error:', error);
          sendResponse(undefined);
        });
      return true; // Keep the message channel open for async response
    }

    // Return true if handler wants to send async response
    return result === true;
  };

  chrome.runtime.onMessage.addListener(listener);
  return listener;
}

/**
 * Remove a message listener
 * @param listener - The listener to remove
 */
export function removeMessageListener(
  listener: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => boolean | undefined
): void {
  chrome.runtime.onMessage.removeListener(listener);
}

// =============================================================================
// Port-based Streaming (for Progress Updates)
// =============================================================================

/** Callback for port message handling */
export type PortMessageHandler = (message: ExtensionMessage) => void;

/** Callback for port disconnect */
export type PortDisconnectHandler = () => void;

/**
 * Connect to the service worker for progress streaming
 * @param onMessage - Callback for received messages
 * @param onDisconnect - Optional callback for disconnect
 * @returns Object with port and disconnect function
 */
export function connectToBackground(
  onMessage: PortMessageHandler,
  onDisconnect?: PortDisconnectHandler
): { port: chrome.runtime.Port; disconnect: () => void } {
  const port = chrome.runtime.connect({ name: PROGRESS_PORT_NAME });

  port.onMessage.addListener((message: unknown) => {
    if (isExtensionMessage(message)) {
      onMessage(message);
    }
  });

  if (onDisconnect) {
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        console.warn('Port disconnect error:', chrome.runtime.lastError.message);
      }
      onDisconnect();
    });
  }

  return {
    port,
    disconnect: () => port.disconnect(),
  };
}

/**
 * State for managing connected ports in service worker
 */
class PortManager {
  private ports: Set<chrome.runtime.Port> = new Set();
  private onConnectHandlers: Array<(port: chrome.runtime.Port) => void> = [];
  private onDisconnectHandlers: Array<(port: chrome.runtime.Port) => void> = [];

  constructor() {
    // Listen for incoming port connections
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== PROGRESS_PORT_NAME) {
        return; // Ignore ports with different names
      }

      this.ports.add(port);

      // Notify connect handlers
      for (const handler of this.onConnectHandlers) {
        handler(port);
      }

      // Handle disconnect
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
  onConnect(handler: (port: chrome.runtime.Port) => void): void {
    this.onConnectHandlers.push(handler);
  }

  /**
   * Add a handler for port disconnections
   */
  onDisconnect(handler: (port: chrome.runtime.Port) => void): void {
    this.onDisconnectHandlers.push(handler);
  }

  /**
   * Broadcast a message to all connected ports
   */
  broadcast(message: ExtensionMessage): void {
    for (const port of this.ports) {
      try {
        port.postMessage(message);
      } catch (error) {
        console.warn('Failed to send message to port:', error);
        this.ports.delete(port);
      }
    }
  }

  /**
   * Send progress update to all connected ports
   */
  sendProgress(progress: ValidationProgress): void {
    this.broadcast({
      type: 'VALIDATION_PROGRESS',
      payload: progress,
    });
  }

  /**
   * Send validation complete to all connected ports
   */
  sendComplete(results: ValidationResult[]): void {
    this.broadcast({
      type: 'VALIDATION_COMPLETE',
      payload: results,
    });
  }

  /**
   * Get the number of connected ports
   */
  get connectedCount(): number {
    return this.ports.size;
  }

  /**
   * Check if any ports are connected
   */
  get hasConnections(): boolean {
    return this.ports.size > 0;
  }
}

// Singleton instance for service worker
let portManagerInstance: PortManager | null = null;

/**
 * Get or create the PortManager singleton
 * Only use in service worker context
 */
export function getPortManager(): PortManager {
  if (!portManagerInstance) {
    portManagerInstance = new PortManager();
  }
  return portManagerInstance;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a message is of a specific type (re-exported for convenience)
 */
export { isExtensionMessage, isMessageType };

/**
 * Get current active tab
 * @returns Promise resolving to the active tab, or null if not available
 */
export async function getCurrentTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}
