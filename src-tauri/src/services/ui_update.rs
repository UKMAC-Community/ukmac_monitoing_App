//! UI-only updates: a new look for the app without restarting it.
//!
//! The app's screens (the Angular build) are part of the app file, and a normal update replaces the whole file and restarts. When a
//! release changes only the screens, the release also carries a small signed package of them (`ui-<version>.tar.gz`, described by
//! `ui-latest.json`). The app downloads it, checks its signature with the same key as the normal updates, keeps it in its data folder
//! (`ui/<version>/`), and reloads the window from it. Nothing restarts and the database is not touched.
//!
//! Safety, in order:
//! - **Same native side.** The package says which native fingerprint it was built against (`scripts/ui-manifest.mjs`: a hash of the Rust
//!   code, its dependencies and configuration). It is used only when that is this app's own fingerprint; otherwise the screens might call
//!   something this app does not have, and the normal update is the way.
//! - **Newer than the app.** A package is used only while its version is above the app's own: after a normal update (or in a build made
//!   here) the screens inside the app are at least as new, and win.
//! - **It must start.** The new screens tell the app they started (`ui_booted`). If they have not within a few seconds (or the app is
//!   opened twice without it), that package is marked bad and the screens inside the app are used again.
//! - **Nothing is trusted from the folder.** Files are read only from inside it, and a package is checked (signature, then paths) before
//!   it is unpacked.

use std::borrow::Cow;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, RwLock};

use serde::{Deserialize, Serialize};
use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Assets, Manager, Wry};

use crate::error::{err, CmdResult};

/// What the native side of this app is (see `scripts/ui-manifest.mjs`); "unknown" when it was built without it, which matches nothing.
pub const NATIVE: &str = env!("UKMAC_NATIVE_FINGERPRINT");
/// The version of this app (the screens inside it).
pub const BINARY: &str = env!("CARGO_PKG_VERSION");

const MANIFEST_URL: &str = "https://github.com/UKMAC-Community/ukmac_monitoing_App/releases/latest/download/ui-latest.json";
/// The seconds new screens have to say they started.
const BOOT_SECONDS: u64 = 12;
/// How many times the app may be opened on a package that never said it started.
const MAX_TRIES: u32 = 2;
/// A package is a few MB; anything much bigger is not ours.
const MAX_PACKAGE_BYTES: usize = 60 * 1024 * 1024;
const MAX_UNPACKED_BYTES: u64 = 200 * 1024 * 1024;

// ----------------------------------------------------------------------------- versions

fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    let mut parts = text.trim().trim_start_matches('v').split(['.', '-', '+']);
    Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
}

