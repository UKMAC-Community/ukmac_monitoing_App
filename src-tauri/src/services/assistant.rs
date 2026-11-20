//! The local assistant: a small language model that runs on this computer, to put what the app finds in the data into words.
//!
//! Nothing here reaches the internet except the two downloads, each from one fixed address, checked against a fixed SHA-256:
//! the engine (llama.cpp's `llama-server`, a release build by the llama.cpp project) and the model file (Qwen2.5-1.5B-Instruct,
//! 4-bit, from Hugging Face). Both are kept in the app's data folder. The engine is started on a private port of this computer
//! (127.0.0.1) and asked questions over that port; it is stopped when the app closes, after a quiet spell, or on request.
//! What is asked (records taken from the farm's tables) never leaves this computer.
//!
//! Only macOS has an engine for now: on other systems `status().supported` is false.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::error::{CmdResult, err};

pub const MODEL_NAME: &str = "Qwen2.5 1.5B Instruct (4-bit)";
const MODEL_URL: &str = "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf";
const MODEL_SHA256: &str = "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e";
const MODEL_BYTES: u64 = 1_117_320_736;
const ENGINE_VERSION: &str = "b12556";

/// One engine build: where it is from and what it must hash to.
struct Engine {
    url: &'static str,
    sha256: &'static str,
    bytes: u64,
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const ENGINE: Option<Engine> = Some(Engine {
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b12556/llama-b12556-bin-macos-arm64.tar.gz",
    sha256: "eb92254d5ada74c6753bd6ef0d23f498ffe2872b7222043eb48743abcaac8333",
    bytes: 16_449_908,
});
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const ENGINE: Option<Engine> = Some(Engine {
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b12556/llama-b12556-bin-macos-x64.tar.gz",
    sha256: "df7cf8208e0aa67c2dd2303a969eb67495f4c55253863a5109fa6a3d765d402b",
    bytes: 12_227_452,
});
#[cfg(not(target_os = "macos"))]
const ENGINE: Option<Engine> = None;

/// The longest the assistant may be asked to read, in characters (about 4 per token; the engine is given room for 8k tokens).
pub const MAX_CONTEXT_CHARS: usize = 18_000;
const CONTEXT_TOKENS: &str = "8192";
const ANSWER_TOKENS: u32 = 700;
const START_SECS: u64 = 120;
const ASK_SECS: u64 = 300;
/// The engine is stopped after this long without a question, to give its memory back.
const IDLE: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssistantStatus {
    /// This computer has an engine to download.
    pub supported: bool,
    pub engine_ready: bool,
    pub model_ready: bool,
    pub running: bool,
    pub installing: bool,
    pub model_name: &'static str,
    /// What is still to download, in bytes (0 when both are in place).
    pub download_bytes: u64,
    /// What the files take on disk now.
    pub disk_bytes: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    /// `engine`, `model` or `check`.
    phase: &'static str,
    done: u64,
    total: u64,
}

struct Running {
    child: Child,
    port: u16,
    last_used: Instant,
}

pub struct AssistantState {
    folder: PathBuf,
    running: Mutex<Option<Running>>,
    installing: AtomicBool,
    cancel: AtomicBool,
}

impl AssistantState {
    pub fn new(data_folder: &Path) -> Self {
        Self {
            folder: data_folder.join("assistant"),
            running: Mutex::new(None),
            installing: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
        }
    }

    fn model_path(&self) -> PathBuf {
        self.folder.join("model.gguf")
    }

    fn engine_dir(&self) -> PathBuf {
        self.folder.join("engine").join(ENGINE_VERSION)
    }

    fn server_path(&self) -> PathBuf {
        self.engine_dir().join(format!("llama-{ENGINE_VERSION}")).join("llama-server")
    }

    pub fn status(&self) -> AssistantStatus {
        let engine_ready = ENGINE.is_some() && self.server_path().is_file();
        let model_ready = self.model_path().is_file();
        let mut download = 0;
        if let Some(engine) = &ENGINE {
            if !engine_ready {
                download += engine.bytes;
            }
        }
        if !model_ready {
            let have = fs::metadata(self.folder.join("model.gguf.part")).map(|meta| meta.len()).unwrap_or(0);
            download += MODEL_BYTES.saturating_sub(have);
        }
        AssistantStatus {
            supported: ENGINE.is_some(),
            engine_ready,
            model_ready,
            running: self.running.lock().map(|run| run.is_some()).unwrap_or(false),
            installing: self.installing.load(Ordering::SeqCst),
            model_name: MODEL_NAME,
            download_bytes: download,
            disk_bytes: dir_size(&self.folder),
        }
    }

