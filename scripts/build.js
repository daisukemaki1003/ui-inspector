#!/usr/bin/env node
/**
 * Build script for Link Checker Chrome Extension
 *
 * Bundles TypeScript source files into single JS files for each entry point:
 * - background.js (Service Worker)
 * - content.js (Content Script)
 * - popup.js (Popup UI)
 */

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

/** Common build options */
const commonOptions = {
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
};

/** Entry points configuration */
const entryPoints = [
  {
    name: 'background',
    input: join(projectRoot, 'src/background/background.ts'),
    output: join(projectRoot, 'background.js'),
    format: 'esm', // Service Worker supports ES modules
  },
  {
    name: 'content',
    input: join(projectRoot, 'src/content/content.ts'),
    output: join(projectRoot, 'content.js'),
    format: 'iife', // Content Script must be IIFE (no module support)
  },
  {
    name: 'popup',
    input: join(projectRoot, 'src/popup/popup.ts'),
    output: join(projectRoot, 'popup.js'),
    format: 'iife', // Popup as IIFE for simplicity
  },
];

async function build() {
  console.log('Building Link Checker Extension...\n');

  try {
    for (const entry of entryPoints) {
      await esbuild.build({
        ...commonOptions,
        format: entry.format, // Use entry-specific format
        entryPoints: [entry.input],
        outfile: entry.output,
      });
      console.log(`  ✓ ${entry.name}.js (${entry.format})`);
    }

    console.log('\nBuild completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
