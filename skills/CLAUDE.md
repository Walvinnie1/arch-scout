# Arch-Scout Protocol for Claude Code

When assisting in this repository or any codebase adhering to `arch-scout`:

## Mandate: Ground Before Implementation
Avoid generating bespoke, fragile boilerplate for utilities and infrastructure. Always prioritize reusing existing codebase utilities, installed dependencies, or battle-tested open-source libraries.

## Workflow Before Generating Code (>35 lines of logic or complex domains):
1. **Local Architecture Discovery:**
   - Scan local shared directories (`src/utils`, `src/lib`, `common/`, etc.).
   - Inspect manifest files (`package.json`, `pyproject.toml`, `requirements.txt`, `Cargo.toml`, `pom.xml`, `go.mod`).
2. **Ecosystem & Supply Chain Check:**
   - If MCP tools (`scan_workspace_architecture`, `lookup_package_ecosystem`) are configured, run them.
   - Otherwise, verify standard libraries or reputable packages (checking license, zero CVEs, active maintenance).
3. **Architectural Decision Brief (Gate):**
   - If reusing an external library or installed dependency requires user consent, present a concise table comparing **Reuse/Install** vs. **Bespoke Build**.
   - Provide a clear recommendation.
   - Await confirmation before writing full implementation code.
