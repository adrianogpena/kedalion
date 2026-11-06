# Kedalion shell integration for PowerShell and pwsh, run after the user's profile.
# Wraps the existing prompt with OSC 133 marks and OSC 7; PSReadLine's ReadLine gets the C mark.
if (-not $global:__dbSi) {
  $global:__dbSi = $true
  $global:__dbFirst = $true
  $global:__dbUserPrompt = $function:prompt
  $global:__dbEc = 0
  # terminal.prompt = kedalion: the segments of terminal.promptStyle.
  if ($env:KEDALION_PROMPT) {
    $global:__dbUserPrompt = {
      $e = [char]27
      $loc = $executionContext.SessionState.Path.CurrentLocation
      $path = "$loc"
      $folder = Split-Path -Leaf $path
      $branch = ''
      $spec = " $env:KEDALION_PROMPT "
      if ($loc.Provider.Name -eq 'FileSystem') {
        $path = $loc.ProviderPath
        $folder = [IO.Path]::GetFileName($path.TrimEnd('\', '/'))
        if (-not $folder) { $folder = $path }
        if ($HOME -and $path.StartsWith($HOME, [StringComparison]::OrdinalIgnoreCase)) { $path = '~' + $path.Substring($HOME.Length) }
        $d = if ($spec.Contains(' branch:') -or $spec.Contains(' gitstatus:')) { $loc.ProviderPath } else { $null }
        while ($d) {
          $g = Join-Path $d '.git'
          if ([IO.File]::Exists($g)) {
            $g = ([IO.File]::ReadAllText($g).Trim()) -replace '^gitdir: ', ''
            if (-not [IO.Path]::IsPathRooted($g)) { $g = Join-Path $d $g }
          }
          $head = Join-Path $g 'HEAD'
          if ([IO.File]::Exists($head)) {
            $h = [IO.File]::ReadAllText($head).Trim()
            $branch = if ($h.StartsWith('ref: refs/heads/')) { $h.Substring(16) } else { $h.Substring(0, [Math]::Min(7, $h.Length)) }
            break
          }
          $d = [IO.Path]::GetDirectoryName($d)
        }
      }
      $ec = $global:__dbEc
      $sym = if ($env:KEDALION_PROMPT_SYMBOL) { $env:KEDALION_PROMPT_SYMBOL } else { '$' }
      $out = ''
      $sep = ''
      # KEDALION_PROMPT: `kind:sgr` tokens (symbol:sgr:errorSgr, newline), see packages/terminal/src/prompt.ts.
      foreach ($t in $env:KEDALION_PROMPT.Split(' ')) {
        $parts = $t.Split(':')
        $sgr = if ($parts.Count -gt 1 -and $parts[1] -match '^[0-9;]+$') { $parts[1] } else { '0' }
        $p = switch ($parts[0]) {
          'newline' { "`n"; break }
          'cwd' { $path; break }
          'folder' { $folder; break }
          'user' { [Environment]::UserName; break }
          'host' { [Environment]::MachineName; break }
          'time' { (Get-Date).ToString('HH:mm'); break }
          'branch' { $branch; break }
          'gitstatus' {
            if ($branch -and $loc.Provider.Name -eq 'FileSystem' -and (Get-Command git -ErrorAction SilentlyContinue)) {
              $dirty = $false; $ahead = 0; $behind = 0
              foreach ($l in (& git -C $loc.ProviderPath status --porcelain=v2 --branch 2>$null)) {
                if ($l -match '^# branch\.ab \+(\d+) -(\d+)') { $ahead = [int]$Matches[1]; $behind = [int]$Matches[2] }
                elseif (-not "$l".StartsWith('#')) { $dirty = $true }
              }
              $gs = @()
              if ($dirty) { $gs += '*' }
              if ($ahead) { $gs += "$([char]0x2191)$ahead" }
              if ($behind) { $gs += "$([char]0x2193)$behind" }
              $gs -join ' '
            } else { '' }
            break
          }
          'os' { if ($IsMacOS) { 'macOS' } elseif ($IsLinux) { 'Linux' } else { 'Windows' }; break }
          'shell' { if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh' } else { 'powershell' }; break }
          'date' { (Get-Date).ToString('yyyy-MM-dd'); break }
          'duration' {
            $h = Get-History -Count 1 -ErrorAction SilentlyContinue
            if ($h -and $h.Id -ne $global:__dbHid) {
              $global:__dbHid = $h.Id
              $n = [int][Math]::Floor(($h.EndExecutionTime - $h.StartExecutionTime).TotalSeconds)
              if ($n -ge 60) { "$([Math]::Floor($n / 60))m$($n % 60)s" } elseif ($n -ge 2) { "${n}s" } else { '' }
            } else { '' }
            break
          }
          'jobs' { $n = @(Get-Job -State Running -ErrorAction SilentlyContinue).Count; if ($n) { "$n" } else { '' }; break }
          'venv' {
            $v = if ($env:VIRTUAL_ENV) { $env:VIRTUAL_ENV } else { $env:CONDA_DEFAULT_ENV }
            if ($v) { [IO.Path]::GetFileName($v.TrimEnd('\', '/')) } else { '' }
            break
          }
          'node' {
            if ($loc.Provider.Name -eq 'FileSystem' -and [IO.File]::Exists((Join-Path $loc.ProviderPath 'package.json')) -and (Get-Command node -ErrorAction SilentlyContinue)) {
              $v = "$(& node --version 2>$null)".Trim()
              if ($v) { 'node ' + $v.TrimStart('v') } else { '' }
            } else { '' }
            break
          }
          'java' { if ($env:JAVA_HOME) { [IO.Path]::GetFileName($env:JAVA_HOME.TrimEnd('\', '/')) } else { '' }; break }
          'status' { if ($ec) { "$ec" } else { '' }; break }
          'symbol' {
            if ($ec -and $parts.Count -gt 2 -and $parts[2] -match '^[0-9;]+$') { $sgr = $parts[2] }
            $sym; break
          }
          default { ''; break }
        }
        if ($parts[0] -eq 'newline') { $out += "`n"; $sep = ''; continue }
        if (-not $p) { continue }
        $out += "$sep$e[${sgr}m$p$e[0m"
        $sep = ' '
      }
      "$out "
    }
  }
  function global:prompt {
    $ok = $?
    $code = $global:LASTEXITCODE
    $global:__dbEc = if ($ok) { 0 } elseif ($code -is [int] -and $code -ne 0) { $code } else { 1 }
    $e = [char]27
    $a = [char]7
    $out = ''
    if (-not $global:__dbFirst) {
      $ec = if ($ok) { 0 } elseif ($code -is [int] -and $code -ne 0) { $code } else { 1 }
      $out += "$e]133;D;$ec$a"
    }
    $global:__dbFirst = $false
    $loc = $executionContext.SessionState.Path.CurrentLocation
    if ($loc.Provider.Name -eq 'FileSystem') {
      $p = $loc.ProviderPath.Replace([char]92, [char]47)
      if ($p -match '^[A-Za-z]:') { $p = '/' + $p }
      if ($p -match '^/[^/]') {
        $hostName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'localhost' }
        $out += "$e]7;file://$hostName$($p.Replace('%', '%25'))$a"
      }
    }
    $out += "$e]133;A$a"
    $inner = if ($global:__dbUserPrompt) { & $global:__dbUserPrompt } else { "PS $loc$('>' * ($nestedPromptLevel + 1)) " }
    $global:LASTEXITCODE = $code
    "$out$inner$e]133;B$a"
  }
  if (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue) {
    $global:__dbUserReadLine = $function:PSConsoleHostReadLine
    function global:PSConsoleHostReadLine {
      $line = & $global:__dbUserReadLine
      $e = [char]27
      $a = [char]7
      # The command line (OSC 633 E, VS Code's escaping) for the command history.
      if ("$line".Trim()) {
        $esc = "$line" -replace '\\', '\\' -replace ';', '\x3b'
        $esc = [regex]::Replace($esc, '[\x00-\x1f]', { param($m) '\x{0:x2}' -f [int][char]$m.Value })
        [Console]::Write("$e]633;E;$esc$a")
      }
      [Console]::Write("$e]133;C$a")
      $line
    }
  }
}
