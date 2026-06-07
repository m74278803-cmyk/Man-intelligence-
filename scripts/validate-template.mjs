#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const errors = [];
const warnings = [];
const pathCache = new Map();
const startTime = Date.now();

// Regex patterns
const pluginNamePattern = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const marketplaceNamePattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Component configuration - centralized and DRY
const COMPONENT_CONFIGS = [
  {
    dir: "rules",
    component: "rule",
    requiredKeys: ["description"],
    extensions: [".md", ".mdc", ".markdown"],
    checkBasename: null,
  },
  {
    dir: "skills",
    component: "skill",
    requiredKeys: ["name", "description"],
    extensions: null,
    checkBasename: "SKILL.md",
  },
  {
    dir: "agents",
    component: "agent",
    requiredKeys: ["name", "description"],
    extensions: [".md", ".mdc", ".markdown"],
    checkBasename: null,
  },
  {
    dir: "commands",
    component: "command",
    requiredKeys: ["name", "description"],
    extensions: [".md", ".mdc", ".markdown", ".txt"],
    checkBasename: null,
  },
];

// Validation context for better error reporting
class ValidationContext {
  constructor(pluginName, componentType, filePath) {
    this.pluginName = pluginName;
    this.componentType = componentType;
    this.filePath = filePath;
  }

  addError(message) {
    const context = `${this.pluginName}/${this.componentType}`;
    const relativeFile = path.relative(repoRoot, this.filePath);
    addError(`${context}: ${message} (${relativeFile})`);
  }

  addWarning(message) {
    const context = `${this.pluginName}/${this.componentType}`;
    addWarning(`${context}: ${message}`);
  }
}

// ============ Utility Functions ============

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function cachedPathExists(targetPath) {
  if (pathCache.has(targetPath)) {
    return pathCache.get(targetPath);
  }
  const exists = await pathExists(targetPath);
  pathCache.set(targetPath, exists);
  return exists;
}

async function ensureDirectory(targetPath, context) {
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      addError(`${context} exists but is not a directory: ${targetPath}`);
      return false;
    }
    return true;
  } catch {
    addError(`${context} directory is missing: ${targetPath}`);
    return false;
  }
}

async function readJsonFile(filePath, context) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    addError(`${context} is missing: ${filePath}`);
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    addError(
      `${context} contains invalid JSON (${filePath}): ${error.message}`
    );
    return null;
  }
}

function normalizeNewlines(content) {
  return content.replace(/\r\n/g, "\n");
}

function parseFrontmatter(content) {
  const normalized = normalizeNewlines(content);
  if (!normalized.startsWith("---\n")) {
    return null;
  }

  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return null;
  }

  const frontmatterBlock = normalized.slice(4, closingIndex);
  const fields = {};

  for (const line of frontmatterBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    fields[key] = value;
  }

  return fields;
}

async function walkFiles(dirPath) {
  const files = [];
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return true;
  }
  if (path.isAbsolute(value)) {
    return false;
  }
  const normalized = path.posix.normalize(value.replace(/\\/g, "/"));
  return !normalized.startsWith("../") && normalized !== "..";
}

function extractPathValues(value) {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractPathValues(entry));
  }

  if (value && typeof value === "object") {
    const candidates = [];
    if (typeof value.path === "string") {
      candidates.push(value.path);
    }
    if (typeof value.file === "string") {
      candidates.push(value.file);
    }
    return candidates;
  }

  return [];
}

// ============ Validation Functions ============

async function validateReferencedPath(
  pluginDir,
  fieldName,
  pathValue,
  pluginName
) {
  if (pathValue.startsWith("http://") || pathValue.startsWith("https://")) {
    return;
  }

  if (!isSafeRelativePath(pathValue)) {
    addError(
      `${pluginName}: field "${fieldName}" has invalid path "${pathValue}". Use a relative path without ".." or absolute prefixes.`
    );
    return;
  }

  const resolved = path.resolve(pluginDir, pathValue);
  const exists = await cachedPathExists(resolved);
  if (!exists) {
    addError(
      `${pluginName}: field "${fieldName}" references missing path "${pathValue}".`
    );
  }
}

async function validateFrontmatterFile(
  filePath,
  config,
  pluginName,
  context
) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = parseFrontmatter(content);

    if (!parsed) {
      context.addError(
        `${config.component} file missing YAML frontmatter`
      );
      return;
    }

    for (const key of config.requiredKeys) {
      if (!parsed[key] || parsed[key].length === 0) {
        context.addError(
          `missing required frontmatter field: "${key}"`
        );
      }
    }
  } catch (err) {
    context.addError(`failed to read file: ${err.message}`);
  }
}

