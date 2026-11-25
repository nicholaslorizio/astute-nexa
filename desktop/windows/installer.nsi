; Astute Nexa for Windows: a normal Next, Install, Finish setup.
; Installs for the current user, so it needs no admin rights. Build with: makensis -DSRC=<staged folder> -DOUT=<setup.exe> installer.nsi
Unicode true
!include "MUI2.nsh"
!define APP "Astute Nexa"
!define VERSION "0.1.0"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\AstuteNexa"

Name "${APP}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "Software\AstuteNexa" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${APP} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} Setup"
VIAddVersionKey "CompanyName" "Astute"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Free software under AGPL-3.0"

!define MUI_ICON "${SRC}\nexa.ico"
!define MUI_UNICON "${SRC}\nexa.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${APP}"
!define MUI_WELCOMEPAGE_TEXT "Docs, sheets, slides, chat and calls, mail, calendar and files in one free app.$\r$\n$\r$\nEverything you need is included. Click Next to continue."
!define MUI_FINISHPAGE_TITLE "${APP} is ready"
!define MUI_FINISHPAGE_TEXT "Find ${APP} on your desktop and in the Start menu."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APP} now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${SRC}\app\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  ; Close a running copy so its files can be replaced.
  nsExec::Exec 'taskkill /F /IM "${APP}.exe"'
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\app"
  File "${SRC}\${APP}.exe"
  File "${SRC}\nexa.ico"
  File /r "${SRC}\app"
  WriteUninstaller "$INSTDIR\Uninstall ${APP}.exe"
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${APP}.exe" "" "$INSTDIR\nexa.ico"
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\${APP}.exe" "" "$INSTDIR\nexa.ico"
  CreateShortcut "$SMPROGRAMS\${APP}\Uninstall ${APP}.lnk" "$INSTDIR\Uninstall ${APP}.exe"
  WriteRegStr HKCU "Software\AstuteNexa" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "Astute"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\nexa.ico"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\Uninstall ${APP}.exe"'
  WriteRegStr HKCU "${UNINST}" "URLInfoAbout" "https://github.com/nicholaslorizio/astute-nexa"
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${APP}.exe"'
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\${APP}.exe"
  Delete "$INSTDIR\nexa.ico"
  Delete "$INSTDIR\Uninstall ${APP}.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINST}"
  DeleteRegKey HKCU "Software\AstuteNexa"
  ; Your documents and settings stay in %LOCALAPPDATA%\Astute Nexa\data so nothing is lost.
SectionEnd
