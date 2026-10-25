# Installs the Supaterm CLI from a GitHub Release archive on Windows. Needs
# only PowerShell 5.1+; no Node, npm, or compiler.
#
#   irm https://supaterm.com/install.ps1 | iex
#
# Environment:
#   SUPATERM_CHANNEL           release train to follow: stable, nightly, or preview
#                            (default: stable; preview is a maintainers' test train)
#   SUPATERM_VERSION           exact version to install (overrides SUPATERM_CHANNEL)
#   SUPATERM_HOME              Supaterm home directory (default: ~\.supaterm)
#   SUPATERM_INSTALL_BIN_DIR   where supaterm.cmd is written (default: ~\.local\bin)
#   SUPATERM_RELEASE_BASE_URL  mirror for releases/download (default: GitHub)
#
# The archive is unpacked into $SUPATERM_HOME\runtime\versions\<version>, the
# same layout `supaterm service install` uses, so the service reuses this download.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = "supabitapp/supaterm"
$baseUrl = if ($env:SUPATERM_RELEASE_BASE_URL) { $env:SUPATERM_RELEASE_BASE_URL.TrimEnd("/") } else { "https://github.com/$repo/releases/download" }
$supatermHome = if ($env:SUPATERM_HOME) { $env:SUPATERM_HOME } else { Join-Path $HOME ".supaterm" }
$binDir = if ($env:SUPATERM_INSTALL_BIN_DIR) { $env:SUPATERM_INSTALL_BIN_DIR } else { Join-Path $HOME ".local\bin" }

function Fail([string] $message) {
  Write-Error "supaterm install: $message"
  exit 1
}