/// `a` is a higher version than `b` (a version that can't be read is never higher).
pub fn is_newer(a: &str, b: &str) -> bool {
    match (parse_version(a), parse_version(b)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

// ----------------------------------------------------------------------------- what is kept

/// What the folder `ui/` remembers between runs.
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct Kept {
    /// The package to use (a folder `ui/<version>/`).
    pub current: Option<String>,
    /// The package whose screens said they started.
    pub booted: Option<String>,
    /// How many times the app was opened on `current` before it said so.
    pub tries: u32,
    /// Packages that did not start: never used again.
    pub bad: Vec<String>,
}

impl Kept {
    fn load(folder: &Path) -> Kept {
        std::fs::read_to_string(folder.join("state.json")).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
    }

    fn save(&self, folder: &Path) {
        if std::fs::create_dir_all(folder).is_ok() {
            if let Ok(text) = serde_json::to_string_pretty(self) {
                let _ = std::fs::write(folder.join("state.json"), text);
            }
        }
    }
}

/// A package's own description, in its folder (`ukmac-ui.json`, written by `scripts/ui-manifest.mjs`).
#[derive(Deserialize)]
struct Described {
    version: String,
    fingerprint: String,
}

fn described(dir: &Path) -> Option<Described> {
    serde_json::from_str(&std::fs::read_to_string(dir.join("ukmac-ui.json")).ok()?).ok()
}

/// A package folder that can be used by an app with this version and native fingerprint.
fn usable(dir: &Path, version: &str, binary: &str, native: &str) -> bool {
    match described(dir) {
        Some(found) => found.version == version && found.fingerprint == native && is_newer(version, binary) && dir.join("index.html").is_file(),
        None => false,
    }
}

/// What to load at start: the package kept (if it can be used), counting this opening, or none. Packages that are no use are deleted.
pub fn choose(folder: &Path, binary: &str, native: &str) -> Option<Active> {
    let mut kept = Kept::load(folder);
    let mut chosen = None;
    if let Some(version) = kept.current.clone() {
        let dir = folder.join(&version);
        let fine = !kept.bad.contains(&version) && is_name(&version) && usable(&dir, &version, binary, native);
        if fine && kept.booted.as_deref() != Some(version.as_str()) {
            kept.tries += 1;
        }
        if fine && kept.tries <= MAX_TRIES {
            chosen = Some(Active { version, dir });
        } else {
            if fine {
                kept.bad.push(version);
            }
            kept.current = None;
            kept.tries = 0;
        }
    }
    kept.save(folder);
    // Whatever is not the package in use is no longer needed.
    if let Ok(entries) = std::fs::read_dir(folder) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if entry.path().is_dir() && chosen.as_ref().map(|active| active.version.as_str()) != Some(name.as_str()) {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
    chosen
}

/// A package's folder name is its version: digits, dots and nothing that leaves the folder.
fn is_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 32 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

// ----------------------------------------------------------------------------- the screens the window is given

#[derive(Clone, Debug)]
pub struct Active {
    pub version: String,
    pub dir: PathBuf,
}

struct Inner {
    embedded: OnceLock<Box<dyn Assets<Wry>>>,
    active: RwLock<Option<Active>>,
}

/// The screens the window is given: from the package in use when there is one, else the ones inside the app.
#[derive(Clone)]
pub struct Layer {
    inner: Arc<Inner>,
}

impl Layer {
    /// Put the layer in front of the app's own screens (before the app starts).
    pub fn install(context: &mut tauri::Context<Wry>, active: Option<Active>) -> Layer {
        let layer = Layer { inner: Arc::new(Inner { embedded: OnceLock::new(), active: RwLock::new(active) }) };
        let embedded = context.set_assets(Box::new(layer.clone()));
        let _ = layer.inner.embedded.set(embedded);
        layer
    }

    pub fn active(&self) -> Option<Active> {
        self.inner.active.read().ok().and_then(|active| active.clone())
    }

    fn set(&self, active: Option<Active>) {
        if let Ok(mut now) = self.inner.active.write() {
            *now = active;
        }
    }

    fn embedded(&self) -> &dyn Assets<Wry> {
        self.inner.embedded.get().expect("the app's own screens are set before it starts").as_ref()
    }
}

/// A file of a package: only a plain relative path, and only inside the package's folder.
fn inside(dir: &Path, key: &str) -> Option<PathBuf> {
    let relative = Path::new(key.trim_start_matches('/'));
    if relative.as_os_str().is_empty() || !relative.components().all(|part| matches!(part, Component::Normal(_))) {
        return None;
    }
    Some(dir.join(relative))
}

impl Assets<Wry> for Layer {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        match self.active() {
            Some(active) => inside(&active.dir, key.as_ref()).and_then(|path| std::fs::read(path).ok()).map(Cow::Owned),
            None => self.embedded().get(key),
        }
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.embedded().iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        // The screens have no inline script, so a package has nothing to add to the page's policy.
        match self.active() {
            Some(_) => Box::new(std::iter::empty()),
            None => self.embedded().csp_hashes(html_path),
        }
    }
}

// ----------------------------------------------------------------------------- the state the commands share

pub struct UiState {
    pub folder: PathBuf,
    pub layer: Layer,
    /// The package unpacked and kept but not yet loaded by the window.
    staged: Mutex<Option<Active>>,
}

impl UiState {
    pub fn new(folder: PathBuf, layer: Layer) -> UiState {
        UiState { folder, layer, staged: Mutex::new(None) }
    }

    /// A package that did not start before: not offered again.
    fn is_bad(&self, version: &str) -> bool {
        Kept::load(&self.folder).bad.iter().any(|bad| bad == version)
    }

    /// The version of the screens the window has now.
    pub fn running(&self) -> String {
        self.layer.active().map(|active| active.version).unwrap_or_else(|| BINARY.to_string())
    }

    /// A package unpacked and kept: it is what opens next time, and what `apply` loads now.
    fn keep(&self, active: Active) {
        let mut kept = Kept::load(&self.folder);
        kept.current = Some(active.version.clone());
        kept.booted = None;
        kept.tries = 0;
        kept.save(&self.folder);
        if let Ok(mut staged) = self.staged.lock() {
            *staged = Some(active);
        }
    }

    /// Switch the window's screens to the kept package (the window is reloaded by the caller).
    fn apply(&self) -> CmdResult<String> {
        let staged = self.staged.lock().map_err(err)?.clone().ok_or("There is no new screen package to load.")?;
        self.layer.set(Some(staged.clone()));
        Ok(staged.version)
    }

    /// The new screens said they started.
    pub fn booted(&self, version: &str) {
        if self.layer.active().map(|active| active.version).as_deref() != Some(version) {
            return;
        }
        let mut kept = Kept::load(&self.folder);
        if kept.current.as_deref() == Some(version) {
            kept.booted = Some(version.to_string());
            kept.tries = 0;
            kept.save(&self.folder);
        }
    }

    /// The package did not start: never use it again, and give the window the screens inside the app.
    fn give_up(&self, version: &str) {
        let mut kept = Kept::load(&self.folder);
        if !kept.bad.iter().any(|bad| bad == version) {
            kept.bad.push(version.to_string());
        }
        if kept.current.as_deref() == Some(version) {
            kept.current = None;
        }
        kept.save(&self.folder);
        self.layer.set(None);
        if let Ok(mut staged) = self.staged.lock() {
            *staged = None;
        }
    }

    fn started(&self, version: &str) -> bool {
        Kept::load(&self.folder).booted.as_deref() == Some(version)
    }
}

/// Wait for the screens of `version` to say they started; if they don't, go back to the ones inside the app and reload.
pub fn watch(app: &tauri::AppHandle, version: String) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(BOOT_SECONDS));
        let Some(state) = app.try_state::<UiState>() else { return };
        if state.layer.active().map(|active| active.version).as_deref() == Some(version.as_str()) && !state.started(&version) {
            state.give_up(&version);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.location.reload()");
            }
        }
    });
}

