//! Sign in with Google, and read Google Sheets.
//!
//! The app signs in the way Google asks of a desktop app (OAuth 2.0 with PKCE over a loopback
//! address): the system browser opens Google's own page, Google sends the browser back to a port
//! this app listens on for a moment, and the code it brings is traded for tokens. All of it happens
//! here, in Rust; the page the user sees in the app never holds a token.
//!
//! Read-only (`drive.readonly`): a sheet is listed and downloaded as an Excel workbook, the way the
//! web system reads one, and the app reads it as any Excel file. Nothing is ever written to Google.
//!
//! What Google gave — the client's ID and secret, the tokens — is kept in `google.json` beside the
//! database with owner-only permissions, not in the database: "Save a backup" copies that, and a
//! backup gets passed around.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use uuid::Uuid;

type CmdResult<T> = Result<T, String>;

const DRIVE_SCOPE: &str = "https://www.googleapis.com/auth/drive.readonly";
/// Creating and updating the sheets this app makes (and only those): the zones' Google Sheet that a saved MAC file points at.
const FILE_SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
const SCOPE: &str = "openid email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file";
const NEEDS_FILE_SCOPE: &str = "To keep this MAC's tables in a Google Sheet, sign in with Google again and allow creating files (the box for the files this app makes). If Google's page doesn't show it, add the scope .../auth/drive.file to the app's consent screen in Google Cloud.";
const SHEET_MIME: &str = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/// The biggest workbook taken (the same as an Excel file picked from disk).
const MAX_BYTES: usize = 15 * 1024 * 1024;
const SIGN_IN_WAIT: Duration = Duration::from_secs(300);
/// Pages a link may open in the browser (the Google help and console pages the app points to).
const LINK_HOSTS: &[&str] = &[
    "console.cloud.google.com",
    "accounts.google.com",
    "myaccount.google.com",
    "docs.google.com",
    "drive.google.com",
    "support.google.com",
];

fn err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

/// A failed request as a sentence.
fn net(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "Google didn't answer in time. Check the internet connection and try again.".into()
    } else if error.is_connect() {
        "Can't reach Google. Check the internet connection.".into()
    } else {
        format!("Couldn't talk to Google: {error}")
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ------------------------------------------------------------------ what's kept

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    client_id: String,
    client_secret: String,
    refresh_token: String,
    access_token: String,
    /// Unix seconds.
    expires_at: i64,
    email: String,
    name: String,
    /// What Google let this sign-in do (its `scope`): old files have none, which means read-only.
    #[serde(default)]
    scope: String,
}

/// Where Google's pages and APIs are (the real ones, but a test points them at a stand-in).
#[derive(Clone, Debug)]
pub struct Urls {
    pub auth: String,
    pub token: String,
    pub revoke: String,
    pub userinfo: String,
    pub drive: String,
    /// Drive's upload address (a sheet made or replaced from an Excel file).
    pub upload: String,
    pub docs: String,
}

impl Urls {
    pub fn google() -> Self {
        Urls {
            auth: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token: "https://oauth2.googleapis.com/token".into(),
            revoke: "https://oauth2.googleapis.com/revoke".into(),
            userinfo: "https://openidconnect.googleapis.com/v1/userinfo".into(),
            drive: "https://www.googleapis.com/drive/v3".into(),
            upload: "https://www.googleapis.com/upload/drive/v3".into(),
            docs: "https://docs.google.com/spreadsheets/d".into(),
        }
    }
}

/// The Google client built into this app (the owner's one, made once in Google Cloud, so the people
/// who use the app only press Sign in): build.rs seals `src-tauri/google-client.json` (or the
/// UKMAC_GOOGLE_CLIENT_ID / UKMAC_GOOGLE_CLIENT_SECRET build variables) into the app, and it is
/// opened here. See client_seal.rs for what that hides and what it can't.
fn built_in_client() -> Option<(String, String)> {
    crate::client_seal::open(
        option_env!("UKMAC_GOOGLE_CLIENT_SEALED")?,
        option_env!("UKMAC_GOOGLE_CLIENT_KEY")?,
    )
}

