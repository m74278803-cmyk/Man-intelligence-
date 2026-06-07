# Add a plugin

Add a new plugin under `plugins/` and register it in `.cursor-plugin/marketplace.json`.

## 1. Create plugin directory

Create a new folder:

```text
plugins/my-new-plugin/
```

Add the required manifest:

```text
plugins/my-new-plugin/.cursor-plugin/plugin.json
```

Example manifest:

```json
{
  "name": "my-new-plugin",
  "displayName": "My New Plugin",
  "version": "0.1.0",
  "description": "Describe what this plugin does",
  "author": {
    "name": "Your Org"
  },
  "logo": "assets/logo.svg"
}
```

## 2. Add plugin components

Add only the components you need:

- `rules/` with `.mdc` files (YAML frontmatter required)
- `skills/<skill-name>/SKILL.md` (YAML frontmatter required)
- `agents/*.md` (YAML frontmatter required)
- `commands/*.(md|mdc|markdown|txt)` (frontmatter recommended)
- `hooks/hooks.json` and `scripts/*` for automation hooks
- `mcp.json` for MCP server definitions
- `assets/logo.svg` for marketplace display

## 3. Register in marketplace manifest

Edit `.cursor-plugin/marketplace.json` and append a new entry:

```json
{
  "name": "my-new-plugin",
  "source": "./plugins/my-new-plugin",
  "description": "Describe your plugin",
  "tags": ["category", "keyword"]
}
```

`source` is the relative path from the repository root to the plugin folder.

## 4. Validate

```bash
node scripts/validate-template.mjs
```

Fix all reported errors before committing.

## 5. Validation Checklist

Before committing, ensure:

- [ ] Plugin name matches between `marketplace.json` and `plugin.json`
- [ ] All file paths use forward slashes (no backslashes)
- [ ] No circular dependencies between plugins
- [ ] All frontmatter fields (`name`, `description`) have non-empty values
- [ ] All referenced paths in manifest exist
- [ ] Plugin size is under 10MB (recommended: < 5MB)
- [ ] No external dependencies unless necessary
- [ ] All relative paths point to existing files

## 6. Common Pitfalls

- Plugin `name` not kebab-case
- `source` path in marketplace manifest does not match folder name
- Missing `.cursor-plugin/plugin.json` in plugin folder
- Missing required frontmatter keys (`name`, `description`) in skills, agents, or commands
- Rule files missing frontmatter `description`
- Using a filename other than `mcp.json` for MCP server definitions
- Broken relative paths for `logo`, `hooks`, or `mcpServers` in manifest files
- Using absolute paths instead of relative paths
- Extra whitespace or special characters in frontmatter values

## 7. Performance Considerations

- **Size**: Keep plugins under 5MB for faster installation
- **Dependencies**: Minimize external dependencies
- **Paths**: Always use relative paths for all assets
- **Files**: Avoid large binary files; prefer SVG for logos
- **Validation**: Run `validate-template.mjs` before every commit

The validation script now runs in **parallel** for better performance:

- File I/O operations are cached to avoid redundant checks
- Component validation runs concurrently across all plugins
- Path existence checks are memoized

Run with verbose output:

```bash
node scripts/validate-template.mjs 2>&1 | tee validation-report.log
```

## 8. Troubleshooting

### Validation fails with "file missing YAML frontmatter"

Ensure your file starts with:

```markdown
---
name: "Your Component Name"
description: "Clear, concise description"
---

# Content starts here
```

### "referenced path missing" error

Verify:
- Path uses forward slashes: `path/to/file` ✅ not `path\to\file` ❌
- Path is relative to plugin root
- File actually exists in the repository

### Duplicate name error

Check that:
- Plugin name in `marketplace.json` differs from other entries
- Plugin `name` field in `plugin.json` differs from other plugins
- No typos or case-sensitivity issues (names must be lowercase)