// ----------------------------------------------------------------------------- the package

/// What `ui-latest.json` says of the newest package.
#[derive(Deserialize, Clone, Debug)]
pub struct Manifest {
    pub version: String,
    pub fingerprint: String,
    pub url: String,
    /// The minisign signature of the package, as the normal updates carry it.
    pub signature: String,
    #[serde(default)]
    pub notes: String,
}

/// The package is what the key signed. `public_key` and `signature` are as the updater has them: the minisign text, base64 encoded.
pub fn verify(data: &[u8], signature: &str, public_key: &str) -> Result<(), String> {
    use base64::Engine;
    let decode = |text: &str| -> Result<String, String> {
        let bytes = base64::engine::general_purpose::STANDARD.decode(text.trim()).map_err(|e| format!("not valid base64: {e}"))?;
        String::from_utf8(bytes).map_err(|e| e.to_string())
    };
    let key = minisign_verify::PublicKey::decode(&decode(public_key).map_err(|e| format!("the update key: {e}"))?).map_err(|e| format!("the update key: {e}"))?;
    let signature = minisign_verify::Signature::decode(&decode(signature).map_err(|e| format!("the signature: {e}"))?).map_err(|e| format!("the signature: {e}"))?;
    key.verify(data, &signature, true).map_err(|e| format!("the package does not match its signature ({e})"))
}

/// The key every update is checked with: the updater's own, from the app's configuration (so there is one key for both kinds of update).
pub fn update_key(app: &tauri::AppHandle) -> Result<String, String> {
    key_in(app.config().plugins.0.get("updater").ok_or("the app has no update key")?)
}

fn key_in(updater: &serde_json::Value) -> Result<String, String> {
    updater["pubkey"].as_str().map(str::to_string).ok_or_else(|| "the app has no update key".to_string())
}

/// Unpack a `.tar.gz` of screens into `dest` (a new, empty folder): plain files only, each inside it, nothing too big.
pub fn unpack(package: &[u8], dest: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(package));
    std::fs::create_dir_all(dest).map_err(err)?;
    let mut total = 0u64;
    for entry in archive.entries().map_err(err)? {
        let mut entry = entry.map_err(err)?;
        let kind = entry.header().entry_type();
        let path = entry.path().map_err(err)?.into_owned();
        if !path.components().all(|part| matches!(part, Component::Normal(_) | Component::CurDir)) {
            return Err(format!("the package has a path that leaves its folder ({})", path.display()));
        }
        let target = dest.join(&path);
        if kind.is_dir() {
            std::fs::create_dir_all(&target).map_err(err)?;
        } else if kind.is_file() {
            total += entry.size();
            if total > MAX_UNPACKED_BYTES {
                return Err("the package is too big".into());
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(err)?;
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).map_err(err)?;
            std::fs::write(&target, bytes).map_err(err)?;
        } else {
            return Err(format!("the package has something that is not a file ({})", path.display()));
        }
    }
    Ok(())
}

// ----------------------------------------------------------------------------- the commands' work

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub version: String,
    pub notes: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Look {
    /// The screens the window has now (the app's own, or a package's).
    pub running: String,
    /// The app's own version.
    pub binary: String,
    /// A newer package that can go in without a restart.
    pub available: Option<Offer>,
    /// The newest release changes more than the screens (or this app can't tell), so only the normal update will do.
    pub needs_restart: bool,
    /// The newest version out.
    pub latest: Option<String>,
}

