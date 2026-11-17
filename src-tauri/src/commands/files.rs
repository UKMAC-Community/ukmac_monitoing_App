//! Files the user picks: read one in, write one out.

use crate::error::{CmdResult, err};

#[tauri::command]
pub fn read_file(path: String) -> CmdResult<tauri::ipc::Response> {
    let metadata = std::fs::metadata(&path).map_err(err)?;
    if metadata.len() > 30 * 1024 * 1024 {
        return Err("Keep the file under 30 MB".into());
    }
    let bytes = std::fs::read(&path).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| (b as char).to_digit(16);
            if let (Some(high), Some(low)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((high * 16 + low) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Writes the request's bytes to the file its `path` header names
/// (percent-encoded).
#[tauri::command]
pub fn write_file(request: tauri::ipc::Request<'_>) -> CmdResult<()> {
    let path = request
        .headers()
        .get("path")
        .and_then(|value| value.to_str().ok())
        .map(percent_decode)
        .ok_or("No file to write to")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Nothing to write".into());
    };
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent).map_err(err)?;
        }
    }
    std::fs::write(&path, bytes).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_come_through_the_header() {
        assert_eq!(
            percent_decode("%2FUsers%2Fy%2FUKMAC%20%E1%9E%80.xlsx"),
            "/Users/y/UKMAC \u{1780}.xlsx"
        );
    }
}
