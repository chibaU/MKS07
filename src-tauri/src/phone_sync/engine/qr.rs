// توليد QR كـ SVG نصي (لا صور ولا مكتبات واجهة): يعرضه React عبر <img src="data:...">.

use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};

pub fn svg_for(data: &str) -> Result<String, String> {
    let code = QrCode::with_error_correction_level(data.as_bytes(), EcLevel::M)
        .map_err(|e| format!("تعذّر توليد رمز QR: {e}"))?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(260, 260)
        .quiet_zone(true)
        .dark_color(svg::Color("#0F172A"))
        .light_color(svg::Color("#FFFFFF"))
        .build())
}

#[cfg(test)]
mod tests {
    #[test]
    fn produces_svg() {
        let s = super::svg_for("https://192.168.1.20:47613/#k=ABCDEFGHJKMNPQRS").unwrap();
        assert!(s.contains("<svg"));
    }
}