fn http() -> CmdResult<reqwest::Client> {
    reqwest::Client::builder().timeout(std::time::Duration::from_secs(60)).user_agent("UKMAC Monitoring").build().map_err(err)
}

fn manifest_url() -> String {
    std::env::var("UKMAC_UI_MANIFEST_URL").unwrap_or_else(|_| MANIFEST_URL.to_string())
}

async fn fetch_manifest() -> CmdResult<Option<Manifest>> {
    let response = http()?.get(manifest_url()).send().await.map_err(err)?;
    // No package published with the release (the newest release has none): nothing to offer.
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let response = response.error_for_status().map_err(err)?;
    Ok(Some(response.json::<Manifest>().await.map_err(err)?))
}

pub async fn look(state: &UiState) -> CmdResult<Look> {
    let running = state.running();
    let mut look = Look { running: running.clone(), binary: BINARY.to_string(), available: None, needs_restart: false, latest: None };
    let Some(manifest) = fetch_manifest().await? else { return Ok(look) };
    look.latest = Some(manifest.version.clone());
    if manifest.fingerprint != NATIVE || NATIVE == "unknown" {
        look.needs_restart = is_newer(&manifest.version, &running);
    } else if is_newer(&manifest.version, &running) && !state.is_bad(&manifest.version) {
        look.available = Some(Offer { version: manifest.version, notes: manifest.notes });
    }
    Ok(look)
}

/// Download the newest package, check it, unpack it and keep it. It is not loaded yet.
pub async fn install(app: &tauri::AppHandle, state: &UiState) -> CmdResult<String> {
    let manifest = fetch_manifest().await?.ok_or("There is no new screen package published.")?;
    if manifest.fingerprint != NATIVE || NATIVE == "unknown" {
        return Err("This release changes more than the screens, so it needs the normal update.".into());
    }
    if !is_newer(&manifest.version, &state.running()) || !is_name(&manifest.version) || state.is_bad(&manifest.version) {
        return Err("There is no newer screen package.".into());
    }
    let response = http()?.get(&manifest.url).send().await.map_err(err)?.error_for_status().map_err(err)?;
    let package = response.bytes().await.map_err(err)?;
    if package.len() > MAX_PACKAGE_BYTES {
        return Err("The package is too big.".into());
    }
    // Checked before anything is unpacked.
    verify(&package, &manifest.signature, &update_key(app)?)?;

    let temp = state.folder.join(format!(".unpacking-{}", manifest.version));
    let _ = std::fs::remove_dir_all(&temp);
    let result = unpack(&package, &temp).and_then(|_| {
        // What was unpacked must be what the manifest says it is.
        match described(&temp) {
            Some(found) if found.version == manifest.version && found.fingerprint == NATIVE && temp.join("index.html").is_file() => Ok(()),
            _ => Err("The package is not the screens it says it is.".to_string()),
        }
    });
    if let Err(error) = result {
        let _ = std::fs::remove_dir_all(&temp);
        return Err(error);
    }
    let dir = state.folder.join(&manifest.version);
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::rename(&temp, &dir).map_err(err)?;
    state.keep(Active { version: manifest.version.clone(), dir });
    Ok(manifest.version)
}

