//! A MAC as one text key: what a link file holds (the tables, and the Google Sheet and tab each one points at, with
//! which column is which), compressed and sealed into a single line to copy and paste. **No data is in it**: like the
//! link file, the data is read from Google, which decides who may read it.
//!
//! The text is encrypted (ChaCha20-Poly1305, a fresh nonce each time) so it can't be read or edited as it travels. The
//! cipher key is built into the app, because the key has to open on any computer with the app; what really keeps a
//! farm's data private is Google: an account that can't open the sheets the key points at gets nothing from it (the
//! app checks that before it adds or shows anything of it).

use std::io::{Read, Write};

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use flate2::Compression;
use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use sha2::{Digest, Sha256};

use crate::error::CmdResult;
use crate::services::mac_file::{MacFile, check_header};

/// What every key starts with: says what it is, and which way it is sealed.
pub const PREFIX: &str = "UKMAC1-";
/// A key that decodes to more than this is not one of ours.
const MAX_JSON: u64 = 16 * 1024 * 1024;
const WRONG_KEY: &str = "That isn't a MAC key from UKMAC Monitoring, or part of it is missing. Copy the whole key again.";

fn cipher() -> ChaCha20Poly1305 {
    let digest = Sha256::digest(b"ukmac-monitoring/mac-key/v1/7c1d0e5a-4b2f-4f0e-9a43-2f5b6d8e91c3");
    ChaCha20Poly1305::new_from_slice(&digest).expect("a SHA-256 digest is the cipher's key size")
}

/// The MAC as a key.
pub fn encode(file: &MacFile) -> CmdResult<String> {
    let json = serde_json::to_vec(file).map_err(|error| error.to_string())?;
    let mut packed = DeflateEncoder::new(Vec::new(), Compression::best());
    packed.write_all(&json).map_err(|error| error.to_string())?;
    let packed = packed.finish().map_err(|error| error.to_string())?;
    let mut nonce = [0u8; 12];
    getrandom::fill(&mut nonce).map_err(|error| error.to_string())?;
    let sealed = cipher()
        .encrypt(&Nonce::from(nonce), packed.as_slice())
        .map_err(|_| "The key could not be made.".to_string())?;
    let mut bytes = nonce.to_vec();
    bytes.extend(sealed);
    Ok(format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes)))
}

/// The MAC in a key (as pasted: spaces and line breaks in it are ignored).
pub fn decode(text: &str) -> CmdResult<MacFile> {
    let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    let body = compact.strip_prefix(PREFIX).ok_or_else(|| WRONG_KEY.to_string())?;
    let bytes = URL_SAFE_NO_PAD.decode(body).map_err(|_| WRONG_KEY.to_string())?;
    if bytes.len() < 12 + 16 {
        return Err(WRONG_KEY.into());
    }
    let (nonce, sealed) = bytes.split_at(12);
    let nonce = Nonce::try_from(nonce).map_err(|_| WRONG_KEY.to_string())?;
    let packed = cipher().decrypt(&nonce, sealed).map_err(|_| WRONG_KEY.to_string())?;
    let mut json = Vec::new();
    DeflateDecoder::new(packed.as_slice())
        .take(MAX_JSON)
        .read_to_end(&mut json)
        .map_err(|_| WRONG_KEY.to_string())?;
    let file: MacFile = serde_json::from_slice(&json).map_err(|_| WRONG_KEY.to_string())?;
    check_header(&file)?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::mac_file::{FileMac, MacFile, FORMAT, VERSION};

    fn file() -> MacFile {
        MacFile {
            format: FORMAT.into(),
            version: VERSION,
            exported_at: "2026-11-20".into(),
            app: "test".into(),
            links_only: true,
            mac: FileMac {
                uuid: "u-1".into(),
                name: "Pursat".into(),
                code: "MAC-001".into(),
                location: None,
                latitude: None,
                longitude: None,
                start_date: None,
                end_date: None,
                crop: "chili".into(),
                note: None,
            },
            sheets: vec![],
        }
    }

    #[test]
    fn a_key_opens_to_the_same_mac() {
        let key = encode(&file()).unwrap();
        assert!(key.starts_with(PREFIX));
        assert!(!key.contains(char::is_whitespace));
        assert!(!key.contains("Pursat"), "the key must not be readable");
        let back = decode(&key).unwrap();
        assert_eq!(back.mac.name, "Pursat");
        assert_eq!(back.mac.uuid, "u-1");
        assert!(back.links_only);
    }

    #[test]
    fn pasted_with_line_breaks_and_spaces_still_opens() {
        let key = encode(&file()).unwrap();
        let broken = format!("  {}\n{}  \n", &key[..20], &key[20..]);
        assert_eq!(decode(&broken).unwrap().mac.code, "MAC-001");
    }

    #[test]
    fn two_keys_of_one_mac_differ() {
        assert_ne!(encode(&file()).unwrap(), encode(&file()).unwrap());
    }

    #[test]
    fn a_cut_or_changed_key_is_refused() {
        let key = encode(&file()).unwrap();
        assert!(decode(&key[..key.len() - 4]).is_err());
        let mut changed: Vec<char> = key.chars().collect();
        let at = changed.len() - 10;
        changed[at] = if changed[at] == 'A' { 'B' } else { 'A' };
        assert!(decode(&changed.into_iter().collect::<String>()).is_err());
        assert!(decode("hello").is_err());
        assert!(decode("").is_err());
        assert!(decode(&format!("{PREFIX}abc")).is_err());
    }
}
