# Project guidelines

## Product context
- This project is an iPhone app for tracking individual pickleball standings within player-created groups.
- Read docs/product.md before changing group, score, ranking, or simulated money behavior. The approved prototype is doubles-only, local-only, and in-memory.
- Money is simulated USD tracking only. Do not introduce deposits, transfers, settlement, or payment integrations.
- The app uses React Native with Expo SDK 57, React 19, and strict TypeScript. SDK 57 was selected for current Expo Go compatibility.
- Persistence and backend services have not been selected. Navigation is not configured.
- Ask before introducing a framework, backend, dependency, or significant architectural change.
- Do not assume scoring rules, tie-breakers, group permissions, or payment requirements. Clarify missing rules before implementing them.

## Architecture
- App.tsx owns local in-memory group state; index.ts registers the Expo root component. Group screens live in src/features/groups.
- Keep domain logic in src/domain with colocated tests and shared model types in src/types.
- Keep score validation, standings, and simulated money calculations independent of UI, storage, and networking.
- Store simulated money as integer cents and derive standings from completed games. Reject invalid input and unsafe numeric totals explicitly.
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
- Test changed group and game logic, including edge cases and invalid inputs.
- Verify distinct doubles players, score validity, shared ranks, simulated zero-sum money, and deletion recalculation.
- Run relevant tests, type checks, and lint checks when those tools are configured.
- Run npm run typecheck for TypeScript validation and npx expo install --check for SDK dependency compatibility.
- Run npm test for domain tests or npm run test:coverage for coverage. The tests use Node.js 24's built-in test runner and TypeScript stripping; no extra testing dependency is needed.
- No linter or UI test runner is configured. Do not claim UI or native-device behavior is verified by domain tests.
- See README.md for startup commands and platform limitations. Update actual commands when tooling changes.
- Report what was checked and any limitations. Do not claim iOS behavior is verified by web-only tests.

## Workflow
- VS Code workspace MCP connections are defined in .vscode/mcp.json. GitHub uses interactive OAuth sign-in; never store tokens in that file.
- For substantial changes, outline a short plan and clarify unresolved behavior first.
- Implement in small, reviewable slices.
- Do not commit, push, publish, or deploy unless explicitly requested.
