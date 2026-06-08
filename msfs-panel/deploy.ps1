# Assembles the final MSFS 2020 Community package from the DevMode build output + html_ui.
# Run AFTER clicking "Build All" in the in-sim Project Editor.
#   powershell -ExecutionPolicy Bypass -File deploy.ps1
$ErrorActionPreference = "Stop"
$src = "D:\MSFS2020 AI\msfs-panel"
$dst = "D:\Microsoft Flight Simulator\Community\ai-atc-ingamepanel"
$spb = "$src\Build\Packages\atc-panel\Build\atc-panel.spb"
$gen = "C:\Users\bansa\Downloads\MSFSLayoutGenerator.exe"

if (-not (Test-Path $spb)) { throw "No .spb at $spb - run Build All in DevMode first." }

# Regenerate the panel HTML from the desktop widget so the panel mirrors the latest UI.
if (Get-Command node -ErrorAction SilentlyContinue) { node "$src\build-panel.mjs" | Out-Null }

# Fresh target
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
New-Item -ItemType Directory -Force -Path "$dst\InGamePanels" | Out-Null

# 1) compiled toolbar-button .spb (named to match the panel def's <Filename>)
Copy-Item $spb "$dst\InGamePanels\ai-atc-ingamepanel.spb" -Force
# 2) panel UI + toolbar icon
Copy-Item "$src\html_ui" "$dst\html_ui" -Recurse -Force
# 3) manifest (SPB content type, 2020-compatible min game version)
@'
{
  "dependencies": [],
  "content_type": "SPB",
  "title": "AI ATC In-Game Panel",
  "manufacturer": "MSFS AI ATC",
  "creator": "MSFS AI ATC",
  "package_version": "0.2.5",
  "minimum_game_version": "1.8.3",
  "release_notes": { "neutral": { "LastUpdate": "", "OlderHistory": "" } }
}
'@ | Out-File -FilePath "$dst\manifest.json" -Encoding ascii

# 4) layout.json indexing every file
'{ "content": [] }' | Out-File -FilePath "$dst\layout.json" -Encoding ascii
& $gen "$dst\layout.json" | Out-Null

Write-Output "Deployed to: $dst"
Get-ChildItem -Recurse $dst -File | ForEach-Object { "  " + $_.FullName.Replace($dst,"") }
Write-Output "Now reload the package in MSFS (DevMode menu) or restart the sim."
