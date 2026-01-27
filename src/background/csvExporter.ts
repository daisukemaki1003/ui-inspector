/**
 * CSV Exporter Module
 *
 * Provides CSV export functionality for validation results:
 * - Convert results to CSV format
 * - Proper escaping of special characters (comma, newline, double quote)
 * - BOM-prefixed UTF-8 encoding for Excel compatibility
 * - chrome.downloads API for file saving
 */

import type { ValidationResult } from '../shared/types.js';

// =============================================================================
// Constants
// =============================================================================

/** UTF-8 BOM for Excel compatibility */
const UTF8_BOM = '\uFEFF';

/** CSV field separator */
const SEPARATOR = ',';

/** CSV line terminator */
const LINE_TERMINATOR = '\r\n';

// =============================================================================
// CSV Escaping
// =============================================================================

/**
 * Escape a value for CSV format
 * - Wraps in double quotes if contains special characters
 * - Escapes double quotes by doubling them
 *
 * @param value - The value to escape
 * @returns The escaped CSV value
 */
function escapeCSVValue(value: string | number | null): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  // Check if escaping is needed
  const needsEscaping =
    stringValue.includes(SEPARATOR) ||
    stringValue.includes('"') ||
    stringValue.includes('\n') ||
    stringValue.includes('\r');

  if (!needsEscaping) {
    return stringValue;
  }

  // Escape double quotes by doubling them and wrap in double quotes
  const escaped = stringValue.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Join values into a CSV row
 *
 * @param values - Array of values for the row
 * @returns CSV row string
 */
function createCSVRow(values: Array<string | number | null>): string {
  return values.map(escapeCSVValue).join(SEPARATOR);
}

// =============================================================================
// CSV Generation
// =============================================================================

/**
 * CSV column headers
 */
const CSV_HEADERS = [
  'URL',
  'ステータスコード',
  'ステータス',
  'タグ',
  'リンクテキスト',
  '検証日時',
];

/**
 * Generate CSV content from validation results
 *
 * @param results - Validation results to export
 * @param pageUrl - URL of the page that was checked
 * @param checkedAt - ISO 8601 timestamp of when the check was performed
 * @returns CSV content string (with BOM)
 */
export function generateCSV(
  results: ValidationResult[],
  pageUrl: string,
  checkedAt: string
): string {
  const lines: string[] = [];

  // Add metadata header rows
  lines.push(createCSVRow(['Link Checker - 検証結果レポート', '', '', '', '', '']));
  lines.push(createCSVRow(['ページURL', pageUrl, '', '', '', '']));
  lines.push(createCSVRow(['検証日時', formatDateTime(checkedAt), '', '', '', '']));
  lines.push(createCSVRow(['総リンク数', results.length, '', '', '', '']));
  lines.push(''); // Empty line before data

  // Add column headers
  lines.push(createCSVRow(CSV_HEADERS));

  // Add data rows
  for (const result of results) {
    const row = [
      result.url,
      result.status,
      result.statusText,
      result.tagName,
      result.text,
      formatDateTime(result.checkedAt),
    ];
    lines.push(createCSVRow(row));
  }

  // Join with line terminators and add BOM
  return UTF8_BOM + lines.join(LINE_TERMINATOR);
}

/**
 * Format ISO 8601 date/time to readable format
 *
 * @param isoString - ISO 8601 timestamp
 * @returns Formatted date/time string
 */
function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

/**
 * Generate filename for the CSV export
 *
 * @param pageUrl - URL of the page that was checked
 * @returns Filename string
 */
function generateFilename(pageUrl: string): string {
  // Extract hostname from URL
  let hostname = 'unknown';
  try {
    const url = new URL(pageUrl);
    hostname = url.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
  } catch {
    // Use default if URL parsing fails
  }

  // Format current date/time for filename
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = now.toTimeString().slice(0, 5).replace(':', ''); // HHMM

  return `link-checker_${hostname}_${dateStr}_${timeStr}.csv`;
}

// =============================================================================
// Download Function
// =============================================================================

/**
 * Export validation results as a CSV file download
 *
 * @param results - Validation results to export
 * @param pageUrl - URL of the page that was checked
 * @returns Promise resolving to download ID, or null if failed
 */
export async function exportToCSV(
  results: ValidationResult[],
  pageUrl: string
): Promise<number | null> {
  if (results.length === 0) {
    console.warn('[CSVExporter] No results to export');
    return null;
  }

  // Generate CSV content
  const checkedAt = new Date().toISOString();
  const csvContent = generateCSV(results, pageUrl, checkedAt);

  // Create data URL
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const dataUrl = await blobToDataUrl(blob);

  // Generate filename
  const filename = generateFilename(pageUrl);

  // Trigger download using chrome.downloads API
  try {
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: true, // Show save dialog
    });

    console.log(`[CSVExporter] Download started: ${filename} (ID: ${downloadId})`);
    return downloadId;
  } catch (error) {
    console.error('[CSVExporter] Download failed:', error);
    return null;
  }
}

/**
 * Convert Blob to data URL
 *
 * @param blob - Blob to convert
 * @returns Promise resolving to data URL string
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to data URL'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get summary statistics for the CSV header
 *
 * @param results - Validation results
 * @returns Summary object
 */
export function getResultsSummary(results: ValidationResult[]): {
  total: number;
  success: number;
  redirect: number;
  error: number;
} {
  const summary = {
    total: results.length,
    success: 0,
    redirect: 0,
    error: 0,
  };

  for (const result of results) {
    switch (result.statusCategory) {
      case 'success':
        summary.success++;
        break;
      case 'redirect':
        summary.redirect++;
        break;
      default:
        summary.error++;
        break;
    }
  }

  return summary;
}
