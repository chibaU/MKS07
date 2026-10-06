// صفحة "مزامنة الهاتف" — مستقلة بالكامل: لا تشارك حالة ولا منطقاً مع بقية الصفحات.
// تُحمَّل كسولاً من PhoneSyncEntry.tsx داخل حدّ أخطاء خاص بها.

import { useEffect, useState } from "react";
import { Smartphone, X } from "lucide-react";
import { ActivityLog } from "./components/ActivityLog.tsx";
import { SetupGuide, Troubleshooting } from "./components/Guides.tsx";
import { InboxList } from "./components/InboxList.tsx";
import { ReviewDialog } from "./components/ReviewDialog.tsx";
import { ServicePanel } from "./components/ServicePanel.tsx";
import { Banner } from "./components/ui.tsx";
import { s } from "./components/styles.ts";
import { attach, dismissNotice, usePhoneSync } from "./store.ts";

export default function PhoneSyncPage() {
  const st = usePhoneSync();
  const [reviewUid, setReviewUid] = useState<string | null>(null);

  useEffect(() => attach(), []);

  return (
    <div style={s.page}>
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ ...s.title, display: "flex", alignItems: "center", gap: "10px" }}>
          <Smartphone size={26} color="#2563EB" /> مزامنة الهاتف
        </h1>
        <div style={s.subtitle}>
          أنشئ الفواتير من الهاتف بدون اتصال، ثم أرسلها إلى هنا لتراجعها وتعتمدها. هذه الميزة مستقلة: لا تؤثر على بقية النظام إن توقفت.
        </div>
      </div>

      {st.notice && (
        <div style={{ position: "relative" }}>
          <Banner kind={st.notice.kind === "error" ? "error" : st.notice.kind === "ok" ? "ok" : "info"}>
            <button
              type="button"
              onClick={dismissNotice}
              aria-label="إخفاء"
              style={{ position: "absolute", left: "10px", top: "8px", background: "none", border: "none", cursor: "pointer", color: "inherit" }}
            >
              <X size={14} />
            </button>
            {st.notice.text}
          </Banner>
        </div>
      )}

      {st.statusError && !st.status && <Banner kind="error">تعذّر الاتصال بوحدة المزامنة: {st.statusError}</Banner>}

      <ServicePanel st={st} />
      <InboxList st={st} onReview={setReviewUid} />
      <SetupGuide />
      <Troubleshooting />
      <ActivityLog st={st} />

      {reviewUid && <ReviewDialog uid={reviewUid} onClose={() => setReviewUid(null)} />}
    </div>
  );
}
