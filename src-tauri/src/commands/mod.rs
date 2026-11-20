//! What the Angular side calls (`invoke`): every Tauri command, grouped by what it works on.
//! A command checks the account may see the MAC, then hands the work to `db` and `services`.
//! Each command keeps the name the frontend calls it by.

pub mod access;
pub mod ai;
pub mod assistant;
pub mod files;
pub mod google;
pub mod links;
pub mod mac_file;
pub mod mac_key;
pub mod macs;
pub mod rows;
pub mod settings;
pub mod sheets;
pub mod ui_update;
