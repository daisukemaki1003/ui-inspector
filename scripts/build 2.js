/**
 * Build script for Link Checker Extension
 *
 * Compiles TypeScript files and bundles them for the extension.
 * Since Chrome extensions with Manifest V3 don't support dynamic imports well,
 * we need to bundle each entry point with its dependencies.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const srcDir = join(rootDir, 'src');
const distDir = join(rootDir, 'dist');

/**
 * Run a command and log output
 */
function run(cmd) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { cwd: rootDir, stdio: 'inherit' });
  } catch (error) {
    console.error(`Command failed: ${cmd}`);
    process.exit(1);
  }
}

/**
 * Compile TypeScript to JavaScript
 */
function compileTypeScript() {
  console.log('\n📦 Compiling TypeScript...\n');

  // Create dist directory
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  // Use tsc with emit enabled
  run('npx tsc --project tsconfig.build.json');
}

/**
 * Bundle files for Chrome extension
 * Since we're using ES modules, we need to inline imports
 */
function bundleFiles() {
  console.log('\n📦 Bundling files...\n');

  // Read compiled files and create bundles
  const filesToBundle = [
    { entry: 'background/background.js', output: 'background.js' },
    { entry: 'popup/popup.js', output: 'popup.js' },
    { entry: 'content/content.js', output: 'content.js' },
  ];

  for (const { entry, output } of filesToBundle) {
    const entryPath = join(distDir, entry);
    const outputPath = join(rootDir, output);

    if (existsSync(entryPath)) {
      // For now, just copy - in production you'd want a bundler
      const content = readFileSync(entryPath, 'utf-8');
      writeFileSync(outputPath, content);
      console.log(`  ✓ ${output}`);
    } else {
      console.warn(`  ⚠ ${entry} not found`);
    }
  }
}

/**
 * Simple inline bundler - resolves imports and creates single file
 */
function inlineBundle(entryPath, processedFiles = new Set()) {
  if (processedFiles.has(entryPath)) {
    return '';
  }
  processedFiles.add(entryPath);

  if (!existsSync(entryPath)) {
    console.warn(`File not found: ${entryPath}`);
    return '';
  }

  let content = readFileSync(entryPath, 'utf-8');
  const dir = dirname(entryPath);

  // Find and process imports
  const importRegex = /import\s+(?:(?:\{[^}]*\}|[^{}\s]+)\s+from\s+)?['"]([^'"]+)['"]/g;
  const imports = [];
  let match;

  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1];
    if (importPath.startsWith('.')) {
      const resolvedPath = join(dir, importPath.replace(/\.js$/, '.js'));
      imports.push({ full: match[0], path: resolvedPath });
    }
  }

  // Process imports recursively
  let bundledImports = '';
  for (const imp of imports) {
    bundledImports += inlineBundle(imp.path, processedFiles);
    // Remove the import statement
    content = content.replace(imp.full + ';', '');
    content = content.replace(imp.full, '');
  }

  // Remove export statements for inlined code
  content = content.replace(/^export\s+/gm, '');

  return bundledImports + '\n' + content;
}

/**
 * Create bundled files
 */
function createBundles() {
  console.log('\n📦 Creating bundles...\n');

  const bundles = [
    { entry: 'background/background.js', output: 'background.js' },
    { entry: 'popup/popup.js', output: 'popup.js' },
    { entry: 'content/content.js', output: 'content.js' },
  ];

  for (const { entry, output } of bundles) {
    const entryPath = join(distDir, entry);
    const outputPath = join(rootDir, output);

    if (existsSync(entryPath)) {
      const bundled = inlineBundle(entryPath);
      // Clean up the bundle
      const cleaned = bundled
        .split('\n')
        .filter(line => !line.trim().startsWith('import '))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n');

      writeFileSync(outputPath, cleaned);
      console.log(`  ✓ ${output}`);
    } else {
      console.warn(`  ⚠ ${entry} not found`);
    }
  }
}

/**
 * Main build process
 */
function build() {
  console.log('🔨 Building Link Checker Extension...\n');

  compileTypeScript();
  createBundles();

  console.log('\n✅ Build complete!\n');
}

build();
