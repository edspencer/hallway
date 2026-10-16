# Runs scripts/scanner-real-win.mjs as a new standard (non-administrator) local user, through a one-off scheduled task,
# and fails unless that user's scanner found its own listener with its working directory (D59). CI only: it creates a
# user. Run from a checkout after `npm run build`.
$ErrorActionPreference = 'Stop'
$user = 'hwscan'
$pass = 'Hw-' + [guid]::NewGuid().ToString('N').Substring(0, 16) + '!a1'
$root = 'C:\hwscan'
New-Item -ItemType Directory -Force -Path "$root\work" | Out-Null
Copy-Item -Recurse -Force dist "$root\dist"
Copy-Item -Force scripts\scanner-real-win.mjs "$root\scan.mjs"
# New-LocalUser, not `net user`: that one stops to ask about passwords over 14 characters
New-LocalUser -Name $user -Password (ConvertTo-SecureString $pass -AsPlainText -Force) -AccountNeverExpires -PasswordNeverExpires | Out-Null
Write-Host "groups of ${user}: $((Get-LocalGroup | Where-Object { (Get-LocalGroupMember $_ -ErrorAction SilentlyContinue).Name -match "\\$user$" }).Name -join ', ')"
# only Users: not an administrator
icacls $root /grant "${user}:(OI)(CI)M" | Out-Null
$node = (Get-Command node).Source
$cmd = "cmd.exe /c set HW_WORK=$root\work&& `"$node`" $root\scan.mjs $root\dist > $root\out.txt 2>&1"
schtasks /Create /TN hwscan /RU $user /RP $pass /SC ONCE /ST 23:59 /TR $cmd /F
if ($LASTEXITCODE) { throw "schtasks /Create failed ($LASTEXITCODE)" }
schtasks /Run /TN hwscan
if ($LASTEXITCODE) { throw "schtasks /Run failed ($LASTEXITCODE)" }
$deadline = (Get-Date).AddSeconds(90)
do {
  Start-Sleep -Seconds 2
  $state = (Get-ScheduledTask -TaskName hwscan).State
} while ($state -eq 'Running' -and (Get-Date) -lt $deadline)
$info = Get-ScheduledTaskInfo -TaskName hwscan
Write-Host "task state: $state, last result: $($info.LastTaskResult)"
$out = if (Test-Path "$root\out.txt") { Get-Content -Raw "$root\out.txt" } else { '(no output)' }
Write-Host $out
schtasks /Delete /TN hwscan /F | Out-Null
Remove-LocalUser -Name $user
$v = $out | Select-String -Pattern '^\{.*\}\s*$' | Select-Object -Last 1
if (-not $v) { throw 'no verdict from the standard user' }
$j = $v.Line | ConvertFrom-Json
if ($j.user -ne $user) { throw "it ran as $($j.user), not $user" }
if (-not $j.ok) { throw 'the scanner, as a standard user, did not find its listener with its working directory' }
Write-Host "ok: as $($j.user), listener on $($j.port) found with cwd $($j.info.cwd)"
