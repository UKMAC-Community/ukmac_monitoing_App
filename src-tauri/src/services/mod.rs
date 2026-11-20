//! What the app does beyond reading and writing tables: Google sign-in and Drive, the optional AI
//! connection, `.ukmac` files, the chili template, which tab each table reads, whose MACs these are, and UI-only updates.

pub mod access;
pub mod ai;
pub mod client_seal;
pub mod google;
pub mod links;
pub mod mac_file;
pub mod template;
pub mod ui_update;