pub struct GoogleState {
    file: PathBuf,
    /// The client built into the app, used while none is saved on this Mac.
    built_in: Option<(String, String)>,
    stored: Mutex<Stored>,
    http: reqwest::Client,
    urls: Urls,
    /// Set while a sign-in waits in the browser; sending on it cancels that.
    cancel: Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleStatus {
    /// A client is there (saved on this Mac, or built into the app): sign-in can start.
    configured: bool,
    /// The app has a client built in, which is used while none is saved here.
    built_in: bool,
    signed_in: bool,
    /// The one saved on this Mac (empty: the built-in one is used, if any).
    client_id: String,
    has_secret: bool,
    email: Option<String>,
    name: Option<String>,
    /// This sign-in may make the sheet a saved MAC file's zones live in (else: sign in again).
    can_create: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub modified_time: Option<String>,
    pub owner: Option<String>,
}

fn non_empty(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

impl GoogleState {
    pub fn load(folder: &Path) -> Self {
        let mut state = Self::with_urls(folder, Urls::google());
        state.built_in = built_in_client();
        state
    }

    pub fn with_urls(folder: &Path, urls: Urls) -> Self {
        let file = folder.join("google.json");
        let stored = std::fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let mut http = reqwest::Client::builder()
            .user_agent(concat!("UKMAC-Monitoring/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120));
        if cfg!(test) {
            // The tests talk to stand-ins on this computer, whatever proxy it has.
            http = http.no_proxy();
        }
        let http = http.build().expect("an HTTP client");
        GoogleState {
            file,
            built_in: None,
            stored: Mutex::new(stored),
            http,
            urls,
            cancel: Mutex::new(None),
        }
    }

    /// The signed-in account's address (lower case), or None when nobody is signed in.
    pub fn account(&self) -> Option<String> {
        let stored = self.stored();
        if stored.refresh_token.is_empty() {
            return None;
        }
        non_empty(&stored.email).map(|email| email.to_lowercase())
    }

    fn stored(&self) -> Stored {
        self.stored.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Replaces what's kept, on disk first: owner-only, written whole then moved into place.
    fn keep(&self, next: Stored) -> CmdResult<()> {
        let json = serde_json::to_vec_pretty(&next).map_err(err)?;
        let temp = self.file.with_extension("json.tmp");
        let _ = std::fs::remove_file(&temp);
        write_private(&temp, &json).map_err(err)?;
        std::fs::rename(&temp, &self.file).map_err(err)?;
        if let Ok(mut stored) = self.stored.lock() {
            *stored = next;
        }
        Ok(())
    }

    /// The client to sign in with: the one saved on this Mac, else the one built into the app.
    fn client(&self) -> Option<(String, String)> {
        let s = self.stored();
        if !s.client_id.is_empty() && !s.client_secret.is_empty() {
            return Some((s.client_id, s.client_secret));
        }
        self.built_in.clone()
    }

    pub fn status(&self) -> GoogleStatus {
        let s = self.stored();
        GoogleStatus {
            configured: self.client().is_some(),
            built_in: self.built_in.is_some(),
            signed_in: !s.refresh_token.is_empty(),
            client_id: s.client_id,
            has_secret: !s.client_secret.is_empty(),
            email: non_empty(&s.email),
            name: non_empty(&s.name),
            can_create: s.scope.contains(FILE_SCOPE),
        }
    }

    /// The Client ID and secret of the OAuth client the user made in Google Cloud. A different
    /// client can't use another's tokens, so changing it signs out.
    fn save_client(&self, client_id: &str, client_secret: &str) -> CmdResult<()> {
        let client_id = client_id.trim();
        let mut client_secret = client_secret.trim().to_string();
        if client_id.is_empty() && client_secret.is_empty() {
            self.cancel_waiting_sign_in();
            return self.keep(Stored::default());
        }
        let mut next = self.stored();
        if !client_id.ends_with(".apps.googleusercontent.com") {
            return Err(
                "That isn't a Google Client ID: it ends with .apps.googleusercontent.com".into(),
            );
        }
        if client_secret.is_empty() && client_id == next.client_id {
            client_secret = next.client_secret.clone();
        }
        if client_secret.is_empty() {
            return Err("Paste the Client secret too.".into());
        }
        if client_id != next.client_id || client_secret != next.client_secret {
            self.cancel_waiting_sign_in();
            next = Stored {
                client_id: client_id.to_string(),
                client_secret,
                ..Stored::default()
            };
        }
        self.keep(next)
    }

    /// A token to call Google with: the kept one while it lasts, else a new one made from the
    /// refresh token. When Google no longer honours that (the user took the app's access away, or
    /// a test-mode token reached its 7 days) the user is signed out.
    async fn access_token(&self, force: bool) -> CmdResult<String> {
        let s = self.stored();
        if s.refresh_token.is_empty() {
            return Err("Sign in with Google first (Settings → Google).".into());
        }
        if !force && !s.access_token.is_empty() && s.expires_at > now() + 60 {
            return Ok(s.access_token);
        }
        let Some((client_id, client_secret)) = self.client() else {
            return Err("Sign in with Google first (Settings → Google).".into());
        };
        let form = [
            ("grant_type", "refresh_token"),
            ("refresh_token", s.refresh_token.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
        ];
        match post_token(&self.http, &self.urls.token, &form).await {
            Ok(reply) => {
                let token = reply.access_token.unwrap_or_default();
                if token.is_empty() {
                    return Err("Google gave no access token. Try signing in again.".into());
                }
                let mut next = self.stored();
                next.access_token = token.clone();
                next.expires_at = now() + reply.expires_in.unwrap_or(3600);
                self.keep(next)?;
                Ok(token)
            }
            Err(TokenFailure::Refused { error, message }) => {
                if error == "invalid_grant" {
                    let mut next = self.stored();
                    next.refresh_token.clear();
                    next.access_token.clear();
                    next.expires_at = 0;
                    self.keep(next)?;
                    Err("Your Google sign-in has ended (Google expires it after a week while the app is in testing). Sign in again.".into())
                } else {
                    Err(message)
                }
            }
            Err(TokenFailure::Other(message)) => Err(message),
        }
    }

    /// A GET with the user's token (made new, once, if Google says it's no good).
    async fn get(&self, url: &str) -> CmdResult<reqwest::Response> {
        let mut forced = false;
        loop {
            let token = self.access_token(forced).await?;
            let response = self
                .http
                .get(url)
                .bearer_auth(&token)
                .send()
                .await
                .map_err(net)?;
            if response.status() == StatusCode::UNAUTHORIZED && !forced {
                forced = true;
                continue;
            }
            return Ok(response);
        }
    }
}

#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)
}

#[cfg(not(unix))]
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::File::create(path)?.write_all(bytes)
}

// ------------------------------------------------------------------ Google's token endpoint

#[derive(Debug, Default, Deserialize)]
struct TokenReply {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug)]
enum TokenFailure {
    /// Google answered, and said no.
    Refused { error: String, message: String },
    /// Google couldn't be reached.
    Other(String),
}

fn explain(error: &str, detail: &str) -> String {
    match error {
        "invalid_client" => "Google doesn't recognise this Client ID and secret. Check them in Settings, and that the client's type is Desktop app.".into(),
        "invalid_grant" => "Google refused the sign-in (the code may have expired). Try signing in again.".into(),
        "redirect_uri_mismatch" => "Google didn't accept the return address. Make the OAuth client in Google Cloud of type Desktop app.".into(),
        "access_denied" => "Sign-in was cancelled in the browser.".into(),
        _ if detail.is_empty() => format!("Google said: {error}"),
        _ => format!("Google said: {detail}"),
    }
}

async fn post_token(
    http: &reqwest::Client,
    url: &str,
    form: &[(&str, &str)],
) -> Result<TokenReply, TokenFailure> {
    let response = http
        .post(url)
        .form(form)
        .send()
        .await
        .map_err(|e| TokenFailure::Other(net(e)))?;
    let status = response.status();
    let reply: TokenReply = response.json().await.unwrap_or_default();
    if let Some(error) = &reply.error {
        let message = explain(error, reply.error_description.as_deref().unwrap_or(""));
        return Err(TokenFailure::Refused {
            error: error.clone(),
            message,
        });
    }
    if !status.is_success() {
        return Err(TokenFailure::Other(format!("Google answered {status}.")));
    }
    Ok(reply)
}

// ------------------------------------------------------------------ the sign-in

struct Granted {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
    email: String,
    name: String,
    scope: String,
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The page the browser is left on.
fn page(title: &str, message: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>UKMAC Monitoring</title>\
         <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>\
         <body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f7;\
         font:16px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d1d1f\">\
         <main style=\"max-width:420px;margin:24px;padding:32px;background:#fff;border-radius:18px;\
         box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center\">\
         <h1 style=\"margin:0 0 8px;font-size:22px\">{}</h1>\
         <p style=\"margin:0;color:#6e6e73;line-height:1.5\">{}</p></main></body></html>",
        escape(title),
        escape(message)
    )
}

async fn respond(stream: &mut TcpStream, status: u16, title: &str, message: &str) {
    let (reason, body) = match status {
        200 => ("OK", page(title, message)),
        400 => ("Bad Request", page(title, message)),
        _ => ("Not Found", String::new()),
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.write_all(body.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// One request to the loopback port. `None`: not Google's answer (the browser asking for an icon,
/// a stray request, a wrong `state`), so keep waiting.
async fn answer(mut stream: TcpStream, state: &str) -> Option<Result<String, String>> {
    let mut buffer = vec![0u8; 16 * 1024];
    let mut filled = 0;
    let read = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let n = stream.read(&mut buffer[filled..]).await.ok()?;
            if n == 0 {
                return Some(());
            }
            filled += n;
            if filled == buffer.len() || buffer[..filled].windows(4).any(|w| w == b"\r\n\r\n") {
                return Some(());
            }
        }
    })
    .await;
    if !matches!(read, Ok(Some(()))) {
        return None;
    }
    let head = String::from_utf8_lossy(&buffer[..filled]).to_string();
    let target = head.lines().next()?.split_whitespace().nth(1)?.to_string();
    let url = Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    let pairs: HashMap<String, String> = url.query_pairs().into_owned().collect();
    if !pairs.contains_key("code") && !pairs.contains_key("error") {
        respond(&mut stream, 404, "", "").await;
        return None;
    }
    if pairs.get("state").map(String::as_str) != Some(state) {
        respond(
            &mut stream,
            400,
            "That wasn't for this sign-in",
            "Start the sign-in again from UKMAC Monitoring.",
        )
        .await;
        return None;
    }
    if let Some(error) = pairs.get("error") {
        respond(
            &mut stream,
            200,
            "Sign-in didn't finish",
            "You can close this tab and go back to UKMAC Monitoring.",
        )
        .await;
        return Some(Err(explain(error, "")));
    }
    respond(
        &mut stream,
        200,
        "You're signed in",
        "You can close this tab and go back to UKMAC Monitoring.",
    )
    .await;
    pairs.get("code").cloned().map(Ok)
}

async fn wait_for_code(
    listener: &TcpListener,
    state: &str,
    mut cancel: oneshot::Receiver<()>,
    wait: Duration,
) -> Result<String, String> {
    let deadline = tokio::time::sleep(wait);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => return Err("Google didn't answer in time. Try signing in again.".into()),
            _ = &mut cancel => return Err("Sign-in cancelled.".into()),
            accepted = listener.accept() => {
                let (stream, _) = accepted.map_err(err)?;
                if let Some(outcome) = answer(stream, state).await {
                    return outcome;
                }
            }
        }
    }
}

/// The whole sign-in: opens Google's page (`open` is given its address), waits for the browser to
/// come back, and trades the code for tokens.
async fn sign_in(
    http: &reqwest::Client,
    urls: &Urls,
    client_id: &str,
    client_secret: &str,
    open: impl FnOnce(&str) -> CmdResult<()>,
    cancel: oneshot::Receiver<()>,
    wait: Duration,
) -> CmdResult<Granted> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| format!("Couldn't listen for Google's answer on this Mac: {e}"))?;
    let port = listener.local_addr().map_err(err)?.port();
    // The same text goes to Google twice (asking, then trading the code), or Google refuses.
    let redirect = format!("http://127.0.0.1:{port}");
    let verifier = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = Uuid::new_v4().simple().to_string();
    let url = Url::parse_with_params(
        &urls.auth,
        &[
            ("client_id", client_id),
            ("redirect_uri", redirect.as_str()),
            ("response_type", "code"),
            ("scope", SCOPE),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", state.as_str()),
            // Without these Google gives no refresh token (so no staying signed in).
            ("access_type", "offline"),
            ("prompt", "select_account consent"),
        ],
    )
    .map_err(err)?;
    open(url.as_str())?;
    let code = wait_for_code(&listener, &state, cancel, wait).await?;

    let form = [
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("redirect_uri", redirect.as_str()),
        ("code_verifier", verifier.as_str()),
    ];
    let reply = match post_token(http, &urls.token, &form).await {
        Ok(reply) => reply,
        Err(TokenFailure::Refused { message, .. }) | Err(TokenFailure::Other(message)) => {
            return Err(message);
        }
    };
    let access_token = reply.access_token.unwrap_or_default();
    let refresh_token = reply.refresh_token.unwrap_or_default();
    if access_token.is_empty() {
        return Err("Google gave no access. Try signing in again.".into());
    }
    let scope = reply.scope.clone().unwrap_or_default();
    if !scope.contains(DRIVE_SCOPE) {
        return Err("Tick \"See and download all your Google Drive files\" on Google's page, so the sheets can be read. Then sign in again.".into());
    }
    if refresh_token.is_empty() {
        return Err("Google didn't allow staying signed in. Remove UKMAC Monitoring at myaccount.google.com/permissions, then sign in again.".into());
    }

    let info: Value = match http
        .get(&urls.userinfo)
        .bearer_auth(&access_token)
        .send()
        .await
    {
        Ok(response) => response.json().await.unwrap_or(Value::Null),
        Err(_) => Value::Null,
    };
    let text = |key: &str| info[key].as_str().unwrap_or("").to_string();
    Ok(Granted {
        expires_at: now() + reply.expires_in.unwrap_or(3600),
        access_token,
        refresh_token,
        email: text("email"),
        name: text("name"),
        scope,
    })
}

