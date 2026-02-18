# js-website-build-tools

JS tools to help with processing templates to build websites that are both static and dynamic compatible. These scripts are designed for use in build systems like GNU Make, particularly for handling Mustache templating, data merging, validation, and content generation in structured web projects (e.g., story-driven sites with chats, terminals, and navigation).

## Scripts

All scripts are Node.js executables (run with `node script.js`). Most support CLI options (use `--help` or no args for usage where available). They are designed to work together in build pipelines, especially with GNU Make.

### Core Templating & Substitution

- **mustache_substitution.js**  
  Renders Mustache templates with custom delimiters, strict variable checking (errors/warnings on undefined vars), JSON/YAML context merging, and stdin/stdout support.

- **mustache_file.js**  
  Injects file contents into templates via `{{{file:path}}}` placeholders. Supports path variables (`$var`), root paths, recursive replacement, and double-brace warnings in dev mode.

### Navigation & Page Resolution

- **list_pages.js**  
  Extracts flat list of page file paths from navigation YAML, handling shared directories and nested tracks. Ideal for generating Make targets or build lists.

- **next_page_resolver.js**  
  Finds next page(s) in navigation structure for a given current page. Outputs JSON ready for template substitution. Includes built-in unit tests (`--test`).

- **ensure_substitutions.js**  
  Checks that a Mustache template contains all required substitution keys. Errors (or warns in dev mode) on missing variables to catch mismatches early.

### Validation & Schema Tools

- **schema_validator.js**  
  Validates JSON/YAML data against JSON Schema files. Supports external $ref, development mode (looser rules), warnings, verbose output, and reference loop prevention.

## Integration Instructions

To integrate these tools into a new project's Makefile without cloning the full repo, use `curl` or `wget` to fetch versioned scripts directly from GitHub. This keeps your project lightweight while ensuring reproducibility via Git tags or commits.

### Step 1: Set Up a Tools Directory

Create a `tools/` directory in your project (add it to `.gitignore` if you don't want to commit the downloaded files). Use a Makefile target to download the scripts on-demand.

### Step 2: Makefile Snippet

Add something like this to your project's Makefile. The example fetches all scripts, but you can customize for only what you need.

```makefile
TOOLS_DIR = tools
REPO_URL = https://raw.githubusercontent.com/BebeSparkelSparkel/js-website-build-tools
VERSION = HEAD  # Or a tag or commit hash

SCRIPTS = \
  mustache_substitution.js \
  list_pages.js \
  ensure_substitutions.js \
  next_page_resolver.js \
  css_generator.js \
  schema_validator.js \
  substitution_merge.js \
  mustache_file.js

# Create tools dir if needed
$(TOOLS_DIR):
	mkdir -p $@

# Download individual scripts
$(TOOLS_DIR)/%.js: | $(TOOLS_DIR)
	curl -L -o $@ $(REPO_URL)/$(VERSION)/$*.js
	chmod +x $@

# Phony target to fetch all tools
fetch-tools: $(addprefix $(TOOLS_DIR)/,$(SCRIPTS))

# Example: Make your build depend on tools
build: fetch-tools
	$(TOOLS_DIR)/list_pages.js --navigation navigation.yaml --root-path pages > page_list.txt
	# Add more rules here...
```

- **Usage**: Run `make fetch-tools` to download/update the scripts. Your build rules can then reference them like `$(TOOLS_DIR)/script.js`.
- **Versioning**: Always pin to a tag/commit to avoid breaking changes.
- **Dependencies**: Ensure Node.js is installed. Some scripts require packages like `js-yaml`, `commander`, `mustache`, etc.—install them via `npm install` in your project if needed, or include an `npm install` step in the Makefile.

This approach integrates seamlessly with existing Makefiles (like the example one provided), allowing you to call the tools in rules for validation, merging, and rendering. For complex projects, consider combining with Git submodules or npm if curl/wget feels too manual.
