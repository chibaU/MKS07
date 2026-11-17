// اختيار الخلفية وقت الترجمة: ويندوز ← WebView2، غير ذلك ← fallback (UNSUPPORTED).

#[cfg(windows)]
mod webview2;
#[cfg(windows)]
pub use webview2::print;

#[cfg(not(windows))]
mod fallback;
#[cfg(not(windows))]
pub use fallback::print;