// ------------------------------------------------------------------ opening pages

/// A page in the system browser.
pub fn open_url(url: &str) -> CmdResult<()> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command
        .arg(url)
        .status()
        .map_err(|e| format!("Couldn't open the browser: {e}"))
        .and_then(|status| {
            status
                .success()
                .then_some(())
                .ok_or_else(|| "Couldn't open the browser.".to_string())
        })
}

/// A Google page opened for the user (the console to make the OAuth client, a sheet): only https,
/// only Google's own addresses.
#[tauri::command]
pub fn open_link(url: String) -> CmdResult<()> {
    let parsed = Url::parse(&url).map_err(|_| "That isn't a web address.".to_string())?;
    let host = parsed.host_str().unwrap_or("");
    if parsed.scheme() != "https" || !LINK_HOSTS.contains(&host) {
        return Err("That address isn't one the app opens.".into());
    }
    open_url(parsed.as_str())
}

// ------------------------------------------------------------------ commands

#[tauri::command]
pub fn google_status(state: State<'_, GoogleState>) -> GoogleStatus {
    state.status()
}

#[tauri::command]
pub fn google_save_client(
    state: State<'_, GoogleState>,
    client_id: String,
    client_secret: String,
) -> CmdResult<GoogleStatus> {
    state.save_client(&client_id, &client_secret)?;
    Ok(state.status())
}

#[tauri::command]
pub async fn google_sign_in(
    app: tauri::AppHandle,
    state: State<'_, GoogleState>,
) -> CmdResult<GoogleStatus> {
    let Some((client_id, client_secret)) = state.client() else {
        return Err("Add the Client ID and Client secret first (Settings → Google).".into());
    };
    let (sender, receiver) = oneshot::channel();
    {
        let mut waiting = state.cancel.lock().map_err(err)?;
        if waiting.is_some() {
            return Err("A Google sign-in is already waiting in your browser.".into());
        }
        *waiting = Some(sender);
    }
    let result = sign_in(
        &state.http,
        &state.urls,
        &client_id,
        &client_secret,
        open_url,
        receiver,
        SIGN_IN_WAIT,
    )
    .await;
    if let Ok(mut waiting) = state.cancel.lock() {
        *waiting = None;
    }
    let granted = result?;
    let mut next = state.stored();
    next.access_token = granted.access_token;
    next.refresh_token = granted.refresh_token;
    next.expires_at = granted.expires_at;
    next.email = granted.email;
    next.name = granted.name;
    next.scope = granted.scope;
    state.keep(next)?;
    // The browser is in front: bring the app back.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    Ok(state.status())
}

/// Stops a sign-in that is waiting for the browser.
#[tauri::command]
pub fn google_cancel_sign_in(state: State<'_, GoogleState>) {
    state.cancel_waiting_sign_in();
}

impl GoogleState {
    /// Ends a sign-in that waits in the browser, if one does. Whoever changes or removes the
    /// client or the tokens calls this first, so that sign-in can't finish into what they left.
    fn cancel_waiting_sign_in(&self) {
        if let Ok(mut waiting) = self.cancel.lock() {
            if let Some(sender) = waiting.take() {
                let _ = sender.send(());
            }
        }
    }

    /// Google is told to forget this app's access (best effort), the tokens are dropped. The Client
    /// ID and secret stay, unless `forget_client` is set: then they go too and the next sign-in
    /// starts from the setup steps.
    async fn sign_out(&self, forget_client: bool) -> CmdResult<()> {
        self.cancel_waiting_sign_in();
        let s = self.stored();
        if !s.refresh_token.is_empty() {
            let _ = self
                .http
                .post(&self.urls.revoke)
                .form(&[("token", s.refresh_token.as_str())])
                .send()
                .await;
        }
        if forget_client {
            return self.keep(Stored::default());
        }
        let mut next = self.stored();
        next.refresh_token.clear();
        next.access_token.clear();
        next.expires_at = 0;
        next.email.clear();
        next.name.clear();
        self.keep(next)
    }
}

#[tauri::command]
pub async fn google_sign_out(
    state: State<'_, GoogleState>,
    forget_client: Option<bool>,
) -> CmdResult<GoogleStatus> {
    state.sign_out(forget_client.unwrap_or(false)).await?;
    Ok(state.status())
}

// ------------------------------------------------------------------ Drive