    /// Asks a running download to stop (what is fetched so far is kept, to carry on from).
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Downloads and checks what is missing: the engine, then the model. Progress goes out as `assistant-progress` events.
    pub async fn install(&self, app: &AppHandle) -> CmdResult<()> {
        let engine = ENGINE.as_ref().ok_or("The local assistant isn't available on this system yet (it runs on a Mac).")?;
        if self.installing.swap(true, Ordering::SeqCst) {
            return Err("It is already being downloaded.".into());
        }
        self.cancel.store(false, Ordering::SeqCst);
        let result = self.install_inner(app, engine).await;
        self.installing.store(false, Ordering::SeqCst);
        result
    }

    async fn install_inner(&self, app: &AppHandle, engine: &Engine) -> CmdResult<()> {
        fs::create_dir_all(&self.folder).map_err(err)?;
        if !self.server_path().is_file() {
            let archive = self.folder.join("engine.tar.gz");
            self.fetch(app, "engine", engine.url, &archive, engine.bytes).await?;
            emit(app, "check", 0, 1);
            if file_sha256(&archive)? != engine.sha256 {
                let _ = fs::remove_file(&archive);
                return Err("The engine download didn't match what was expected, so it was thrown away. Try again.".into());
            }
            let dest = self.engine_dir();
            let _ = fs::remove_dir_all(&dest);
            fs::create_dir_all(&dest).map_err(err)?;
            let unpacked = unpack_engine(&archive, &dest);
            let _ = fs::remove_file(&archive);
            if let Err(error) = unpacked {
                let _ = fs::remove_dir_all(&dest);
                return Err(error);
            }
            if !self.server_path().is_file() {
                let _ = fs::remove_dir_all(&dest);
                return Err("The engine download didn't hold the program it should.".into());
            }
        }
        if !self.model_path().is_file() {
            let part = self.folder.join("model.gguf.part");
            self.fetch(app, "model", MODEL_URL, &part, MODEL_BYTES).await?;
            emit(app, "check", 0, 1);
            if file_sha256(&part)? != MODEL_SHA256 {
                let _ = fs::remove_file(&part);
                return Err("The model download didn't match what was expected, so it was thrown away. Try again.".into());
            }
            fs::rename(&part, self.model_path()).map_err(err)?;
        }
        emit(app, "check", 1, 1);
        Ok(())
    }

    /// Downloads `url` into `part`, carrying on from what is already there. Stops, keeping it, if `cancel` is set.
    async fn fetch(&self, app: &AppHandle, phase: &'static str, url: &str, part: &Path, total_hint: u64) -> CmdResult<()> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .read_timeout(Duration::from_secs(60))
            .build()
            .map_err(err)?;
        let have = fs::metadata(part).map(|meta| meta.len()).unwrap_or(0);
        if have == total_hint {
            return Ok(());
        }
        let mut request = client.get(url);
        if have > 0 {
            request = request.header("Range", format!("bytes={have}-"));
        }
        let mut response = request.send().await.map_err(|error| format!("Could not reach the download: {error}"))?;
        let status = response.status();
        let resumed = status.as_u16() == 206;
        if !status.is_success() {
            if status.as_u16() == 416 {
                // What is there is more than the file: start again.
                let _ = fs::remove_file(part);
            }
            return Err(format!("The download was refused ({status}). Try again later."));
        }
        let mut file = if resumed {
            fs::OpenOptions::new().append(true).open(part).map_err(err)?
        } else {
            File::create(part).map_err(err)?
        };
        let mut done = if resumed { have } else { 0 };
        let total = if resumed { have + response.content_length().unwrap_or(total_hint - have) } else { response.content_length().unwrap_or(total_hint) };
        let mut last = Instant::now();
        while let Some(chunk) = response.chunk().await.map_err(|error| format!("The download was interrupted: {error}. Press Download to carry on."))? {
            if self.cancel.load(Ordering::SeqCst) {
                return Err("Stopped. What was downloaded is kept; Download carries on from there.".into());
            }
            file.write_all(&chunk).map_err(err)?;
            done += chunk.len() as u64;
            if last.elapsed() >= Duration::from_millis(250) {
                emit(app, phase, done, total);
                last = Instant::now();
            }
        }
        file.flush().map_err(err)?;
        emit(app, phase, done, total);
        if total > 0 && done < total {
            return Err("The download stopped early. Press Download to carry on.".into());
        }
        Ok(())
    }

