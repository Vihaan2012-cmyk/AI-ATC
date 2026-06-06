; Custom NSIS hooks for the Air Traffic Control installer.
; electron-builder auto-includes app/build/installer.nsh and calls these macros.
;
; The default uninstaller removes the installed program files but leaves behind:
;   - user data in %APPDATA%\Air Traffic Control (settings, logbook, downloaded Piper voices — can be GB)
;   - the AI model pulled into Ollama (qwen2.5:14b is ~9 GB)
; On uninstall we offer to remove each of those. Ollama itself is NOT touched — the user installed it
; separately, and other apps may use it.

!macro customUnInstall
  ; --- 1) App user data (settings / logbook / Piper voices) ---
  StrCpy $0 "$APPDATA\${PRODUCT_NAME}"
  IfFileExists "$0\*.*" 0 customUnInstall_model

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Also delete your Air Traffic Control settings, logbook, and downloaded Piper voices?$\n$\n\
This frees disk space but erases your saved preferences and voice files.$\n\
(Choose No to keep them for a future reinstall.)" \
    /SD IDNO IDYES customUnInstall_purgeData IDNO customUnInstall_model

  customUnInstall_purgeData:
    RMDir /r "$0"

  ; --- 2) The AI model in Ollama (~9 GB) ---
  customUnInstall_model:
    ; Only offer this if Ollama is installed (per-user install location).
    StrCpy $1 "$LOCALAPPDATA\Programs\Ollama\ollama.exe"
    IfFileExists "$1" 0 customUnInstall_done

    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Also remove the AI model (qwen2.5:14b, about 9 GB) from Ollama?$\n$\n\
Ollama itself stays installed; only this model is removed.$\n\
(Choose No if other apps use it or you may reinstall.)" \
      /SD IDNO IDYES customUnInstall_purgeModel IDNO customUnInstall_done

    customUnInstall_purgeModel:
      ; ollama rm is the safe way to delete a model (its store is content-addressed).
      nsExec::Exec '"$1" rm qwen2.5:14b'
      ; Also remove the custom fine-tuned model if the user created one.
      nsExec::Exec '"$1" rm atc-nlu'

  customUnInstall_done:
!macroend