/// A Google Sheets or Drive link's file id (or the id itself).
pub fn file_id(text: &str) -> CmdResult<String> {
    let text = text.trim();
    let valid = |id: &str| {
        id.len() >= 20
            && id.len() <= 100
            && id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    };
    if valid(text) {
        return Ok(text.to_string());
    }
    if let Ok(url) = Url::parse(text) {
        let host = url.host_str().unwrap_or("");
        if host == "docs.google.com" || host == "drive.google.com" {
            let parts: Vec<&str> = url.path_segments().map(|s| s.collect()).unwrap_or_default();
            if let Some(at) = parts.iter().position(|part| *part == "d") {
                if let Some(id) = parts.get(at + 1).filter(|id| valid(id)) {
                    return Ok((*id).to_string());
                }
            }
            if let Some((_, id)) = url.query_pairs().find(|(key, _)| key == "id") {
                if valid(&id) {
                    return Ok(id.into_owned());
                }
            }
        }
    }
    Err("Paste the Google Sheet's link (docs.google.com/spreadsheets/…).".into())
}

/// Google's own words for what went wrong, as something the user can act on.
async fn api_error(response: reqwest::Response) -> String {
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    let error = &body["error"];
    let message = error["message"].as_str().unwrap_or("");
    let mut reasons: Vec<&str> = error["errors"]
        .as_array()
        .map(|list| list.iter().filter_map(|e| e["reason"].as_str()).collect())
        .unwrap_or_default();
    if let Some(details) = error["details"].as_array() {
        reasons.extend(details.iter().filter_map(|d| d["reason"].as_str()));
    }
    if reasons
        .iter()
        .any(|r| *r == "accessNotConfigured" || *r == "SERVICE_DISABLED")
        || message.contains("has not been used in project")
    {
        return "Turn on the Google Drive API for your Google Cloud project (APIs & Services → Library → Google Drive API → Enable), wait a minute, then try again.".into();
    }
    if reasons
        .iter()
        .any(|r| r.contains("rateLimit") || r.contains("userRateLimit"))
        || status == StatusCode::TOO_MANY_REQUESTS
    {
        return "Google asked to slow down. Try again in a minute.".into();
    }
    match status {
        StatusCode::NOT_FOUND => "Google can't find that sheet, or this Google account can't open it. Ask the owner to share it with you.".into(),
        StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED if reasons.iter().any(|r| r.contains("insufficient")) => {
            "This sign-in can't read Google Drive. Sign out and sign in again, and tick the Drive box on Google's page.".into()
        }
        StatusCode::FORBIDDEN => "Google didn't let this account read that sheet. Ask the owner to share it with you.".into(),
        _ if message.is_empty() => format!("Google answered {status}."),
        _ => format!("Google answered {status}: {message}"),
    }
}

async fn read_capped(mut response: reqwest::Response) -> CmdResult<Vec<u8>> {
    let too_big = || "That sheet is over 15 MB. Keep the workbook under 15 MB.".to_string();
    if response
        .content_length()
        .is_some_and(|n| n as usize > MAX_BYTES)
    {
        return Err(too_big());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(net)? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err(too_big());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn query_value(text: &str) -> String {
    // A value inside a Drive `q` string: backslash and quote escaped.
    text.replace('\\', "\\\\").replace('\'', "\\'")
}

impl GoogleState {
    async fn list_spreadsheets(&self, query: Option<&str>) -> CmdResult<Vec<DriveFile>> {
        let mut q = format!("mimeType='{SHEET_MIME}' and trashed=false");
        if let Some(words) = query.map(str::trim).filter(|w| !w.is_empty()) {
            q.push_str(&format!(" and name contains '{}'", query_value(words)));
        }
        let url = Url::parse_with_params(
            &format!("{}/files", self.urls.drive),
            &[
                ("q", q.as_str()),
                ("orderBy", "modifiedTime desc"),
                ("pageSize", "50"),
                (
                    "fields",
                    "files(id,name,mimeType,modifiedTime,owners(displayName))",
                ),
                ("corpora", "allDrives"),
                ("includeItemsFromAllDrives", "true"),
                ("supportsAllDrives", "true"),
            ],
        )
        .map_err(err)?;
        let response = self.get(url.as_str()).await?;
        if !response.status().is_success() {
            return Err(api_error(response).await);
        }
        let body: Value = response.json().await.map_err(net)?;
        Ok(body["files"]
            .as_array()
            .map(|files| files.iter().filter_map(drive_file).collect())
            .unwrap_or_default())
    }

    async fn file_info(&self, id: &str) -> CmdResult<DriveFile> {
        let url = Url::parse_with_params(
            &format!("{}/files/{id}", self.urls.drive),
            &[
                (
                    "fields",
                    "id,name,mimeType,modifiedTime,owners(displayName)",
                ),
                ("supportsAllDrives", "true"),
            ],
        )
        .map_err(err)?;
        let response = self.get(url.as_str()).await?;
        if !response.status().is_success() {
            return Err(api_error(response).await);
        }
        let body: Value = response.json().await.map_err(net)?;
        drive_file(&body)
            .ok_or_else(|| "Google's answer about that file couldn't be read.".to_string())
    }

    /// The sheet as an Excel workbook: its export address first (what the web system uses), then
    /// Drive's own export. An Excel file kept in Drive is just downloaded.
    async fn download(&self, id: &str) -> CmdResult<Vec<u8>> {
        let info = self.file_info(id).await?;
        if info.mime_type == XLSX_MIME {
            let url = Url::parse_with_params(
                &format!("{}/files/{id}", self.urls.drive),
                &[("alt", "media"), ("supportsAllDrives", "true")],
            )
            .map_err(err)?;
            let response = self.get(url.as_str()).await?;
            if !response.status().is_success() {
                return Err(api_error(response).await);
            }
            return read_capped(response).await;
        }
        if info.mime_type != SHEET_MIME {
            return Err("That file isn't a Google Sheet. Choose a Google Sheet (or an Excel file kept in Drive).".into());
        }
        let export = format!("{}/{id}/export?format=xlsx", self.urls.docs);
        if let Ok(response) = self.get(&export).await {
            let html = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| value.contains("html"));
            if response.status().is_success() && !html {
                return read_capped(response).await;
            }
        }
        let url = Url::parse_with_params(
            &format!("{}/files/{id}/export", self.urls.drive),
            &[("mimeType", XLSX_MIME)],
        )
        .map_err(err)?;
        let response = self.get(url.as_str()).await?;
        if !response.status().is_success() {
            return Err(api_error(response).await);
        }
        read_capped(response).await
    }
}

impl GoogleState {
    /// Makes a Google Sheet from an Excel workbook (`existing`: the sheet this app made before, whose whole content is replaced, so
    /// whoever it is shared with keeps their access). Needs the `drive.file` permission, which only reaches sheets this app made.
    async fn upload_sheet(&self, name: &str, existing: Option<&str>, bytes: Vec<u8>) -> CmdResult<DriveFile> {
        if !self.stored().scope.contains(FILE_SCOPE) {
            return Err(NEEDS_FILE_SCOPE.into());
        }
        if bytes.len() > MAX_BYTES {
            return Err("That workbook is over 15 MB, more than a Google Sheet made here can take.".into());
        }
        const FIELDS: &str = "id,name,mimeType,modifiedTime,owners(displayName)";
        let boundary = format!("ukmac-{}", Uuid::new_v4().simple());
        let (url, content_type, body) = match existing {
            Some(id) => (
                format!(
                    "{}/files/{id}?uploadType=media&supportsAllDrives=true&fields={FIELDS}",
                    self.urls.upload
                ),
                XLSX_MIME.to_string(),
                bytes,
            ),
            None => {
                let meta = serde_json::json!({"name": name, "mimeType": SHEET_MIME}).to_string();
                let mut body = format!(
                    "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{boundary}\r\nContent-Type: {XLSX_MIME}\r\n\r\n"
                )
                .into_bytes();
                body.extend_from_slice(&bytes);
                body.extend_from_slice(format!("\r\n--{boundary}--").as_bytes());
                (
                    format!(
                        "{}/files?uploadType=multipart&supportsAllDrives=true&fields={FIELDS}",
                        self.urls.upload
                    ),
                    format!("multipart/related; boundary={boundary}"),
                    body,
                )
            }
        };
        let mut forced = false;
        loop {
            let token = self.access_token(forced).await?;
            let request = if existing.is_some() { self.http.patch(&url) } else { self.http.post(&url) };
            let response = request
                .bearer_auth(&token)
                .header(reqwest::header::CONTENT_TYPE, content_type.as_str())
                .body(body.clone())
                .send()
                .await
                .map_err(net)?;
            if response.status() == StatusCode::UNAUTHORIZED && !forced {
                forced = true;
                continue;
            }
            if response.status() == StatusCode::FORBIDDEN {
                return Err(format!("{} {NEEDS_FILE_SCOPE}", api_error(response).await));
            }
            if !response.status().is_success() {
                return Err(api_error(response).await);
            }
            let body: Value = response.json().await.map_err(net)?;
            return drive_file(&body).ok_or_else(|| "Google's answer about the new sheet couldn't be read.".to_string());
        }
    }
}

fn drive_file(value: &Value) -> Option<DriveFile> {
    Some(DriveFile {
        id: value["id"].as_str()?.to_string(),
        name: value["name"].as_str().unwrap_or("Untitled").to_string(),
        mime_type: value["mimeType"].as_str().unwrap_or("").to_string(),
        modified_time: value["modifiedTime"].as_str().map(str::to_string),
        owner: value["owners"][0]["displayName"]
            .as_str()
            .map(str::to_string),
    })
}

/// The user's Google Sheets, newest first (those whose name has `query`, if given).
#[tauri::command]
pub async fn google_list_spreadsheets(
    state: State<'_, GoogleState>,
    query: Option<String>,
) -> CmdResult<Vec<DriveFile>> {
    state.list_spreadsheets(query.as_deref()).await
}

/// A sheet's name and kind, from its link or id.
#[tauri::command]
pub async fn google_file_info(state: State<'_, GoogleState>, file: String) -> CmdResult<DriveFile> {
    let id = file_id(&file)?;
    state.file_info(&id).await
}

/// Makes (or, with a `file` header, replaces the content of) a Google Sheet from the Excel workbook sent as the body; its
/// `name` and `file` headers are percent-encoded.
#[tauri::command]
pub async fn google_upload_workbook(
    request: tauri::ipc::Request<'_>,
    state: State<'_, GoogleState>,
) -> CmdResult<DriveFile> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(crate::commands::percent_decode)
    };
    let name = header("name").filter(|text| !text.trim().is_empty()).ok_or("The sheet needs a name")?;
    let existing = match header("file").filter(|text| !text.trim().is_empty()) {
        Some(text) => Some(file_id(&text)?),
        None => None,
    };
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Nothing to upload".into());
    };
    state.upload_sheet(name.trim(), existing.as_deref(), bytes.to_vec()).await
}

