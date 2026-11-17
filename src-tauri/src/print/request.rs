// ============================================================================
// طلب الطباعة القادم من الواجهة (camelCase، يطابق `NativePrintRequest` في
// src/print/types.ts). بحت بلا أي اعتماد على tauri أو ويندوز، فيُختبَر على أي
// نظام. الواجهة لا يُوثَق بها: كل قيمة تُنقَّح هنا قبل أن تصل إلى WebView2.
// ============================================================================

// المساعدات أدناه تستعملها خلفية ويندوز فقط؛ على غير ويندوز تُختبَر فقط.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Deserialize;

/// أقصى عدد نسخ نقبله (حماية من إدخال خاطئ يكرّر الطباعة عشرات المرات).
pub const MAX_COPIES: u32 = 99;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrintMode {
    /// نافذة طباعة النظام (ويندوز) — يختار المستخدم الطابعة والصفحات والنسخ.
    Dialog,
    /// إرسال مباشر بلا أي واجهة.
    Direct,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Duplex {
    #[default]
    Default,
    OneSided,
    LongEdge,
    ShortEdge,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintRequest {
    pub mode: PrintMode,
    #[serde(default)]
    pub printer_name: Option<String>,
    #[serde(default)]
    pub copies: Option<u32>,
    #[serde(default)]
    pub duplex: Option<Duplex>,
}

impl PrintRequest {
    /// اسم الطابعة كما حُفظ (بعد قص الفراغات الطرفية فقط)، أو `None` إن كان
    /// فارغاً — أي «طابعة ويندوز الافتراضية». لا يُعدَّل الاسم بأي شكل آخر.
    pub fn printer(&self) -> Option<&str> {
        self.printer_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
    }

    /// عدد النسخ محصوراً بين 1 و`MAX_COPIES` (غائب = 1).
    pub fn copies_clamped(&self) -> u32 {
        self.copies.unwrap_or(1).clamp(1, MAX_COPIES)
    }

    pub fn duplex_or_default(&self) -> Duplex {
        self.duplex.unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Result<PrintRequest, serde_json::Error> {
        serde_json::from_str(json)
    }

    #[test]
    fn minimal_dialog_request() {
        let req = parse(r#"{"mode":"dialog"}"#).unwrap();
        assert_eq!(req.mode, PrintMode::Dialog);
        assert_eq!(req.printer(), None);
        assert_eq!(req.copies_clamped(), 1);
        assert_eq!(req.duplex_or_default(), Duplex::Default);
    }

    #[test]
    fn full_direct_request_uses_camel_case_and_kebab_duplex() {
        let req = parse(
            r#"{"mode":"direct","printerName":"HP LaserJet","copies":3,"duplex":"long-edge"}"#,
        )
        .unwrap();
        assert_eq!(req.mode, PrintMode::Direct);
        assert_eq!(req.printer(), Some("HP LaserJet"));
        assert_eq!(req.copies_clamped(), 3);
        assert_eq!(req.duplex_or_default(), Duplex::LongEdge);
        for (text, want) in [
            ("default", Duplex::Default),
            ("one-sided", Duplex::OneSided),
            ("long-edge", Duplex::LongEdge),
            ("short-edge", Duplex::ShortEdge),
        ] {
            let r = parse(&format!(r#"{{"mode":"direct","duplex":"{text}"}}"#)).unwrap();
            assert_eq!(r.duplex_or_default(), want, "{text}");
        }
    }

    #[test]
    fn nulls_from_javascript_are_accepted() {
        let req =
            parse(r#"{"mode":"direct","printerName":null,"copies":null,"duplex":null}"#).unwrap();
        assert_eq!(req.printer(), None);
        assert_eq!(req.copies_clamped(), 1);
        assert_eq!(req.duplex_or_default(), Duplex::Default);
    }

    #[test]
    fn printer_name_is_passed_through_exactly_apart_from_edge_trim() {
        let req = parse(r#"{"mode":"direct","printerName":"  طابعة المكتب (HP) \\\\srv\\p1  "}"#)
            .unwrap();
        assert_eq!(req.printer(), Some("طابعة المكتب (HP) \\\\srv\\p1"));
        for blank in ["", "   ", "\\t"] {
            let r = parse(&format!(r#"{{"mode":"direct","printerName":"{blank}"}}"#)).unwrap();
            assert_eq!(r.printer(), None, "{blank:?}");
        }
    }

    #[test]
    fn copies_are_clamped() {
        for (input, want) in [(0u32, 1u32), (1, 1), (2, 2), (99, 99), (100, 99), (u32::MAX, 99)] {
            let r = parse(&format!(r#"{{"mode":"direct","copies":{input}}}"#)).unwrap();
            assert_eq!(r.copies_clamped(), want, "{input}");
        }
    }

    #[test]
    fn invalid_requests_are_rejected() {
        for bad in [
            r#"{}"#,
            r#"{"mode":"silent"}"#,
            r#"{"mode":"direct","duplex":"both"}"#,
            r#"{"mode":"direct","copies":-1}"#,
            r#"{"mode":"direct","copies":"2"}"#,
        ] {
            assert!(parse(bad).is_err(), "يجب رفض: {bad}");
        }
    }
}
