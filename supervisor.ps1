# Supervisor ExitGuard — mantiene server + túnel vivos, reinicia si caen,
# captura la URL pública y la deja en url.txt. Arranca solo con la PC.
$dir = "C:\Users\Admin\agent-service"
$cf  = "C:\Program Files (x86)\cloudflared\cloudflared"
Set-Location $dir
function Alive($port){ (Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue).TcpTestSucceeded }
while ($true) {
  # 1. server node en :8402
  if (-not (Alive 8402)) {
    Get-Process node -ErrorAction SilentlyContinue | Where-Object {$_.Path -like "*node*"} | Out-Null
    Start-Process node -ArgumentList "server.js" -WorkingDirectory $dir -RedirectStandardOutput "$dir\server.out.log" -RedirectStandardError "$dir\server.err.log" -WindowStyle Hidden
    Start-Sleep 5
  }
  # 2. túnel cloudflared
  if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
    Start-Process $cf -ArgumentList "tunnel","--url","http://localhost:8402" -RedirectStandardOutput "$dir\tunnel.out.log" -RedirectStandardError "$dir\tunnel.err.log" -WindowStyle Hidden
    Start-Sleep 12
    # capturar URL publica
    $u = Select-String -Path "$dir\tunnel.err.log","$dir\tunnel.out.log" -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -Last 1
    if ($u) { ($u.Matches.Value) | Out-File "$dir\url.txt" -Encoding ascii }
  }
  Start-Sleep 30
}