/// A sheet as an Excel workbook, from its link or id.
#[tauri::command]
pub async fn google_download(
    state: State<'_, GoogleState>,
    file: String,
) -> CmdResult<tauri::ipc::Response> {
    let id = file_id(&file)?;
    state.download(&id).await.map(tauri::ipc::Response::new)
}

// ------------------------------------------------------------------ tests

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// What a stand-in Google was asked.
    #[derive(Clone, Debug)]
    struct Asked {
        method: String,
        target: String,
        headers: HashMap<String, String>,
        body: String,
    }

    struct Reply {
        status: u16,
        content_type: &'static str,
        body: Vec<u8>,
    }

    fn json(status: u16, value: Value) -> Reply {
        Reply {
            status,
            content_type: "application/json",
            body: serde_json::to_vec(&value).unwrap(),
        }
    }

    /// A tiny HTTP server on a free port, standing in for Google's.
    async fn stand_in(
        handler: impl Fn(&Asked) -> Reply + Send + Sync + 'static,
    ) -> (String, Arc<Mutex<Vec<Asked>>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let log = Arc::new(Mutex::new(Vec::new()));
        let seen = log.clone();
        let handler = Arc::new(handler);
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    return;
                };
                let handler = handler.clone();
                let seen = seen.clone();
                tokio::spawn(async move {
                    let mut data = Vec::new();
                    let mut chunk = [0u8; 4096];
                    let (head_end, length) = loop {
                        let n = stream.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        data.extend_from_slice(&chunk[..n]);
                        if let Some(at) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                            let head = String::from_utf8_lossy(&data[..at]).to_lowercase();
                            let length = head
                                .lines()
                                .find_map(|l| l.strip_prefix("content-length:"))
                                .and_then(|v| v.trim().parse::<usize>().ok())
                                .unwrap_or(0);
                            break (at + 4, length);
                        }
                    };
                    while data.len() < head_end + length {
                        let n = stream.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        data.extend_from_slice(&chunk[..n]);
                    }
                    let head = String::from_utf8_lossy(&data[..head_end]).to_string();
                    let mut lines = head.lines();
                    let mut first = lines.next().unwrap_or("").split_whitespace();
                    let method = first.next().unwrap_or("").to_string();
                    let target = first.next().unwrap_or("").to_string();
                    let headers = lines
                        .filter_map(|l| l.split_once(':'))
                        .map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string()))
                        .collect();
                    let body = String::from_utf8_lossy(&data[head_end..]).to_string();
                    let asked = Asked {
                        method,
                        target,
                        headers,
                        body,
                    };
                    seen.lock().unwrap().push(asked.clone());
                    let reply = handler(&asked);
                    let head = format!(
                        "HTTP/1.1 {} X\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        reply.status,
                        reply.content_type,
                        reply.body.len()
                    );
                    let _ = stream.write_all(head.as_bytes()).await;
                    let _ = stream.write_all(&reply.body).await;
                    let _ = stream.shutdown().await;
                });
            }
        });
        (base, log)
    }

    fn urls_at(base: &str) -> Urls {
        Urls {
            auth: format!("{base}/auth"),
            token: format!("{base}/token"),
            revoke: format!("{base}/revoke"),
            userinfo: format!("{base}/userinfo"),
            drive: format!("{base}/drive/v3"),
            upload: format!("{base}/upload/drive/v3"),
            docs: format!("{base}/docs"),
        }
    }

    fn form(body: &str) -> HashMap<String, String> {
        Url::parse(&format!("http://x/?{body}"))
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect()
    }

    fn folder(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("ukmac-google-{name}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    const CLIENT: &str = "1234-test.apps.googleusercontent.com";

    /// A client that goes straight to the stand-ins, whatever proxy this computer has.
    fn client() -> reqwest::Client {
        reqwest::Client::builder().no_proxy().build().unwrap()
    }

    #[test]
    fn finds_the_id_in_a_link() {
        let id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
        assert_eq!(file_id(id).unwrap(), id);
        assert_eq!(
            file_id(&format!(
                "https://docs.google.com/spreadsheets/d/{id}/edit#gid=0"
            ))
            .unwrap(),
            id
        );
        assert_eq!(
            file_id(&format!(
                "https://docs.google.com/spreadsheets/u/1/d/{id}/edit?usp=sharing"
            ))
            .unwrap(),
            id
        );
        assert_eq!(
            file_id(&format!("https://drive.google.com/file/d/{id}/view")).unwrap(),
            id
        );
        assert_eq!(
            file_id(&format!("https://drive.google.com/open?id={id}")).unwrap(),
            id
        );
        assert!(
            file_id("https://example.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789")
                .is_err()
        );
        assert!(file_id("hello").is_err());
    }

    #[test]
    fn only_google_pages_are_opened() {
        assert!(open_link("http://console.cloud.google.com/".into()).is_err());
        assert!(open_link("https://example.com/".into()).is_err());
        assert!(open_link("file:///etc/passwd".into()).is_err());
    }

    #[test]
    fn keeps_the_client_privately_and_signs_out_when_it_changes() {
        let dir = folder("client");
        let state = GoogleState::with_urls(&dir, Urls::google());
        assert!(!state.status().configured);
        assert!(state.save_client("nope", "secret").is_err());
        assert!(state.save_client(CLIENT, "").is_err());
        state.save_client(CLIENT, "GOCSPX-secret").unwrap();
        assert!(state.status().configured);
        let mut next = state.stored();
        next.refresh_token = "r".into();
        state.keep(next).unwrap();
        assert!(state.status().signed_in);
        // The secret left blank stays; the same client stays signed in.
        state.save_client(CLIENT, "").unwrap();
        assert!(state.status().signed_in);
        assert!(state.status().has_secret);
        // Another client can't use the first one's tokens.
        state
            .save_client("5678-other.apps.googleusercontent.com", "GOCSPX-other")
            .unwrap();
        assert!(!state.status().signed_in);
        // It's on disk, for this user only, and comes back on the next start.
        let again = GoogleState::with_urls(&dir, Urls::google());
        assert_eq!(
            again.status().client_id,
            "5678-other.apps.googleusercontent.com"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join("google.json"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(
                mode & 0o077,
                0,
                "google.json must be owner-only, was {mode:o}"
            );
        }
    }

    /// Plays the browser: reads what Google's page was asked, then comes back to the loopback port.
    fn browser(
        log: Arc<Mutex<Option<HashMap<String, String>>>>,
        reply: impl Fn(&HashMap<String, String>) -> Vec<String> + Send + 'static,
    ) -> impl FnOnce(&str) -> CmdResult<()> {
        move |address: &str| {
            let asked: HashMap<String, String> = Url::parse(address)
                .unwrap()
                .query_pairs()
                .into_owned()
                .collect();
            *log.lock().unwrap() = Some(asked.clone());
            let paths = reply(&asked);
            let redirect = asked["redirect_uri"].clone();
            tokio::spawn(async move {
                for path in paths {
                    let _ = client().get(format!("{redirect}{path}")).send().await;
                }
            });
            Ok(())
        }
    }

    fn token_stand_in() -> impl Fn(&Asked) -> Reply + Send + Sync + 'static {
        |asked: &Asked| match (asked.method.as_str(), asked.target.as_str()) {
            ("POST", "/token") => {
                let sent = form(&asked.body);
                if sent.get("grant_type").map(String::as_str) == Some("authorization_code") {
                    if sent["code"] != "the-code" {
                        return json(400, serde_json::json!({"error": "invalid_grant"}));
                    }
                    if sent["client_id"] != CLIENT || sent["client_secret"] != "GOCSPX-secret" {
                        return json(401, serde_json::json!({"error": "invalid_client"}));
                    }
                    return json(
                        200,
                        serde_json::json!({
                            "access_token": "at-1", "refresh_token": "rt-1", "expires_in": 3599,
                            "scope": format!("openid {DRIVE_SCOPE} {FILE_SCOPE}"),
                        }),
                    );
                }
                if sent.get("grant_type").map(String::as_str) == Some("refresh_token") {
                    return if sent["refresh_token"] == "rt-1" {
                        json(
                            200,
                            serde_json::json!({"access_token": "at-2", "expires_in": 3599}),
                        )
                    } else {
                        json(
                            400,
                            serde_json::json!({"error": "invalid_grant", "error_description": "Token has been expired or revoked."}),
                        )
                    };
                }
                json(400, serde_json::json!({"error": "unsupported_grant_type"}))
            }
            ("GET", "/userinfo") => json(
                200,
                serde_json::json!({"email": "farmer@example.com", "name": "Farm Manager"}),
            ),
            _ => json(404, serde_json::json!({})),
        }
    }

    /// The sign-in end to end against a stand-in Google: the browser first asks for an icon, then
    /// comes back with someone else's `state`, then with the right answer.
    #[tokio::test]
    async fn signs_in_with_pkce() {
        let (base, seen) = stand_in(token_stand_in()).await;
        let asked = Arc::new(Mutex::new(None));
        let (_keep, receiver) = oneshot::channel();
        let granted = sign_in(
            &client(),
            &urls_at(&base),
            CLIENT,
            "GOCSPX-secret",
            browser(asked.clone(), |a| {
                vec![
                    "/favicon.ico".into(),
                    "/?code=forged&state=somebody-else".into(),
                    format!("/?code=the-code&state={}", a["state"]),
                ]
            }),
            receiver,
            Duration::from_secs(20),
        )
        .await
        .unwrap();
        assert_eq!(granted.access_token, "at-1");
        assert_eq!(granted.refresh_token, "rt-1");
        assert_eq!(
            (granted.email.as_str(), granted.name.as_str()),
            ("farmer@example.com", "Farm Manager")
        );

        let asked = asked.lock().unwrap().clone().unwrap();
        assert_eq!(asked["client_id"], CLIENT);
        assert_eq!(asked["response_type"], "code");
        assert_eq!(asked["code_challenge_method"], "S256");
        assert_eq!(asked["access_type"], "offline");
        assert!(asked["prompt"].contains("consent"));
        assert!(asked["scope"].contains(DRIVE_SCOPE));
        assert!(asked["redirect_uri"].starts_with("http://127.0.0.1:"));
        // The exchange carried the verifier of the challenge Google was given, and the same return address.
        let exchange = seen
            .lock()
            .unwrap()
            .iter()
            .find(|a| a.target == "/token")
            .cloned()
            .unwrap();
        let sent = form(&exchange.body);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(sent["code_verifier"].as_bytes()));
        assert_eq!(challenge, asked["code_challenge"]);
        assert_eq!(sent["redirect_uri"], asked["redirect_uri"]);
        assert!(sent["code_verifier"].len() >= 43);
        // The userinfo call used the new token.
        let info = seen
            .lock()
            .unwrap()
            .iter()
            .find(|a| a.target == "/userinfo")
            .cloned()
            .unwrap();
        assert_eq!(info.headers["authorization"], "Bearer at-1");
    }

    #[tokio::test]
    async fn a_refusal_in_the_browser_ends_the_sign_in() {
        let (base, _) = stand_in(token_stand_in()).await;
        let (_keep, receiver) = oneshot::channel();
        let outcome = sign_in(
            &client(),
            &urls_at(&base),
            CLIENT,
            "GOCSPX-secret",
            browser(Arc::new(Mutex::new(None)), |a| {
                vec![format!("/?error=access_denied&state={}", a["state"])]
            }),
            receiver,
            Duration::from_secs(20),
        )
        .await;
        assert_eq!(
            outcome.err().unwrap(),
            "Sign-in was cancelled in the browser."
        );
    }

    #[tokio::test]
    async fn a_wrong_secret_is_explained() {
        let (base, _) = stand_in(token_stand_in()).await;
        let (_keep, receiver) = oneshot::channel();
        let outcome = sign_in(
            &client(),
            &urls_at(&base),
            CLIENT,
            "GOCSPX-wrong",
            browser(Arc::new(Mutex::new(None)), |a| {
                vec![format!("/?code=the-code&state={}", a["state"])]
            }),
            receiver,
            Duration::from_secs(20),
        )
        .await;
        assert!(outcome.err().unwrap().contains("Desktop app"));
    }

    #[tokio::test]
    async fn waiting_can_be_cancelled_and_runs_out() {
        let (base, _) = stand_in(token_stand_in()).await;
        let (sender, receiver) = oneshot::channel();
        sender.send(()).unwrap();
        let outcome = sign_in(
            &client(),
            &urls_at(&base),
            CLIENT,
            "GOCSPX-secret",
            |_| Ok(()),
            receiver,
            Duration::from_secs(20),
        )
        .await;
        assert_eq!(outcome.err().unwrap(), "Sign-in cancelled.");

        let (_keep, receiver) = oneshot::channel();
        let outcome = sign_in(
            &client(),
            &urls_at(&base),
            CLIENT,
            "GOCSPX-secret",
            |_| Ok(()),
            receiver,
            Duration::from_millis(200),
        )
        .await;
        assert!(outcome.err().unwrap().contains("in time"));
    }

    #[tokio::test]
    async fn a_token_is_kept_then_made_again_then_signed_out() {
        let (base, seen) = stand_in(token_stand_in()).await;
        let state = GoogleState::with_urls(&folder("token"), urls_at(&base));
        state.save_client(CLIENT, "GOCSPX-secret").unwrap();
        assert!(
            state.access_token(false).await.is_err(),
            "not signed in yet"
        );

        let mut next = state.stored();
        next.refresh_token = "rt-1".into();
        next.access_token = "at-old".into();
        next.expires_at = now() + 3000;
        state.keep(next).unwrap();
        // Still good: no call to Google.
        assert_eq!(state.access_token(false).await.unwrap(), "at-old");
        assert!(seen.lock().unwrap().is_empty());
        // Nearly out: made again from the refresh token.
        let mut next = state.stored();
        next.expires_at = now() + 10;
        state.keep(next).unwrap();
        assert_eq!(state.access_token(false).await.unwrap(), "at-2");
        assert_eq!(state.access_token(false).await.unwrap(), "at-2");
        assert_eq!(seen.lock().unwrap().len(), 1);
        // Google no longer honours the refresh token: signed out, and told so.
        let mut next = state.stored();
        next.refresh_token = "rt-revoked".into();
        next.expires_at = 0;
        state.keep(next).unwrap();
        let outcome = state.access_token(false).await;
        assert!(outcome.err().unwrap().contains("Sign in again"));
        assert!(!state.status().signed_in);
        assert!(state.status().configured);
    }

    const SHEET_ID: &str = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

    fn signed_in(base: &str) -> GoogleState {
        let state = GoogleState::with_urls(&folder("drive"), urls_at(base));
        state.save_client(CLIENT, "GOCSPX-secret").unwrap();
        let mut next = state.stored();
        next.refresh_token = "rt-1".into();
        next.access_token = "at-1".into();
        next.expires_at = now() + 3000;
        state.keep(next).unwrap();
        state
    }

    #[tokio::test]
    async fn lists_the_sheets_newest_first_and_searches_by_name() {
        let (base, seen) = stand_in(|asked| {
            if asked.target.starts_with("/drive/v3/files?") {
                json(200, serde_json::json!({"files": [
                    {"id": "a", "name": "Chili farm", "mimeType": SHEET_MIME, "modifiedTime": "2026-11-05T10:00:00.000Z", "owners": [{"displayName": "Sok"}]},
                    {"id": "b", "name": "Old", "mimeType": SHEET_MIME},
                ]}))
            } else {
                json(404, serde_json::json!({}))
            }
        })
        .await;
        let files = signed_in(&base)
            .list_spreadsheets(Some("O'Brien \\ farm"))
            .await
            .unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].name, "Chili farm");
        assert_eq!(files[0].owner.as_deref(), Some("Sok"));
        assert_eq!(files[1].owner, None);
        let asked = seen.lock().unwrap()[0].clone();
        assert_eq!(asked.headers["authorization"], "Bearer at-1");
        let query = Url::parse(&format!("http://x{}", asked.target))
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect::<HashMap<_, _>>();
        assert_eq!(
            query["q"],
            format!(
                "mimeType='{SHEET_MIME}' and trashed=false and name contains 'O\\'Brien \\\\ farm'"
            )
        );
        assert_eq!(query["orderBy"], "modifiedTime desc");
    }

    #[tokio::test]
    async fn downloads_a_sheet_as_excel_and_falls_back_to_drives_export() {
        let workbook = b"PK-pretend-workbook".to_vec();
        let served = workbook.clone();
        let (base, seen) = stand_in(move |asked| {
            let path = asked.target.split('?').next().unwrap().to_string();
            if path == format!("/drive/v3/files/{SHEET_ID}") {
                json(200, serde_json::json!({"id": SHEET_ID, "name": "Chili farm", "mimeType": SHEET_MIME}))
            } else if path == format!("/docs/{SHEET_ID}/export") {
                // Google's sign-in page, not a workbook: the first way fails.
                Reply { status: 200, content_type: "text/html; charset=utf-8", body: b"<html>sign in</html>".to_vec() }
            } else if path == format!("/drive/v3/files/{SHEET_ID}/export") {
                Reply { status: 200, content_type: XLSX_MIME, body: served.clone() }
            } else {
                json(404, serde_json::json!({}))
            }
        })
        .await;
        let bytes = signed_in(&base).download(SHEET_ID).await.unwrap();
        assert_eq!(bytes, workbook);
        let paths: Vec<String> = seen
            .lock()
            .unwrap()
            .iter()
            .map(|a| a.target.split('?').next().unwrap().to_string())
            .collect();
        assert_eq!(paths.len(), 3);
        assert!(paths[1].ends_with("/export"));
    }

    #[tokio::test]
    async fn a_file_that_is_not_a_sheet_is_refused_and_google_errors_are_explained() {
        let (base, _) = stand_in(|asked| {
            if asked.target.contains("/files/doc1") {
                json(200, serde_json::json!({"id": "doc1", "name": "Notes", "mimeType": "application/vnd.google-apps.document"}))
            } else if asked.target.contains("/files/missing") {
                json(404, serde_json::json!({"error": {"code": 404, "message": "File not found: missing."}}))
            } else if asked.target.contains("/files/off") {
                json(403, serde_json::json!({"error": {"code": 403, "message": "Google Drive API has not been used in project 1 before or it is disabled.", "errors": [{"reason": "accessNotConfigured"}]}}))
            } else {
                json(404, serde_json::json!({}))
            }
        })
        .await;
        let state = signed_in(&base);
        assert!(
            state
                .download("doc1")
                .await
                .unwrap_err()
                .contains("isn't a Google Sheet")
        );
        assert!(
            state
                .file_info("missing")
                .await
                .unwrap_err()
                .contains("can't find that sheet")
        );
        assert!(
            state
                .file_info("off")
                .await
                .unwrap_err()
                .contains("Google Drive API")
        );
    }

    #[tokio::test]
    async fn a_workbook_over_the_limit_is_refused() {
        let (base, _) = stand_in(|asked| {
            if asked.target.contains("alt=media") {
                Reply {
                    status: 200,
                    content_type: XLSX_MIME,
                    body: vec![0u8; MAX_BYTES + 1],
                }
            } else {
                json(
                    200,
                    serde_json::json!({"id": "big", "name": "Big", "mimeType": XLSX_MIME}),
                )
            }
        })
        .await;
        assert!(
            signed_in(&base)
                .download("big")
                .await
                .unwrap_err()
                .contains("15 MB")
        );
    }

    /// Against the real Google (needs the internet; run with `--ignored`): the call gets there over
    /// TLS, with this computer's own proxy settings, and Google's refusal of a made-up client is read.
    #[tokio::test]
    #[ignore = "needs the internet"]
    async fn the_real_google_refuses_a_made_up_client_in_words_we_understand() {
        let http = reqwest::Client::builder().build().unwrap();
        let outcome = post_token(
            &http,
            &Urls::google().token,
            &[
                ("grant_type", "authorization_code"),
                ("code", "x"),
                ("client_id", "123-made-up.apps.googleusercontent.com"),
                ("client_secret", "GOCSPX-made-up"),
                ("redirect_uri", "http://127.0.0.1:1"),
                ("code_verifier", "x"),
            ],
        )
        .await;
        match outcome {
            Err(TokenFailure::Refused { error, message }) => {
                assert_eq!(error, "invalid_client");
                assert!(message.contains("Desktop app"), "{message}");
            }
            other => panic!("expected Google to refuse the client, got {other:?}"),
        }
        // The sign-in page itself is up for a client Google doesn't know (it says so, in HTML).
        let page = http
            .get(
                Url::parse_with_params(
                    &Urls::google().auth,
                    &[
                        ("client_id", "123-made-up.apps.googleusercontent.com"),
                        ("response_type", "code"),
                        ("scope", "openid"),
                        ("redirect_uri", "http://127.0.0.1:1"),
                    ],
                )
                .unwrap(),
            )
            .send()
            .await
            .unwrap();
        assert!(page.status().as_u16() < 500, "{}", page.status());
    }

    #[tokio::test]
    async fn sign_out_asks_google_to_forget_and_keeps_the_client() {
        let (base, seen) = stand_in(|_| json(200, serde_json::json!({}))).await;
        let state = signed_in(&base);
        state.sign_out(false).await.unwrap();
        let revoke = seen.lock().unwrap()[0].clone();
        assert_eq!(revoke.target, "/revoke");
        assert_eq!(form(&revoke.body)["token"], "rt-1");
        let status = state.status();
        assert!(!status.signed_in && status.configured);
        assert!(state.access_token(false).await.is_err());
    }

    /// What build.rs makes of google-client.json (read here the same way): the client is built in when
    /// the file has two real values, and not otherwise. Values are compared, never printed.
    #[test]
    fn the_client_file_is_built_in_when_it_has_real_values() {
        let file = Path::new(env!("CARGO_MANIFEST_DIR")).join("google-client.json");
        let wanted = std::fs::read_to_string(file)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|value| {
                let id = value["clientId"].as_str()?.trim().to_string();
                let secret = value["clientSecret"].as_str()?.trim().to_string();
                let is_example =
                    id == "123456-abc.apps.googleusercontent.com" || secret == "GOCSPX-...";
                (!id.is_empty() && !secret.is_empty() && !is_example).then_some((id, secret))
            });
        assert_eq!(built_in_client(), wanted);
    }

    #[tokio::test]
    async fn a_client_built_into_the_app_is_used_until_one_is_saved_here() {
        let (base, seen) = stand_in(token_stand_in()).await;
        let mut state = GoogleState::with_urls(&folder("built-in"), urls_at(&base));
        state.built_in = Some((
            "built-in.apps.googleusercontent.com".into(),
            "GOCSPX-built".into(),
        ));
        // Nothing saved here, yet sign-in can start, and the saved-client fields say so.
        let status = state.status();
        assert!(status.configured && status.built_in && !status.signed_in);
        assert_eq!(status.client_id, "");
        // A token is made with the built-in client.
        let mut next = state.stored();
        next.refresh_token = "rt-1".into();
        state.keep(next).unwrap();
        assert_eq!(state.access_token(false).await.unwrap(), "at-2");
        let request = seen.lock().unwrap()[0].clone();
        assert_eq!(
            form(&request.body)["client_id"],
            "built-in.apps.googleusercontent.com"
        );
        assert_eq!(form(&request.body)["client_secret"], "GOCSPX-built");
        // One saved here wins (and signs out, as changing client always does)...
        state.save_client(CLIENT, "GOCSPX-secret").unwrap();
        assert_eq!(state.client().unwrap().0, CLIENT);
        assert!(!state.status().signed_in);
        // ...and forgetting it goes back to the built-in one.
        state.sign_out(true).await.unwrap();
        assert_eq!(
            state.client().unwrap().0,
            "built-in.apps.googleusercontent.com"
        );
        assert!(state.status().configured);
    }

    #[tokio::test]
    async fn forgetting_the_client_ends_a_sign_in_that_is_waiting() {
        let (base, _seen) = stand_in(|_| json(200, serde_json::json!({}))).await;
        let state = signed_in(&base);
        let (sender, mut receiver) = oneshot::channel();
        *state.cancel.lock().unwrap() = Some(sender);
        state.sign_out(true).await.unwrap();
        assert!(
            receiver.try_recv().is_ok(),
            "the waiting sign-in was told to stop"
        );
        assert!(state.cancel.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn sign_out_can_forget_the_client_too() {
        let (base, seen) = stand_in(|_| json(200, serde_json::json!({}))).await;
        let state = signed_in(&base);
        state.sign_out(true).await.unwrap();
        // Google is still told to forget the access before the client goes.
        assert_eq!(seen.lock().unwrap()[0].target, "/revoke");
        let status = state.status();
        assert!(!status.signed_in && !status.configured && !status.has_secret);
        assert_eq!(status.client_id, "");
        assert!(state.access_token(false).await.is_err());
    }

    #[tokio::test]
    async fn makes_a_sheet_from_a_workbook_and_replaces_its_content_later() {
        let (base, seen) = stand_in(|asked| {
            if asked.method == "POST" && asked.target.starts_with("/upload/drive/v3/files?") {
                json(200, serde_json::json!({"id": "new1", "name": "UKMAC – Pursat", "mimeType": SHEET_MIME}))
            } else if asked.method == "PATCH" && asked.target.starts_with("/upload/drive/v3/files/new1?") {
                json(200, serde_json::json!({"id": "new1", "name": "UKMAC – Pursat", "mimeType": SHEET_MIME}))
            } else {
                json(404, serde_json::json!({}))
            }
        })
        .await;
        let state = signed_in(&base);
        // A sign-in from before this permission existed can only read.
        let denied = state.upload_sheet("UKMAC – Pursat", None, b"PK-1".to_vec()).await.unwrap_err();
        assert!(denied.contains("sign in with Google again"));
        let mut next = state.stored();
        next.scope = format!("openid {DRIVE_SCOPE} {FILE_SCOPE}");
        state.keep(next).unwrap();
        assert!(state.status().can_create);

        let made = state.upload_sheet("UKMAC – Pursat", None, b"PK-workbook-1".to_vec()).await.unwrap();
        assert_eq!((made.id.as_str(), made.mime_type.as_str()), ("new1", SHEET_MIME));
        let again = state.upload_sheet("ignored", Some("new1"), b"PK-workbook-2".to_vec()).await.unwrap();
        assert_eq!(again.id, "new1");

        let seen = seen.lock().unwrap();
        let first = &seen[0];
        assert!(first.headers["content-type"].starts_with("multipart/related; boundary="));
        assert_eq!(first.headers["authorization"], "Bearer at-1");
        // Metadata first, naming the file and asking Google to turn it into a sheet, then the workbook itself.
        assert!(first.body.contains("\"mimeType\":\"application/vnd.google-apps.spreadsheet\""));
        assert!(first.body.contains("UKMAC – Pursat"));
        assert!(first.body.contains(&format!("Content-Type: {XLSX_MIME}\r\n\r\nPK-workbook-1")));
        // The second call writes the new content over the same sheet, as the workbook alone.
        let second = &seen[1];
        assert_eq!(second.method, "PATCH");
        assert_eq!(second.headers["content-type"], XLSX_MIME);
        assert_eq!(second.body, "PK-workbook-2");
    }
}
