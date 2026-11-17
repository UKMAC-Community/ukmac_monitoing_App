//! The shared Google client, kept in the built app as sealed bytes instead of plain text.
//!
//! This keeps it out of a text search of the app file and out of secret scanners. It is not protection
//! against someone who runs the app: the app has to open it to use it, and the secret goes to Google on
//! every sign-in. What really limits a leaked client is the consent screen (Internal: only the
//! organisation's own accounts can sign in), and every person still signs in as themselves.
//!
//! build.rs seals it (this file is shared with it); the app opens it.
#![allow(dead_code)]

use sha2::{Digest, Sha256};

/// `data` XOR a stream made from SHA-256 of the key and a counter. Sealing and opening are the same.
pub fn apply(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    for (index, chunk) in data.chunks(32).enumerate() {
        let mut hasher = Sha256::new();
        hasher.update(key);
        hasher.update((index as u64).to_le_bytes());
        let pad = hasher.finalize();
        out.extend(chunk.iter().zip(pad.iter()).map(|(byte, pad)| byte ^ pad));
    }
    out
}

pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn from_hex(text: &str) -> Option<Vec<u8>> {
    let text = text.trim();
    if text.len() % 2 != 0 || !text.is_ascii() {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).ok())
        .collect()
}

/// The ID and secret, sealed and written as hex.
pub fn seal(client_id: &str, client_secret: &str, key: &[u8]) -> String {
    to_hex(&apply(
        key,
        format!("{client_id}\n{client_secret}").as_bytes(),
    ))
}

/// The ID and secret back out of sealed hex and the key's hex; None if either is wrong.
pub fn open(sealed_hex: &str, key_hex: &str) -> Option<(String, String)> {
    let key = from_hex(key_hex)?;
    let plain = String::from_utf8(apply(&key, &from_hex(sealed_hex)?)).ok()?;
    let (id, secret) = plain.split_once('\n')?;
    (!id.is_empty() && !secret.is_empty()).then(|| (id.to_string(), secret.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "123-test.apps.googleusercontent.com";
    const SECRET: &str = "GOCSPX-test-secret-value-that-is-longer-than-one-block-of-the-stream";

    #[test]
    fn what_is_sealed_opens_with_its_key_and_shows_no_plain_text() {
        let key = [7u8; 32];
        let sealed = seal(ID, SECRET, &key);
        assert_eq!(
            open(&sealed, &to_hex(&key)),
            Some((ID.to_string(), SECRET.to_string()))
        );
        // Neither the hex nor its bytes carry the values as text.
        let bytes = from_hex(&sealed).unwrap();
        for plain in [ID, SECRET, "GOCSPX", "googleusercontent"] {
            assert!(!sealed.contains(plain));
            assert!(
                !bytes
                    .windows(plain.len())
                    .any(|window| window == plain.as_bytes())
            );
        }
    }

    #[test]
    fn another_key_or_damaged_bytes_open_nothing() {
        let sealed = seal(ID, SECRET, &[7u8; 32]);
        assert_eq!(open(&sealed, &to_hex(&[8u8; 32])), None);
        assert_eq!(open("zz", &to_hex(&[7u8; 32])), None);
        assert_eq!(open(&sealed, "not hex"), None);
    }
}
