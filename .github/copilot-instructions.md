# Project guidelines

## Product context
- This project is an iPhone app for organizing pickleball tournaments and tracking matches.
- The app framework, persistence approach, and backend have not been selected.
- Ask before introducing a framework, backend, dependency, or significant architectural change.
- Do not assume tournament formats, scoring rules, tie-breakers, or permissions. Clarify missing rules before implementing them.

## Architecture
- Keep scheduling, score validation, standings, and tournament progression independent of UI, storage, and networking.
- Keep screens focused on presentation and user interaction.
- Isolate persistence and external integrations behind explicit interfaces.
- Prefer simple, focused modules over speculative abstractions.

## Implementation
- Inspect existing code and configuration before making changes.
- Make focused changes and preserve unrelated work.
- Use the selected language's strict type checking and follow established project conventions.
- Surface invalid input and failures explicitly; do not silently substitute successful results.
- Never commit secrets, signing credentials, or real player data. Use synthetic test fixtures.
- Update directly related documentation when behavior or setup changes.

## Verification
- Test changed tournament logic, including edge cases and invalid inputs.
- Use concrete examples to verify pairings, byes, score validity, standings, and result corrections.
- Run relevant tests, type checks, and lint checks when those tools are configured.
- No build, lint, or test commands exist yet. Document actual commands when tooling is added; do not invent them.
- Report what was checked and any limitations. Do not claim iOS behavior is verified by web-only tests.

## Workflow
- VS Code workspace MCP connections are defined in .vscode/mcp.json. GitHub uses interactive OAuth sign-in; never store tokens in that file.
- For substantial changes, outline a short plan and clarify unresolved behavior first.
- Implement in small, reviewable slices.
- Do not commit, push, publish, or deploy unless explicitly requested.
