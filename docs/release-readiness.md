# App Store and production authentication readiness

**Status: not ready for public release.** This checklist documents remaining
work; it does not configure or publish a release. On 2026-10-24, the user
requested an App Store release and selected separate production Azure and
Supabase services, then **paused that public-release work in favor of a TestFlight
beta for friends using the existing development backend**. No new production
services are approved. On 2026-10-26, the user separately approved converting
the existing development SQL database to Standard S0 (approximately $15/month
database-only retail) to resolve free-quota exhaustion. Production subscription,
hosting costs, provider setup, and the acceptance checks below remain unresolved.
The TestFlight beta was built and uploaded as recorded below. No production
services, external beta review, or public App Review submission have been completed.

## Current TestFlight beta work

- On 2026-10-27, the user approved uploading the History UI update and requested
  app version **1.0.1**. The project now advances patch versions for newly
  approved releases, retaining the same version for retries while EAS increments
  the separate numeric iOS build number; see the [release version policy](../README.md#release-version-policy).
  [Build 1.0.1 (3)](https://expo.dev/accounts/dinknpc/projects/dinknow/builds/e830b6f6-80aa-4d32-b990-17f0f3460baf)
  finished at `2026-10-27T14:15:00.757Z`. The actual IPA contains the updated
  History styling, all three approved public backend settings, the expected
  identity/version, and App Store provisioning without device allow-lists or
  debugging entitlement. SDK: iPhoneOS 27.1; minimum iOS: 16.4.
  IPA size: 10,081,044 bytes; embedded JavaScript: 2,579,921 bytes.
  SHA256: `3f7e72d5651319d443fb90ec2e804a4785edf92261a4ea4e5b4b25b1546a36b7`.
  [Submission 2fc5b427-6218-4727-af31-d3ba1d3c52b4](https://expo.dev/accounts/dinknpc/projects/dinknow/submissions/2fc5b427-6218-4727-af31-d3ba1d3c52b4)
  failed with EAS `UNKNOWN_ERROR`; the authenticated submission query returned
  no log files. At that point App Store Connect still showed only 1.0.0 (2).
  [Retry submission 63363709-b79c-47a5-adf9-195e8efc48d4](https://expo.dev/accounts/dinknpc/projects/dinknow/submissions/63363709-b79c-47a5-adf9-195e8efc48d4)
  subsequently succeeded using the same verified 1.0.1 (3) build.
  App Store Connect independently showed its upload as **Complete** on
  2026-10-27 and **1.0.1 (3): Testing** in the existing internal `ITP` group.
  Internal installation records were also visible. No app-version bump,
  rebuild, tester invitation, or group-setting change was performed for this retry.
  No new public release or external tester invitations were requested.
  This IPA contains the History update, not the later tournament presentation
  changes; those require a separately approved release, next version 1.0.2.
  Native appearance of the new layout still
  needs an installed-device check; component mocks and package inspection do not
  prove native rendering. Temporary archive, IPA, and environment-readback files
  were removed after verification.
- The user created the App Store Connect record and supplied Apple ID
  `6826646735` for DinkNow (`com.dinknpc.dinknow`).
- The `beta` EAS profile uses store distribution, disables the development
  client, increments the local build number, and selects the `preview` EAS
  environment for the development backend's public connection values.
- The three public preview variables were configured and read back against the
  current development API's authentication project. A standalone iOS export
  with local dotenv disabled embedded all three values (2,579,103 bytes).
  Upload inspection verified 79 files with no Git metadata, local environment
  files, signing credentials, backend, or infrastructure. Strict app/API types
  and 57 authentication/API-client tests passed; five known SDK patch warnings
  remain. These checks do not verify the signed beta on an iPhone.
- A standalone beta embeds its JavaScript and requires no Metro server, local
  Wi-Fi connection, Expo Go, or tester device registration.
- The user confirmed custom SMTP is configured and a non-team address received
  a verification email. The user subsequently confirmed TestFlight 1.0.0 (2)
  loads groups over cellular with Wi-Fi off, password recovery succeeds, and
  disposable-account deletion completes with subsequent sign-in rejected.
  These are user-confirmed happy paths, not full native acceptance of every
  lifecycle, group, or tournament edge case.
- A read-only configuration check found a nonempty server-only account-deletion
  key already present. Its value was not printed or changed. This establishes
  configuration presence, not successful provider deletion or worker acceptance.
  API health, unauthenticated-access rejection, and a read-only runtime SQL
  receipt lookup passed.
- [Beta build 1.0.0 (2)](https://expo.dev/accounts/dinknpc/projects/dinknow/builds/e6b35be0-f8bf-441b-86f9-647bddca8fa9)
  finished at `2026-10-24T18:46:22.987Z`. The actual IPA was checked for the
  expected app/version identity, App Store provisioning without device allow-lists
  or debugging entitlement, Xcode/iOS SDK 27.1, minimum iOS 16.4, and all three
  public connection values in its embedded JavaScript. This is not a
  cryptographic code-signing verification or an on-device acceptance test.
  IPA size: 10,080,715 bytes.
  SHA256: `322F44F21CC2EA2FB473F6320317A8AD79696F710B8015EFDC58B8A8964C1582`.
- [Submission 8ab2efc9-9837-4ecc-acc8-82b7c00428fc](https://expo.dev/accounts/dinknpc/projects/dinknow/submissions/8ab2efc9-9837-4ecc-acc8-82b7c00428fc)
  successfully uploaded that exact build. App Store Connect independently showed
  **Version 1.0.0, Build (2): Processing** on 2026-10-24. Apple authentication and
  creation of an EAS-managed App Store Connect API key happened in the interactive
  terminal; no credential values were added to the repository.
- The user's installed TestFlight build confirms availability for internal
  testing. The existing internal `ITP` group and owner invitation were preserved.
  A separate [Friends external group](https://appstoreconnect.apple.com/apps/6826646735/testflight/groups/67d6d57e-ee6e-4e7e-9b83-3c69755470f1)
  was created for the user's selected individual email invitations. It has no
  builds/testers yet; no public link or friend invitations were enabled.
- A signup blocker was found: the hosted confirmation email used
  `{{ .ConfirmationURL }}`, which opened a localhost browser redirect instead of
  showing the app's expected code. The signup body was saved with `{{ .Token }}`
  and verified on a fresh dashboard page, preserving the subject and SMTP
  settings. The recovery template already uses a code and was left unchanged.
  A fresh signup-email/device test is still required before external invitations.
- Complete email/lifecycle edge-case acceptance, beta metadata/reviewer access,
  external beta review, and friend invitations remain pending. Uploading to
  TestFlight is not a public App Store release.
- On 2026-10-26, the data-service outage was resolved by an approved in-place
  conversion from free serverless SQL to Standard S0 with a supported 40 GiB
  storage limit. SQL connectivity, the deployed API's SQL-backed receipt lookup,
  and unchanged spending-limit/budget settings were verified. The user confirmed
  groups load normally again in TestFlight. See the [outage and cost record](azure.md#october-2026-free-quota-outage-and-recovery);
  representative multi-user performance remains unverified.
- Apart from that SQL tier change, the local Metro workflows and existing
  development Azure/Supabase endpoints are unchanged. No native rebuild or API
  deployment was needed for recovery. Do not create production resources or
  convert the Visual Studio subscription as part of this beta work.
- On 2026-10-27, the user separately approved the
  [pool-round enforcement API deployment](azure.md#pool-round-enforcement-rollout-2026-10-27-utc).
  Its active deployment, unchanged application settings, and read-only HTTP/SQL
  probes were verified. The new tournament UI is available through Expo Go,
  not the already-built 1.0.1 (3) IPA. No migration or native release was included
  in that API approval; live SQL write tests and native UI acceptance remain pending.
- The user subsequently approved the
  [current display-name API rollout](azure.md#current-display-name-rollout-2026-10-27-utc),
  which was independently verified without migration or settings changes.
  Expo Go now includes synchronized name saves, current tournament/roster names,
  per-game ready/waiting/completed labels, personal current-game cues, and
  an owner/admin seed-confirmation tile above the tabs. Pool retains seed review
  and exact-tie editing. None of these client changes are in the earlier
  1.0.1 (3) IPA; no new native release was requested or submitted.
  The user confirmed the corrected display name in Expo Go player selectors
  after a reload; this does not verify the new layouts or flows in TestFlight.

## Prior development build

Apple Developer membership was confirmed active by the user on 2026-10-24.
The user separately approved EAS internal iPhone development builds under
`@dinknpc/dinknow`, with bundle identifier `com.dinknpc.dinknow`.
That initial development-build approval was separate from the subsequent
App Store release request above.
The first signed internal development build,
[1.0.0 (1)](https://expo.dev/accounts/dinknpc/projects/dinknow/builds/d0d3631c-4324-4f6a-84b2-b46518cee2e7),
finished successfully at `2026-10-24T17:56:01.997Z`; its installation artifact
was verified available. The user confirmed installation and launch with the new
DinkNow icon on the registered iPhone. This is not full signed-device acceptance
of signup, recovery, deletion, or game workflows. The user completed the
interactive signing/registration and encryption prompts; no passwords,
verification codes, or signing files were
saved in the repository.
The initial preparation phase was account recovery/deletion, ahead of
EAS/TestFlight configuration and final artwork/store metadata. The selected app name is
**DinkNow** (Expo slug `dinknow`); this local rename does not reserve the name in
App Store Connect or verify name availability. With separate approval, migration 008, scoped
SQL grants, and the updated API were deployed to development on 2026-10-23.
The server-secret setup was pending at that deployment; the beta preflight now
confirms a key is present. Real provider deletion and signed-device acceptance
remain unverified.

## Current implementation

- Email/password signup and login through Supabase, with in-app email-code
  confirmation and resend support.
- Native SecureStore sessions, account-change isolation, and explicit failures.
- Locally implemented email-code recovery with an isolated, nonpersistent session.
- Development-deployed owner transfer/group deletion and anonymous account erasure,
  with a durable SQL job and retryable server-only Supabase deletion worker.
- Azure Functions/SQL persistence with managed identity, API authorization,
  row versions, and idempotent writes.
- Development-deployed startup optimization: lightweight authorized group summaries,
  on-demand full histories/statistics, deferred hidden screens, and opt-in
  performance diagnostics. Cold/warm physical-device measurements are still
  pending; see [startup performance](azure.md#startup-performance).
- Group/member workflows and the fixed-round-robin tournament feature described
  in [product rules](product.md) and [tournament instructions](tournaments.md).
- Development validation includes unit/API tests, live synthetic SQL tests,
  TypeScript, and iOS JavaScript bundling. These do not replace a signed-device
  release test.

For the new lifecycle slice specifically, local unit/API tests, synthetic
component-state checks, type checks, the API build, and a current iOS JavaScript
bundle have passed. All five live SQL suites, including lifecycle/race checks
and summary counts, passed during the development rollout; provider deletion
used a fake adapter, not real Supabase accounts. The deployed API passed health,
unauthenticated-access rejection, and runtime SQL connectivity checks.
Provider configuration and real-device flows remain unverified.
Expo compatibility checking now reports five SDK 58 patch recommendations,
including the subsequently added development client. See the current versions
and package-registry limitations in [README](../README.md#current-validation-limitations).

## Blocking account work

### 1. Production email delivery

- [ ] Select and approve a custom SMTP provider and sending domain.
- [ ] Configure its credentials in Supabase's server-side settings, never in the
  Expo bundle or repository. Configure the provider's required domain records.
- [ ] Keep email confirmation enabled and use the code-based signup template.
- [ ] Test signup and verification with addresses **outside the Supabase project
  team**, including delivery, spam handling, expiry, resend limits, duplicate
  registration, and retries.
- [ ] Set suitable email/auth rate limits and abuse controls without reducing
  account security to bypass delivery problems.

Supabase's default sender is restricted to project-team addresses, heavily
rate-limited, and not intended for production. Successful testing with the
developer's own email does not prove public signup works.

### 2. Account recovery

- [x] Add forgot-password, code verification, password confirmation, and completion UI.
- [x] Isolate recovery from ordinary authenticated access and persistent storage.
- [x] Unit-test invalid/expired codes, policy failures, partial completion,
  retries, and non-enumerating email-request handling.
- [ ] Configure the Reset password email template using `{{ .Token }}`.
- [ ] Prove public email delivery, expiry/throttling, new/old password behavior,
  session revocation, interruptions, and signed-iPhone operation against Supabase.

The implementation is not evidence that the project's email template or live
recovery delivery is configured. See [authentication setup](authentication.md).

### 3. In-app account deletion

- [x] Confirm policy: resolve owned groups by transfer/deletion; preserve shared
  results as per-group anonymous Deleted player entries; exclude them from new
  games/tournaments but let already-enrolled tournaments finish.
- [x] Implement Settings initiation, current-password proof, typed/final
  confirmation, owner-resolution links, and pending/completed receipt UI.
- [x] Prepare authorized SQL erasure and retryable Supabase hard-deletion code.
- [x] Separately approve/apply migration 008 and scoped runtime grants.
- [x] Separately approve and complete development API deployment.
- [x] Run live SQL lifecycle/race tests using synthetic fixtures and fake provider deletion.
- [ ] Securely configure the server-only Supabase administrative key and verify
  the worker with disposable-account end-to-end tests.
- [ ] Clear local sessions/caches, prevent further access, and test the approved
  shared-data policy without corrupting remaining group standings/brackets.
- [ ] Approve accurate deletion timing, security-hash metadata, logs/backups,
  retention, and restoration disclosures. Do not invent legal retention duties.

Apple requires apps that support account creation to let users initiate account
deletion in the app. Sign-out, hiding a profile, or account deactivation is not
a substitute. Local implementation must pass configuration and device acceptance
before it can be treated as an operational release feature.

## Privacy, safety, and operating readiness

- [ ] Provide an approved, publicly reachable privacy-policy URL and support
  contact, and expose the appropriate links in the app and App Store Connect.
- [ ] Inventory actual data and SDK flows before completing App Privacy answers:
  Supabase account information and avatar IDs, Azure player/group/game/tournament records,
  membership snapshots, operational telemetry, and explicit player-ID sharing.
- [ ] Review privacy manifests, required-reason API declarations, encryption
  export-compliance answers, and age-rating questions for the actual signed build.
  Do not invent answers or treat third-party SDK defaults as verified.
- [ ] Address Apple's user-generated-content expectations for public group names
  and display names, including reporting, blocking/moderation, and contact
  mechanisms as applicable. Join-request approval alone is not a moderation system.
- [ ] Describe simulated USD honestly. No real-money deposits, transfers,
  settlement, entry fees, or cash prizes are implemented. Review the applicable
  rating/gaming requirements rather than disguising features to pass review.
- [ ] Review dependency advisories and resolve the remaining SDK 58 patch-version
  warnings through compatible updates. See the installed/recommended versions
  and registry limitations in [README](../README.md#current-validation-limitations).
- [x] Select separate production Supabase/Azure services rather than promoting
  development services or copying development users/data.
- [ ] Select the production subscription/projects and availability/cost policy.
  The existing Azure subscription was verified as a Visual Studio Enterprise
  credit offer (`MSDN_2014-09-01`), which is for development/testing only.
  Use a separately approved production-eligible subscription; do not repurpose
  the development subscription or assume that disabling its spending limit
  makes it eligible for production. See [Microsoft's Azure credits FAQ](https://learn.microsoft.com/en-us/visualstudio/subscriptions/faq/subscriber/azure/).
  Development SQL now uses Standard S0 without free-quota auto-pause, but
  subscription-credit exhaustion can still interrupt services. The $50 monthly
  resource-group budget alerts do not impose a spending cap.
- [ ] Validate monitoring, support, backups/restore, migrations, and incident
  recovery. Prove access using the runtime identity, not only an administrator.

Email/password is the current sign-in method. Do not automatically add social
login or Sign in with Apple. If social/third-party sign-in is introduced, check
Apple's current equivalent-login requirements and applicable exceptions.

## Apple and Expo release configuration

- [x] Confirm active Apple Developer membership and the owning Expo account.
- [x] Choose iOS bundle identifier `com.dinknpc.dinknow` and link `@dinknpc/dinknow`.
- [x] Configure the internal physical-iPhone `development` profile in `eas.json`,
  approved logo, and development-client tooling. Upload inspection excludes
  Git metadata, environment files, signing credentials, and backend/infrastructure files.
- [ ] Create the App Store Connect app record and production build/submission
  profiles with the intended production environment variables.
- [ ] Establish version/build-number management and a supported Apple SDK/Xcode
  build image. Verify current submission requirements before building.
- [ ] Manage certificates, provisioning, and App Store Connect credentials
  through supported secure tooling; never commit signing files or secrets.
- [ ] Validate final app branding, screenshots, descriptions, support/privacy
  metadata, device support, and accessibility.
- [ ] Decide whether to retain iPad support; it is currently enabled and must
  be tested if kept.

Windows can use EAS cloud services, but cannot locally build native iOS with
Xcode. An Expo Go QR code or `expo export --platform ios` output is not a signed
App Store application.

## TestFlight and review

After separately approving a release build/upload:

1. Build a signed release for the intended environment.
2. Upload to App Store Connect/TestFlight and test the installed build, not only
   Expo Go: public signup/verification, login/logout, recovery, deletion, session
   restore, account isolation, shared-group permissions, and tournament lifecycle.
3. Test cold starts, unavailable services, delayed/interrupted saves, retries,
   and multiple devices. Confirm no lost/duplicate results or public data leaks.
4. Prepare a verified reviewer account and synthetic group members/results so
   reviewers can exercise doubles and tournaments. Provide review credentials
   only through the appropriate App Store Connect review channel, never source
   files or chat. Do not add an authentication backdoor.
5. Keep the review backend available and provide accurate review notes.
6. Obtain explicit approval before submitting for App Review or releasing
   publicly. An EAS Submit upload is not App Review approval or automatic release.

## References

Requirements can change; recheck these official sources before submission:

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
  (including completeness, user-generated content, login services, and privacy).
- [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/).
- [Supabase production SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp).
- [Expo iOS submission guide](https://docs.expo.dev/submit/ios/).
