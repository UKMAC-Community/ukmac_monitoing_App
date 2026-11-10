#[path = "src/client_seal.rs"]
mod client_seal;

/// 32 random bytes for this build's seal.
fn random_key() -> Vec<u8> {
    use std::io::Read;
    let mut key = vec![0u8; 32];
    if std::fs::File::open("/dev/urandom").and_then(|mut file| file.read_exact(&mut key)).is_ok() {
        return key;
    }
    // No /dev/urandom (not macOS or Linux): the time and this process, mixed.
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|time| time.as_nanos()).unwrap_or(0);
    let mixed = format!("{now}-{}-{:?}", std::process::id(), std::thread::current().id());
    client_seal::apply(mixed.as_bytes(), &key)
}

fn main() {
    // The Google client shared by everyone who uses this build (see google-client.example.json): when
    // google-client.json is here, its two values are sealed (client_seal.rs) and built into the app, so
    // people only press Sign in. Their values are never printed.
    println!("cargo:rerun-if-changed=google-client.json");
    println!("cargo:rerun-if-env-changed=UKMAC_GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=UKMAC_GOOGLE_CLIENT_SECRET");
    let mut given: Option<(String, String)> = None;
    if let Ok(text) = std::fs::read_to_string("google-client.json") {
        match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(value) => {
                let id = value["clientId"].as_str().unwrap_or("").trim().to_string();
                let secret = value["clientSecret"].as_str().unwrap_or("").trim().to_string();
                given = Some((id, secret));
            }
            Err(error) => println!("cargo:warning=google-client.json can't be read ({error}): no Google client is built in"),
        }
    } else if let (Ok(id), Ok(secret)) = (std::env::var("UKMAC_GOOGLE_CLIENT_ID"), std::env::var("UKMAC_GOOGLE_CLIENT_SECRET")) {
        given = Some((id.trim().to_string(), secret.trim().to_string()));
    }
    if let Some((id, secret)) = given {
        let is_example = id == "123456-abc.apps.googleusercontent.com" || secret == "GOCSPX-...";
        if !id.is_empty() && !secret.is_empty() && !is_example {
            let key = random_key();
            println!("cargo:rustc-env=UKMAC_GOOGLE_CLIENT_SEALED={}", client_seal::seal(&id, &secret, &key));
            println!("cargo:rustc-env=UKMAC_GOOGLE_CLIENT_KEY={}", client_seal::to_hex(&key));
        } else {
            println!("cargo:warning=the Google client still has the example values or an empty one: no Google client is built in");
        }
    }
    tauri_build::build()
}
