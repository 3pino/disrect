//! WebDAV（ネットワークドライブ）の置き場所。Tauri には依らない（`commands.rs` が、コマンドとして出す）。
//! 手順と決まりは `client.rs` の先頭。ローカルの `fs` とは別（こちらは、ローカルの関数を呼ばない）。

mod client;
pub mod commands;
mod url;
mod xml;

pub use client::{build_client, net_error, quote_etag, status_error, Ctx, Dav, DavEntry, Progress, SIZE_DIR_LIMIT};
pub use xml::{parse_http_date, parse_multistatus, Resource};

#[cfg(test)]
mod tests;
