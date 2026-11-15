!macro customInstall
  # إضافة استثناء لجدار الحماية يسمح بتبادل البيانات عبر الشبكة المحلية عند التثبيت
  ExecWait 'netsh advfirewall firewall add rule name="MKS App" dir=in action=allow program="$INSTDIR\MKS.exe" enable=yes'
!macroend

!macro customUninstall
  # حذف استثناء جدار الحماية تلقائياً عند إزالة تثبيت البرنامج
  ExecWait 'netsh advfirewall firewall delete rule name="MKS App"'
!macroend