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

1. Raise the version (it must be newer than the installed one; the first release can be 0.1.1) in `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml` and `package.json`. The workflow stops if they differ.
2. Commit and push, then `git tag v0.1.1 && git push origin v0.1.1` (the tag must match the version).
3. GitHub Actions makes a draft release, builds Mac (Apple chip and Intel) and Windows, signs the updates, and only then publishes it.
4. Running apps find it under Settings > Updates > Check for updates (and offer it a few seconds after they start).

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