$terminal = -not [Console]::IsErrorRedirected -and $env:TERM -ne "dumb"
$interactive = $terminal -and $Host.UI.SupportsVirtualTerminal
if ($interactive) {
  # Legacy code pages may support ANSI escapes but not the logo or bar glyphs.
  $glyphs = -join [char[]](0x2588, 0x2580, 0x2584, 0x25A0, 0x00B7)
  $encoding = [Console]::Error.Encoding
  $interactive = $encoding.GetString($encoding.GetBytes($glyphs)) -eq $glyphs
}
$esc = [char]27
$reset = $bold = $muted = $accent = $green = ""
if ($interactive -and -not $env:NO_COLOR) {
  $reset = "$esc[0m"; $bold = "$esc[1m"; $muted = "$esc[2m"
  $accent = "$esc[94m"; $green = "$esc[32m"
}
function Step([string] $message) {
  if ($interactive) { [Console]::Error.Write("`r$esc[2K  $muted$message$reset") }
  else { [Console]::Error.WriteLine("  $message") }
}
function Draw-Download([long] $bytes, [long] $total) {
  if (-not $interactive) { return }
  $columns = [Console]::WindowWidth
  if ($columns -le 0) { $columns = 80 }
  if ($total -gt 0 -and $columns -ge 9) {
    $percent = [Math]::Min(100, [Math]::Floor($bytes * 100.0 / $total))
    $width = [Math]::Min(32, $columns - 8)
    $filled = [int][Math]::Floor($percent * $width / 100)
    $bar = ([string][char]0x25A0) * $filled
    $rest = ([string][char]0x00B7) * ($width - $filled)
    $sizes = ("  {0:F1} / {1:F1} MB" -f ($bytes / 1MB), ($total / 1MB))
    if ($width + 7 + $sizes.Length -ge $columns) { $sizes = "" }
    [Console]::Error.Write(("`r$esc[2K  $accent$bar$reset$muted$rest$reset {0,3}%" -f $percent) + "$muted$sizes$reset")
  } else {
    $line = if ($columns -ge 32) { "  Downloading  {0:F1} MB" -f ($bytes / 1MB) } else { "  {0:F1} MB" -f ($bytes / 1MB) }
    [Console]::Error.Write("`r$esc[2K" + $line.Substring(0, [Math]::Min($line.Length, $columns - 1)))
  }
}
function Fetch([string] $uri, [string] $destination, [switch] $progress) {
  if (-not $progress -or -not $interactive) {
    $ProgressPreference = if ($progress -and $terminal) { "Continue" } else { "SilentlyContinue" }
    Invoke-WebRequest -Uri $uri -OutFile $destination -UseBasicParsing
    return
  }
  Add-Type -AssemblyName System.Net.Http
  $client = New-Object System.Net.Http.HttpClient
  $response = $source = $file = $null
  try {
    $response = $client.GetAsync($uri, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    $response.EnsureSuccessStatusCode() | Out-Null
    $source = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $file = [IO.File]::Create($destination)
    $buffer = New-Object byte[] 65536
    $bytes = 0L
    $clock = [Diagnostics.Stopwatch]::StartNew()
    Draw-Download 0 $response.Content.Headers.ContentLength
    while (($count = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $file.Write($buffer, 0, $count)
      $bytes += $count
      if ($clock.ElapsedMilliseconds -ge 100) {
        Draw-Download $bytes $response.Content.Headers.ContentLength
        $clock.Restart()
      }
    }
    Draw-Download $bytes $bytes
    [Console]::Error.WriteLine()
  } finally {
    if ($file) { $file.Dispose() }
    if ($source) { $source.Dispose() }
    if ($response) { $response.Dispose() }
    $client.Dispose()
  }
}
if ($interactive) {
  [Console]::Error.WriteLine("`n  ${bold}Supaterm$reset`n  ${muted}CLI installer$reset`n")
}
Step "Finding your release..."

# PROCESSOR_ARCHITEW6432 bypasses WOW64 emulation; 5.1 hosts can lack RuntimeInformation's required .NET version.
$rawArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($rawArch) {
  "AMD64" { "x64" }
  "ARM64" { "arm64" }
  default { Fail "unsupported architecture $rawArch" }
}

$channel = if ($env:SUPATERM_CHANNEL) { $env:SUPATERM_CHANNEL } else { "stable" }
$version = $env:SUPATERM_VERSION
if (-not $version) {
  $tagPattern = switch ($channel) {
    "stable" { '^v\d+\.\d+\.\d+$' }
    "nightly" { '^v\d+\.\d+\.\d+-nightly\.\d+\.\d+$' }
    "preview" { '^v\d+\.\d+\.\d+-preview\.\d+\.\d+$' }
    default { Fail "SUPATERM_CHANNEL must be stable, nightly, or preview" }
  }
  $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases?per_page=100" -Headers @{ "User-Agent" = "supaterm-install" }
  $tag = ($releases | Where-Object { -not $_.draft -and $_.tag_name -match $tagPattern } | Select-Object -First 1).tag_name
  if (-not $tag) { Fail "could not find a $channel release; set SUPATERM_VERSION" }
  $version = $tag.Substring(1)
}
if ($version -match '-preview\.') {
  Write-Warning "Supaterm $version is a preview build. Preview builds are cut by maintainers from unreleased branches to exercise the release pipeline. They can be broken, receive no fixes, and are never offered as updates. Set SUPATERM_CHANNEL=stable (the default) for a supported build."
  if ($channel -ne "preview" -and -not $env:SUPATERM_VERSION) {
    Fail "refusing a preview build that was not explicitly requested"
  }
}

$stem = "supaterm-$version-win32-$arch"
$archive = "$stem.zip"
$versionsDir = Join-Path $supatermHome "runtime\versions"
$targetDir = Join-Path $versionsDir $version
$marker = Join-Path $targetDir ".install-complete"

if ((Test-Path $marker) -and ((Get-Content $marker -Raw).Trim() -eq $version)) {
  Step "Version $version is already downloaded."
} else {
  New-Item -ItemType Directory -Force -Path $versionsDir | Out-Null
  $staging = Join-Path $versionsDir (".staging-" + [System.IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Path $staging | Out-Null
  try {
    if ($interactive) { [Console]::Error.Write("`r$esc[2K") }
    [Console]::Error.WriteLine("  ${muted}Installing$reset Supaterm $bold$version$reset`n")
    Step "Downloading..."
    try {
      Fetch "$baseUrl/v$version/SHA256SUMS" (Join-Path $staging "SHA256SUMS")
    } catch {
      $status = $_.Exception.Response.StatusCode.value__
      if ($status -eq 404) {
        Fail "Supaterm $version has no release archive for win32-$arch"
      }
      throw
    }
    Fetch "$baseUrl/v$version/$archive" (Join-Path $staging $archive) -progress

    Step "Verifying the download..."

    $expected = (Get-Content (Join-Path $staging "SHA256SUMS") | Where-Object { $_ -match "\s\*?$([regex]::Escape($archive))$" } | Select-Object -First 1)
    if (-not $expected) { Fail "$archive is not listed in SHA256SUMS" }
    $expected = ($expected -split "\s+")[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $staging $archive)).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { Fail "checksum mismatch for $archive" }

    Step "Extracting Supaterm..."
    # The archive module reads the global preference, not the caller's local scope.
    $savedProgress = $global:ProgressPreference
    try {
      $global:ProgressPreference = "SilentlyContinue"
      Expand-Archive -Path (Join-Path $staging $archive) -DestinationPath $staging -Force
    } finally { $global:ProgressPreference = $savedProgress }
    Get-ChildItem (Join-Path $staging $stem) | Move-Item -Destination $staging
    Remove-Item (Join-Path $staging $stem), (Join-Path $staging $archive), (Join-Path $staging "SHA256SUMS") -Recurse -Force

    & (Join-Path $staging "supaterm.exe") --version | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "the downloaded executable does not run" }
    Set-Content -Path (Join-Path $staging ".install-complete") -Value $version -NoNewline

    if (Test-Path $targetDir) { Remove-Item $targetDir -Recurse -Force }
    Move-Item $staging $targetDir
  } catch {
    if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
    throw
  }
}

Step "Setting up the supaterm command..."
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$shim = Join-Path $binDir "supaterm.cmd"
# UTF-8 without a BOM: cmd.exe reads the shim as-is, and ASCII would corrupt
# non-ASCII characters in the user's home path.
[System.IO.File]::WriteAllText($shim, "@echo off`r`n`"$(Join-Path $targetDir 'supaterm.exe')`" %*", (New-Object System.Text.UTF8Encoding $false))
# Pruning keeps what this shim points at; a background service cannot see $binDir otherwise.
$launchers = Join-Path $supatermHome "runtime\launchers"
$shimPath = (Resolve-Path $shim).Path
if (-not ((Test-Path $launchers) -and ((Get-Content $launchers) -contains $shimPath))) {
  [System.IO.File]::AppendAllText($launchers, "$shimPath`r`n", (New-Object System.Text.UTF8Encoding $false))
}
if ($interactive) { [Console]::Error.Write("`r$esc[2K") }
[Console]::Error.WriteLine("  ${green}Installed Supaterm $version$reset`n")
if (($env:PATH -split ";") -notcontains $binDir) {
  Write-Host "  Add $binDir to your PATH, then run ${bold}supaterm$reset.`n"
} else {
  Write-Host "  Run ${bold}supaterm$reset to get started.`n"
}