async function validateComponentFile(
  file,
  config,
  pluginDir,
  pluginName
) {
  // Check basename if required (e.g., SKILL.md)
  if (config.checkBasename) {
    if (path.basename(file) !== config.checkBasename) {
      return null; // Skip files that don't match
    }
  } else if (config.extensions) {
    // Check extension if specified
    const ext = path.extname(file).toLowerCase();
    if (!config.extensions.includes(ext)) {
      return null; // Skip files with wrong extension
    }
  }

  const context = new ValidationContext(pluginName, config.component, file);
  return validateFrontmatterFile(file, config, pluginName, context);
}

async function validateComponentFrontmatter(pluginDir, pluginName) {
  const validationTasks = [];

  for (const config of COMPONENT_CONFIGS) {
    const componentDir = path.join(pluginDir, config.dir);
    if (await cachedPathExists(componentDir)) {
      try {
        const files = await walkFiles(componentDir);
        
        // Parallelize file validation for each component
        const tasks = files
          .map((file) =>
            validateComponentFile(file, config, pluginDir, pluginName)
          )
          .filter((task) => task !== null);

        validationTasks.push(...tasks);
      } catch (err) {
        addError(
          `${pluginName}: failed to validate ${config.component} directory: ${err.message}`
        );
      }
    }
  }

  // Execute all validations in parallel
  await Promise.all(validationTasks);
}

function resolveMarketplaceSource(source, pluginRoot) {
  if (typeof source !== "string" || source.length === 0) {
    return null;
  }
  if (!pluginRoot) {
    return source;
  }
  const normalizedRoot = pluginRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedSource = source.replace(/\\/g, "/");
  if (
    normalizedSource === normalizedRoot ||
    normalizedSource.startsWith(`${normalizedRoot}/`)
  ) {
    return normalizedSource;
  }
  return `${normalizedRoot}/${normalizedSource}`;
}

async function validatePluginEntry(
  entry,
  index,
  marketplace,
  seenNames
) {
  const label = `plugins[${index}]`;

  if (!entry || typeof entry !== "object") {
    addError(`${label} must be an object.`);
    return false;
  }

  if (typeof entry.name !== "string" || !pluginNamePattern.test(entry.name)) {
    addError(
      `${label}.name must be lowercase and use only alphanumerics, hyphens, and periods.`
    );
    return false;
  }

  if (seenNames.has(entry.name)) {
    addError(`Duplicate plugin name in marketplace manifest: "${entry.name}"`);
    return false;
  }
  seenNames.add(entry.name);

  // Resolve source path
  const pluginRoot = marketplace.metadata?.pluginRoot;
  const sourcePath = resolveMarketplaceSource(entry.source, pluginRoot ?? "");
  if (!sourcePath) {
    addError(`${label}.source must be a string path.`);
    return false;
  }
  if (!isSafeRelativePath(sourcePath)) {
    addError(
      `${label}.source is not a safe relative path: "${sourcePath}"`
    );
    return false;
  }

  // Verify plugin directory exists
  const pluginDir = path.join(repoRoot, sourcePath);
  const pluginDirExists = await ensureDirectory(pluginDir, `${label}.source`);
  if (!pluginDirExists) {
    return false;
  }

  return { entry, pluginDir, label };
}

async function validatePluginManifest(
  pluginDir,
  entry,
  label,
  pluginName
) {
  const manifestPath = path.join(pluginDir, ".cursor-plugin", "plugin.json");
  const pluginManifest = await readJsonFile(
    manifestPath,
    `${pluginName} plugin manifest`
  );

  if (!pluginManifest) {
    return null;
  }

  // Validate plugin manifest name
  if (
    typeof pluginManifest.name !== "string" ||
    !pluginNamePattern.test(pluginManifest.name)
  ) {
    addError(
      `${pluginName}: "name" in plugin.json must be lowercase and use only alphanumerics, hyphens, and periods.`
    );
  }

  if (pluginManifest.name && pluginManifest.name !== entry.name) {
    addError(
      `${pluginName}: marketplace entry name does not match plugin.json name ("${pluginManifest.name}").`
    );
  }

  return pluginManifest;
}

