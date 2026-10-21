# DinkNPC

An iPhone app for tracking pickleball scores and individual rankings within
groups of friends.

The current prototype supports creating groups, adding players, setting up
doubles games with a simulated per-player USD wager, recording results, and
viewing individual standings and game history. It does not process real money.

**All data is held in memory and is lost when the app restarts.** There are no
accounts, shared groups across devices, or backend services.

See [product rules](docs/product.md) for the approved calculations and scope.

## Stack

- React Native with Expo SDK 57
- React 19 and strict TypeScript
- npm with a committed package-lock.json for reproducible dependency installs

SDK 57 was selected because Expo's current setup guidance recommends it for
Expo Go on physical devices during the SDK 58 transition. Check Expo Go support
before upgrading. Navigation, persistence, and backend services are not yet selected.

## Prerequisites

- Node.js 24 LTS and npm
- VS Code or another editor
- Expo Go on an iPhone for physical-device testing

No Expo account or cloud service is needed for this local starter.

## Install and run

After cloning the repository:

```powershell
npm ci
npm start
```

The default development server binds to localhost. For an iPhone on the same
trusted Wi-Fi network, stop the server and explicitly enable local-network access:

```powershell
npx expo start --lan
```

Scan the terminal QR code with the iPhone camera and open it in Expo Go. Your
phone must be able to reach your computer; VPNs and Windows Firewall can block
the connection. Do not disable the firewall or expose the development server
to the public internet. The LAN server serves development code to reachable
devices, so use it only on a trusted network.

Windows cannot run Apple's iOS Simulator or compile native iOS builds locally.
On a Mac with Xcode and its simulator installed, use:

```powershell
npm run ios
```

With an Android emulator already installed and running, use:

```powershell
npm run android
```

Web support is not installed in this minimal starter. Expo Go also supports
only a defined set of native capabilities; custom native libraries may require
a development build.

## Checks

```powershell
npm run typecheck
npm test
npm run test:coverage
npx expo install --check
```

Tests use Node.js 24's built-in test runner with TypeScript stripping. The
JavaScript test harness imports the pure TypeScript domain module directly;
no extra test dependencies are required. Coverage is scoped to the domain
implementation, not the React Native UI.

### Current validation limitations

The installed SDK is Expo `57.0.28`. Expo's compatibility check currently
recommends `~57.0.31`, but that patch was unavailable from the configured npm
feed during setup. Direct access to the public npm registry also failed with a
TLS handshake error. Type checking and iOS JavaScript export succeeded; this
does not resolve the dependency compatibility warning or prove Expo Go
compatibility on your phone.

When the patch becomes available, approve and install the compatible SDK 57
update, then rerun the checks above. Do not disable TLS verification or suppress
the compatibility check.

The initial npm audit reported 22 dependency advisories (15 high, 7 moderate),
including Expo/React Native dependencies. They remain unresolved; do not use
`npm audit fix --force`, which proposes incompatible downgrades. Recheck the
audit when updating the SDK and review compatible fixes before release.

To verify that Metro can produce an iOS JavaScript bundle without Xcode:

```powershell
npx expo export --platform ios --output-dir dist
```

An export is not a signed iOS application and does not verify behavior on an
iPhone. No linter or UI test runner is configured yet.

## Try the prototype

1. Create a group and add four distinct players.
2. Select two players on Team A and two on Team B.
3. Enter `5.00` as the simulated wager and tap **Start game**.
4. Enter final scores of `11` for Team A and `7` for Team B, then save.
5. Each Team A player should have one win, a +4 point differential, and +$5.00
   simulated net. Each Team B player should have one loss, a -4 differential,
   and -$5.00 simulated net.
6. Confirm deletion of the result. All four players should become unranked
   with zero wins, losses, point differential, and simulated net.
7. Create a second group to check that its players and results are independent.

These are manual device checks, not claims that device testing has been performed.

## Project layout

- `App.tsx`: group selection and in-memory application state
- `src/domain/`: pure group/game calculations and colocated domain tests
- `src/types/`: shared domain model types
- `src/features/groups/`: group, game entry, standings, and history presentation
- `index.ts`: Expo root registration
- `app.json`: app metadata and platform configuration
- `assets/`: template icons and image assets; replace before release
- `.github/copilot-instructions.md`: project-specific AI coding guidance
- `.vscode/mcp.json`: GitHub MCP connection using interactive OAuth

Keep score validation, standings, and simulated money calculations independent
of UI and storage. Do not infer missing product rules.

## Working safely

- Use synthetic player data in tests and examples.
- Never commit tokens, local environment secrets, or signing credentials.
- Ask before adding dependencies, backend services, or major architecture.
- Keep the lockfile updated with intentional dependency changes.
- The Expo starter includes its upstream MIT license in `LICENSE`.