    /// Starts the engine on a private port (if it isn't running), and waits until it has loaded the model. Returns the port.
    pub async fn start(&self) -> CmdResult<u16> {
        if let Some(port) = self.touch() {
            return Ok(port);
        }
        if !self.status().engine_ready || !self.status().model_ready {
            return Err("The assistant isn't downloaded yet: set it up in Settings.".into());
        }
        let port = free_port()?;
        let log = File::create(self.folder.join("engine.log")).map_err(err)?;
        let log_err = log.try_clone().map_err(err)?;
        let child = Command::new(self.server_path())
            .arg("-m")
            .arg(self.model_path())
            .args(["--host", "127.0.0.1", "--port", &port.to_string(), "-c", CONTEXT_TOKENS, "--no-webui"])
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_err))
            .spawn()
            .map_err(|error| format!("The assistant could not be started: {error}"))?;
        *self.running.lock().map_err(err)? = Some(Running { child, port, last_used: Instant::now() });
        let client = reqwest::Client::builder().timeout(Duration::from_secs(3)).build().map_err(err)?;
        let began = Instant::now();
        loop {
            if began.elapsed() > Duration::from_secs(START_SECS) {
                self.stop();
                return Err("The assistant took too long to load. Try again.".into());
            }
            if self.exited() {
                self.stop();
                return Err("The assistant stopped while loading. Its log is in the assistant folder (engine.log).".into());
            }
            if let Ok(response) = client.get(format!("http://127.0.0.1:{port}/health")).send().await {
                if response.status().is_success() {
                    return Ok(port);
                }
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
    }

    /// The port of the running engine, marked as just used.
    fn touch(&self) -> Option<u16> {
        let mut guard = self.running.lock().ok()?;
        let run = guard.as_mut()?;
        if run.child.try_wait().ok().flatten().is_some() {
            *guard = None;
            return None;
        }
        run.last_used = Instant::now();
        Some(run.port)
    }

    fn exited(&self) -> bool {
        match self.running.lock() {
            Ok(mut guard) => guard.as_mut().map(|run| run.child.try_wait().ok().flatten().is_some()).unwrap_or(true),
            Err(_) => true,
        }
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.running.lock() {
            if let Some(mut run) = guard.take() {
                let _ = run.child.kill();
                let _ = run.child.wait();
            }
        }
    }

    /// Stops the engine if nobody has asked it anything for a while.
    pub fn stop_if_idle(&self) {
        let idle = self.running.lock().map(|guard| guard.as_ref().map(|run| run.last_used.elapsed() > IDLE).unwrap_or(false)).unwrap_or(false);
        if idle {
            self.stop();
        }
    }

    /// Takes the downloads off this computer.
    pub fn remove(&self) -> CmdResult<()> {
        if self.installing.load(Ordering::SeqCst) {
            return Err("Stop the download first.".into());
        }
        self.stop();
        match fs::remove_dir_all(&self.folder) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(err(error)),
        }
    }

    /// One question: `system` says how to answer, `context` is what the app found in the tables (query results, records), `question` is the person's.
    pub async fn ask(&self, system: &str, context: &str, question: &str) -> CmdResult<String> {
        let port = self.start().await?;
        let context: String = context.chars().take(MAX_CONTEXT_CHARS).collect();
        let question: String = question.chars().take(1_000).collect();
        let body = json!({
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": format!("{context}\n\nQUESTION: {question}") },
            ],
            "temperature": 0.2,
            "max_tokens": ANSWER_TOKENS,
            "stream": false,
        });
        let client = reqwest::Client::builder().timeout(Duration::from_secs(ASK_SECS)).build().map_err(err)?;
        let response = client
            .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
            .json(&body)
            .send()
            .await
            .map_err(|error| format!("The assistant didn't answer: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("The assistant couldn't answer ({}).", response.status()));
        }
        let value: Value = response.json().await.map_err(err)?;
        self.touch();
        let text = value["choices"][0]["message"]["content"].as_str().unwrap_or("").trim().to_string();
        if text.is_empty() {
            return Err("The assistant gave no answer. Try asking it another way.".into());
        }
        Ok(text)
    }
}

impl Drop for AssistantState {
    fn drop(&mut self) {
        self.stop();
    }
}

fn emit(app: &AppHandle, phase: &'static str, done: u64, total: u64) {
    let _ = app.emit("assistant-progress", Progress { phase, done, total });
}