async function validatePluginPaths(
  pluginDir,
  pluginManifest,
  pluginName
) {
  const manifestFields = [
    "logo",
    "rules",
    "skills",
    "agents",
    "commands",
    "hooks",
    "mcpServers",
  ];

  const pathValidationTasks = [];
  
  for (const field of manifestFields) {
    const values = extractPathValues(pluginManifest[field]);
    for (const value of values) {
      pathValidationTasks.push(
        validateReferencedPath(pluginDir, field, value, pluginName)
      );
    }
  }

  await Promise.all(pathValidationTasks);
}

async function validatePluginOptionalFiles(pluginDir, pluginName) {
  const hooksPath = path.join(pluginDir, "hooks", "hooks.json");
  if (!(await cachedPathExists(hooksPath))) {
    addWarning(
      `${pluginName}: no hooks/hooks.json file found (only needed when using hooks).`
    );
  }

  const mcpPath = path.join(pluginDir, "mcp.json");
  if (!(await cachedPathExists(mcpPath))) {
    addWarning(
      `${pluginName}: no mcp.json file found (only needed when using MCP servers).`
    );
  }
}

async function validatePlugin(entry, index, marketplace, seenNames) {
  const pluginValidation = await validatePluginEntry(
    entry,
    index,
    marketplace,
    seenNames
  );

  if (!pluginValidation) {
    return;
  }

  const { entry: pluginEntry, pluginDir, label } = pluginValidation;
  const pluginName = pluginEntry.name;

  // Validate plugin manifest
  const pluginManifest = await validatePluginManifest(
    pluginDir,
    pluginEntry,
    label,
    pluginName
  );

  if (!pluginManifest) {
    return;
  }

  // Parallelize remaining validations
  const validationTasks = [
    validatePluginPaths(pluginDir, pluginManifest, pluginName),
    validateComponentFrontmatter(pluginDir, pluginName),
    validatePluginOptionalFiles(pluginDir, pluginName),
  ];

  await Promise.all(validationTasks);
}

// ============ Main Validation Logic ============

async function main() {
  const marketplacePath = path.join(repoRoot, ".cursor-plugin", "marketplace.json");
  const marketplace = await readJsonFile(marketplacePath, "Marketplace manifest");
  if (!marketplace) {
    summarizeAndExit(0);
    return;
  }

  // Validate marketplace metadata
  if (
    typeof marketplace.name !== "string" ||
    !marketplaceNamePattern.test(marketplace.name)
  ) {
    addError(
      'Marketplace "name" must be lowercase kebab-case and start/end with an alphanumeric character.'
    );
  }

  if (
    !marketplace.owner ||
    typeof marketplace.owner.name !== "string" ||
    marketplace.owner.name.length === 0
  ) {
    addError('Marketplace "owner.name" is required.');
  }

  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    addError('Marketplace "plugins" must be a non-empty array.');
    summarizeAndExit(0);
    return;
  }

  // Validate pluginRoot if specified
  const pluginRoot = marketplace.metadata?.pluginRoot;
  if (pluginRoot !== undefined) {
    if (typeof pluginRoot !== "string" || !isSafeRelativePath(pluginRoot)) {
      addError('Marketplace "metadata.pluginRoot" must be a safe relative path.');
    } else {
      const pluginRootAbs = path.join(repoRoot, pluginRoot);
      await ensureDirectory(pluginRootAbs, 'Marketplace "metadata.pluginRoot"');
    }
  }

  // Validate plugins
  const seenNames = new Set();
  const pluginValidationTasks = [];

  for (const [index, entry] of marketplace.plugins.entries()) {
    // Parallelize plugin validation
    pluginValidationTasks.push(
      validatePlugin(entry, index, marketplace, seenNames)
    );
  }

  await Promise.all(pluginValidationTasks);

  summarizeAndExit(seenNames.size);
}

function summarizeAndExit(pluginsValidated = 0) {
  const duration = Date.now() - startTime;

  // Print report header
  console.log("\n📊 Validation Report");
  console.log("├─ Plugins Validated:", pluginsValidated);
  console.log("├─ Errors:", errors.length);
  console.log("├─ Warnings:", warnings.length);
  console.log("└─ Duration:", `${duration}ms`);
  console.log("");

  // Print warnings
  if (warnings.length > 0) {
    console.log("⚠️  Warnings:");
    for (const warning of warnings) {
      console.log(`  • ${warning}`);
    }
    console.log("");
  }

  // Print errors and exit
  if (errors.length > 0) {
    console.error("❌ Validation failed:");
    for (const error of errors) {
      console.error(`  • ${error}`);
    }
    process.exit(1);
  }

  console.log("✅ Validation passed.");
}

await main();
