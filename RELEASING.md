# Releasing a new version

The app updates itself from this repository's GitHub Releases (`UKMAC-Community/ukmac_monitoing_App`, public):
the installers and `latest.json` are attached to each release. The address is built into the app
(`plugins.updater.endpoints` in `src-tauri/tauri.conf.json`).

## One-time setup

In this repository: Settings > Secrets and variables > Actions > New repository secret. All three are required
(the workflow stops if one is empty):

- `TAURI_SIGNING_PRIVATE_KEY`: the contents of `~/.ukmac-signing/ukmac-updater.key`. Copy without printing it:
  `pbcopy < ~/.ukmac-signing/ukmac-updater.key`. **Keep a backup of that file**: an installed app only accepts updates signed by it.
- `UKMAC_GOOGLE_CLIENT_ID` and `UKMAC_GOOGLE_CLIENT_SECRET`: the shared Google client. Every installed app becomes whatever this
  builds, so a build without them would take Google sign-in away. They are sealed into the app at build time (never in the code).

Also: Settings > Actions > General > Workflow permissions can stay on the default; the workflow asks for `contents: write` itself.

## Each release

**Just push to `main`.** The workflow (`.github/workflows/release.yml`) then:

1. runs the tests (`npx ng test`); if one fails, nothing is released;
2. works out the next version: one patch above the last published release (0.1.7 → 0.1.8), or the version written in
   `tauri.conf.json` if you raised it higher on purpose (for a new minor or major);
3. builds Mac (Apple chip and Intel) and Windows with that version, signs the update files and makes a draft release;
4. publishes it only when every build worked. Running apps then offer it a few seconds after they start, or under
   Settings > Updates > Check for updates.

The version numbers in the files in the repo are not touched by this (the build uses its own copy), so they can fall behind
the releases; that is harmless. Put `[skip release]` anywhere in a commit message to push without releasing.
The "Run workflow" button on the Actions page releases the current `main` the same way.

The older way still works: raise the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`
(all three the same), commit, then `git tag vX.Y.Z && git push origin vX.Y.Z` (the tag must match the version).

Every push to `main` now reaches every installed app, so push only what is ready.

## Local builds

`npm run app` needs the signing key in the environment, because the update files are signed:
`TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.ukmac-signing/ukmac-updater.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" npm run app`

## Notes

- The code is public, so never commit `src-tauri/google-client.json`, the signing key, or a database/backup (the first two are
  ignored or kept outside the folder).
- The builds are not signed with Apple or Microsoft certificates, so the first install shows a warning: on Mac, System Settings >
  Privacy & Security > Open Anyway (or `xattr -cr "/Applications/UKMAC Monitoring.app"`); on Windows, "More info > Run anyway".
  Updates installed by the app itself are checked against the signing key.
- Copies built before the updater existed cannot update themselves: install one release by hand first.
- On Mac the app must be somewhere the user can write (such as /Applications) so it can replace itself.