fn free_port() -> CmdResult<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(err)?;
    Ok(listener.local_addr().map_err(err)?.port())
}

pub fn file_sha256(path: &Path) -> CmdResult<String> {
    let mut file = File::open(path).map_err(err)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer).map_err(err)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Takes the server program and its libraries out of llama.cpp's release archive (the rest of it is tools this app doesn't use).
fn unpack_engine(archive: &Path, dest: &Path) -> CmdResult<()> {
    let file = File::open(archive).map_err(err)?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    tar.set_preserve_permissions(true);
    for entry in tar.entries().map_err(err)? {
        let mut entry = entry.map_err(err)?;
        let path = entry.path().map_err(err)?.into_owned();
        let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
        if name == "llama-server" || name.ends_with(".dylib") {
            entry.unpack_in(dest).map_err(err)?;
        }
    }
    Ok(())
}

fn dir_size(folder: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(folder) else { return 0 };
    entries
        .flatten()
        .map(|entry| match entry.metadata() {
            Ok(meta) if meta.is_dir() => dir_size(&entry.path()),
            Ok(meta) => meta.len(),
            Err(_) => 0,
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("ukmac-assistant-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn a_fresh_folder_has_nothing_downloaded() {
        let root = folder("fresh");
        let status = AssistantState::new(&root).status();
        assert!(!status.engine_ready && !status.model_ready && !status.running && !status.installing);
        assert!(status.download_bytes >= MODEL_BYTES);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_partial_model_counts_only_what_is_left_to_fetch() {
        let root = folder("partial");
        let state = AssistantState::new(&root);
        fs::create_dir_all(root.join("assistant")).unwrap();
        fs::write(root.join("assistant").join("model.gguf.part"), vec![0u8; 1000]).unwrap();
        let before = AssistantState::new(&folder("none")).status().download_bytes;
        assert_eq!(state.status().download_bytes, before - 1000);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn the_hash_of_a_file_is_its_sha256() {
        let root = folder("hash");
        let file = root.join("a.txt");
        fs::write(&file, b"abc").unwrap();
        assert_eq!(file_sha256(&file).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn removing_takes_the_folder_and_nothing_is_not_an_error() {
        let root = folder("remove");
        let state = AssistantState::new(&root);
        fs::create_dir_all(root.join("assistant")).unwrap();
        fs::write(root.join("assistant").join("x"), b"1").unwrap();
        state.remove().unwrap();
        assert!(!root.join("assistant").exists());
        state.remove().unwrap();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn only_the_server_and_its_libraries_are_taken_from_the_archive() {
        let root = folder("unpack");
        let archive = root.join("e.tar.gz");
        {
            let encoder = flate2::write::GzEncoder::new(File::create(&archive).unwrap(), flate2::Compression::fast());
            let mut builder = tar::Builder::new(encoder);
            for (name, body) in [("llama-b1/llama-server", "x"), ("llama-b1/libllama.dylib", "y"), ("llama-b1/llama-cli", "z"), ("llama-b1/LICENSE", "w")] {
                let mut header = tar::Header::new_gnu();
                header.set_size(body.len() as u64);
                header.set_mode(0o755);
                header.set_cksum();
                builder.append_data(&mut header, name, body.as_bytes()).unwrap();
            }
            builder.into_inner().unwrap().finish().unwrap();
        }
        let dest = root.join("out");
        fs::create_dir_all(&dest).unwrap();
        unpack_engine(&archive, &dest).unwrap();
        assert!(dest.join("llama-b1/llama-server").is_file());
        assert!(dest.join("llama-b1/libllama.dylib").is_file());
        assert!(!dest.join("llama-b1/llama-cli").exists());
        assert!(!dest.join("llama-b1/LICENSE").exists());
        let _ = fs::remove_dir_all(root);
    }

    /// Run by hand with UKMAC_ENGINE_TGZ set to the real download: it must unpack to the program the app starts, and that must run.
    #[test]
    #[ignore]
    fn the_real_engine_archive_unpacks_to_a_program_that_runs() {
        let archive = std::env::var("UKMAC_ENGINE_TGZ").expect("UKMAC_ENGINE_TGZ");
        let root = folder("real");
        let state = AssistantState::new(&root);
        let dest = state.engine_dir();
        fs::create_dir_all(&dest).unwrap();
        unpack_engine(Path::new(&archive), &dest).unwrap();
        assert!(state.server_path().is_file());
        let out = Command::new(state.server_path()).arg("--version").output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        let _ = fs::remove_dir_all(root);
    }
}
