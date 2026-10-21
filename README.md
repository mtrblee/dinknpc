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

A free Expo account is required for serving this project to Expo Go on a
physical iPhone. Expo CLI and Expo Go must be signed in to the same account.
No paid Expo plan or cloud build service is needed for this starter.

## Install and run

After cloning the repository:

```powershell
npm ci
npm start
```

The default development server binds to localhost and cannot be reached from
your iPhone. For a physical iPhone, stop that server, sign in to Expo CLI, and
explicitly enable local-network access:

```powershell
npx expo login
npm run start:device
```

Sign in to Expo Go on your iPhone with the same Expo account, then scan the
terminal QR code with the iPhone camera. GitHub sign-in is separate from Expo
sign-in. Use `npx expo whoami` to check the CLI account; do not put credentials
in source files or chat.

Your phone must be able to reach your computer on the same trusted local
network. A computer connected by Ethernet is fine if the network permits
communication with Wi-Fi devices. The LAN server serves development code to
reachable devices, so use it only on a trusted network.

### Troubleshooting an iPhone timeout

1. Keep the terminal running and use the QR code from `npm run start:device`,
   not from the localhost-only command.
2. Check the host in the printed `exp://HOST:PORT` URL. It must be a computer
   address reachable from the phone, not `localhost`, `127.0.0.1`, or an
   isolated virtual-machine address.
3. On the iPhone, open `http://HOST:PORT/status` in Safari using that same host
   and port. Metro should respond with `packager-status:running`. If Safari
   also times out, fix network reachability before investigating app code.
4. A VM, remote workstation, guest Wi-Fi, VPN, or network policy may isolate
   the phone from Metro. Prefer running Expo on the physical computer on the
   same trusted network as the phone. Changing the advertised address alone
   does not create a route to an isolated VM.
5. If iOS shows a local-network permission for Expo Go, allow it for your
   trusted network. If this is a managed network, ask its administrator about
   device-to-device access rather than weakening its controls.

Do not disable Windows Firewall, change a public network to private just to
bypass restrictions, forward router ports, or expose Metro through a public
tunnel. A successful Safari status response proves basic reachability, not
Expo account or SDK compatibility; those are separate checks.

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