/// Load the kept package into the window's screens (the caller reloads the window) and start waiting for it to say it started.
pub fn apply(app: &tauri::AppHandle, state: &UiState) -> CmdResult<String> {
    let version = state.apply()?;
    watch(app, version.clone());
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ukmac-ui-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn package(root: &Path, version: &str, native: &str) {
        let dir = root.join(version);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.html"), "<html></html>").unwrap();
        std::fs::write(dir.join("ukmac-ui.json"), format!(r#"{{"version":"{version}","fingerprint":"{native}"}}"#)).unwrap();
    }

    fn keep(root: &Path, version: &str) {
        Kept { current: Some(version.into()), ..Kept::default() }.save(root);
    }

    #[test]
    fn versions_compare_by_number_not_text() {
        assert!(is_newer("0.1.17", "0.1.16"));
        assert!(is_newer("0.1.10", "0.1.9"));
        assert!(is_newer("v0.2.0", "0.1.99"));
        assert!(!is_newer("0.1.16", "0.1.16"));
        assert!(!is_newer("0.1.15", "0.1.16"));
        assert!(!is_newer("garbage", "0.1.16"));
    }

    #[test]
    fn uses_a_kept_package_only_when_it_is_newer_than_the_app_and_made_for_this_native_side() {
        let root = folder("choose");
        package(&root, "0.1.17", "aaa");
        keep(&root, "0.1.17");
        assert_eq!(choose(&root, "0.1.16", "aaa").map(|active| active.version), Some("0.1.17".to_string()));

        // The app caught up with a normal update: the screens inside it win, and the package is deleted.
        assert!(choose(&root, "0.1.17", "aaa").is_none());
        assert!(!root.join("0.1.17").exists());

        // Made for another native side.
        package(&root, "0.1.18", "bbb");
        keep(&root, "0.1.18");
        assert!(choose(&root, "0.1.16", "aaa").is_none());
        assert!(!root.join("0.1.18").exists());
    }

    #[test]
    fn a_package_that_never_says_it_started_is_given_up_after_two_openings() {
        let root = folder("tries");
        package(&root, "0.1.17", "aaa");
        keep(&root, "0.1.17");
        assert!(choose(&root, "0.1.16", "aaa").is_some());
        assert!(choose(&root, "0.1.16", "aaa").is_some());
        assert!(choose(&root, "0.1.16", "aaa").is_none());
        let kept = Kept::load(&root);
        assert_eq!(kept.bad, vec!["0.1.17".to_string()]);
        assert_eq!(kept.current, None);
        // And it is not used again even if it is put back.
        package(&root, "0.1.17", "aaa");
        keep(&root, "0.1.17");
        Kept { current: Some("0.1.17".into()), bad: vec!["0.1.17".into()], ..Kept::default() }.save(&root);
        assert!(choose(&root, "0.1.16", "aaa").is_none());
    }

    #[test]
    fn a_package_that_started_keeps_being_used() {
        let root = folder("booted");
        package(&root, "0.1.17", "aaa");
        Kept { current: Some("0.1.17".into()), booted: Some("0.1.17".into()), ..Kept::default() }.save(&root);
        for _ in 0..5 {
            assert!(choose(&root, "0.1.16", "aaa").is_some());
        }
    }

    #[test]
    fn a_name_that_leaves_the_folder_is_not_a_package() {
        let root = folder("names");
        assert!(is_name("0.1.17"));
        assert!(!is_name("../x"));
        assert!(!is_name("a/b"));
        assert!(!is_name(""));
        Kept { current: Some("../escape".into()), ..Kept::default() }.save(&root);
        assert!(choose(&root, "0.1.16", "aaa").is_none());
    }

    #[test]
    fn files_are_read_only_from_inside_the_package() {
        let dir = Path::new("/data/ui/0.1.17");
        assert_eq!(inside(dir, "/assets/a.js"), Some(dir.join("assets/a.js")));
        assert_eq!(inside(dir, "index.html"), Some(dir.join("index.html")));
        assert!(inside(dir, "../ukmac.db").is_none());
        assert!(inside(dir, "assets/../../ukmac.db").is_none());
        assert!(inside(dir, "").is_none());
        assert!(inside(dir, "/").is_none());
    }

    fn tar_gz(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for (name, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.as_old_mut().name[..name.len()].copy_from_slice(name.as_bytes());
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_entry_type(tar::EntryType::Regular);
            header.set_cksum();
            builder.append(&header, *data).unwrap();
        }
        let tar = builder.into_inner().unwrap();
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut gz, &tar).unwrap();
        gz.finish().unwrap()
    }

    #[test]
    fn unpacks_plain_files_and_refuses_paths_that_leave_the_folder() {
        let dest = folder("unpack");
        unpack(&tar_gz(&[("index.html", b"<html>"), ("assets/a.js", b"1")]), &dest).unwrap();
        assert_eq!(std::fs::read(dest.join("assets/a.js")).unwrap(), b"1");

        let evil = folder("evil");
        let target = evil.join("inner");
        assert!(unpack(&tar_gz(&[("index.html", b"x"), ("../outside.txt", b"x")]), &target).is_err());
        assert!(!evil.join("outside.txt").exists());
        assert!(unpack(&tar_gz(&[("/etc/outside.txt", b"x")]), &target).is_err());
    }

    #[test]
    fn a_package_must_match_its_signature() {
        use base64::Engine;
        let b64 = |text: &str| base64::engine::general_purpose::STANDARD.encode(text);
        let config: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        let key = key_in(&config["plugins"]["updater"]).unwrap();
        // Garbage in either place is refused, never accepted.
        assert!(verify(b"data", &b64("untrusted comment: x\nnot a signature"), &key).is_err());
        assert!(verify(b"data", "!!!", &key).is_err());
        assert!(verify(b"data", &b64("anything"), "!!!").is_err());
    }
}
