//! The result every command returns: an error is a plain sentence the app can show.

pub type CmdResult<T> = Result<T, String>;

pub(crate) fn err<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}
