# =============================================================================
#  NEXUS SWITCH  //  AI Model Router  //  HexaNexus28
#  Navigation clavier : fleches haut/bas + Entree + chiffres + Q
# =============================================================================

$NexusDir     = if ($env:NEXUS_SWITCH_HOME) { $env:NEXUS_SWITCH_HOME } else { Split-Path -Parent $PSScriptRoot }
$ClaudeDir    = "$HOME\.claude"
$ProvidersDir = "$NexusDir\providers"
$LiteLLMConfig = "$NexusDir\litellm\litellm-config.yaml"
$LocalConfig  = "$ClaudeDir\settings.local.json"
$ProxyOutLog  = "$env:TEMP\nexus-litellm-out.log"
$ProxyErrLog  = "$env:TEMP\nexus-litellm-err.log"

# ── ANSI (calcules au runtime, jamais dans les bytes du fichier) ──────────────
$e  = [char]27
$R  = "$e[0m"          # reset
$B  = "$e[1m"          # bold
$DM = "$e[2m"          # dim
$IT = "$e[3m"          # italic
$CY = "$e[96m"         # bright cyan
$GR = "$e[92m"         # bright green
$YL = "$e[93m"         # yellow
$RD = "$e[91m"         # red
$WH = "$e[97m"         # white
$MG = "$e[95m"         # magenta
$DG = "$e[90m"         # dark gray
$BG_SEL   = "$e[48;2;0;45;65m"   # fond selection (teal fonce)
$BG_HDR   = "$e[48;2;0;20;35m"   # fond header
$FG_LABEL = "$e[38;2;150;230;255m"  # label couleur
$FG_FREE  = "$e[38;2;80;220;120m"   # gratuit vert doux
$FG_PAID  = "$e[38;2;100;100;110m"  # payant gris

# ── Box drawing (codes Unicode, independants de l'encodage du fichier) ────────
$DTL = [string][char]0x2554   # (double coin haut-gauche)
$DTR = [string][char]0x2557   # (double coin haut-droit)
$DBL = [string][char]0x255A   # (double coin bas-gauche)
$DBR = [string][char]0x255D   # (double coin bas-droit)
$DH  = [string][char]0x2550   # (double horizontal)
$DV  = [string][char]0x2551   # (double vertical)
$TL  = [string][char]0x250C   # (coin haut-gauche)
$TR  = [string][char]0x2510   # (coin haut-droit)
$BLC = [string][char]0x2514   # (coin bas-gauche)
$BRC = [string][char]0x2518   # (coin bas-droit)
$H   = [string][char]0x2500   # (horizontal)
$V   = [string][char]0x2502   # (vertical)
$LT  = [string][char]0x251C   # (tee gauche)
$RT  = [string][char]0x2524   # (tee droit)
$FUL = [string][char]0x2588   # (bloc plein)
$MBL = [string][char]0x2593   # (bloc moyen)
$EMP = [string][char]0x2591   # (bloc vide)
$ARR = [string][char]0x25B6   # (triangle droit)
$DOT = [string][char]0x2022   # (puce)
$SPC = [string][char]0x00B7   # (point median)
$RTL = [string][char]0x256D   # (coin arrondi haut-gauche)
$RTR = [string][char]0x256E   # (coin arrondi haut-droit)
$RBL = [string][char]0x2570   # (coin arrondi bas-gauche)
$RBR = [string][char]0x256F   # (coin arrondi bas-droit)
$NODE= [string][char]0x25CF   # (noeud plein)
$CRS = [string][char]0x253C   # (croisement de lignes)

# =============================================================================
#  Helpers provider
# =============================================================================

function _p_load([string]$n) {
    $f = "$ProvidersDir\$n.json"
    if (-not (Test-Path $f)) { return $null }
    return Get-Content $f -Raw | ConvertFrom-Json
}

function _p_list {
    if (-not (Test-Path $ProvidersDir)) { return @() }
    return Get-ChildItem $ProvidersDir -Filter *.json | ForEach-Object { $_.BaseName }
}

function _env_get([string]$name) {
    $v = [Environment]::GetEnvironmentVariable($name, "Process")
    if ($v) { return $v }
    return [Environment]::GetEnvironmentVariable($name, "User")
}

function _env_resolve($value) {
    if ($null -eq $value) { return "" }
    $s = [string]$value
    return [regex]::Replace($s, '\$\{([^}]+)\}', { param($m) $resolved = _env_get $m.Groups[1].Value; if ($resolved) { $resolved } else { "" } })
}

function _provider_env_map {
    return @{
        openrouter = "OPENROUTER_API_KEY"
        groq       = "GROQ_API_KEY"
        gemini     = "GEMINI_API_KEY"
        cerebras   = "CEREBRAS_API_KEY"
        mistral    = "MISTRAL_API_KEY"
        nvidia     = "NVIDIA_NIM_API_KEY"
        cloudflare = "CLOUDFLARE_API_TOKEN"
    }
}

function _sync_litellm_env {
    foreach ($var in @("GROQ_API_KEY","GEMINI_API_KEY","CEREBRAS_API_KEY","MISTRAL_API_KEY","NVIDIA_NIM_API_KEY","CLOUDFLARE_API_TOKEN")) {
        $value = _env_get $var
        if ($value) { [Environment]::SetEnvironmentVariable($var, $value, "Process") }
    }
}

function _litellm_has_any_key {
    foreach ($var in @("GROQ_API_KEY","GEMINI_API_KEY","CEREBRAS_API_KEY","MISTRAL_API_KEY","NVIDIA_NIM_API_KEY","CLOUDFLARE_API_TOKEN")) {
        if (_env_get $var) { return $true }
    }
    return $false
}

function _ensure_proxy_key {
    # Master key du gateway LiteLLM. Generee une seule fois (User scope), partagee
    # par tous les terminaux. La config YAML la lit via os.environ/NEXUS_PROXY_KEY et
    # les providers via ${NEXUS_PROXY_KEY} -> jamais de cle en clair dans le repo.
    $k = _env_get "NEXUS_PROXY_KEY"
    if (-not $k) {
        $k = "sk-nexus-" + [guid]::NewGuid().ToString("N")
        [Environment]::SetEnvironmentVariable("NEXUS_PROXY_KEY", $k, "User")
    }
    # Process scope : Start-Process herite de l'env -> litellm enfant voit la cle.
    [Environment]::SetEnvironmentVariable("NEXUS_PROXY_KEY", $k, "Process")
    return $k
}

function _p_apply($prov, [string]$model = "") {
    # Option A : env vars Process-level UNIQUEMENT -> isolation totale par terminal.
    # Chaque terminal peut donc faire tourner un provider different en parallele.
    $prov.env.PSObject.Properties | ForEach-Object {
        $resolved = _env_resolve $_.Value
        if ($resolved) {
            [System.Environment]::SetEnvironmentVariable($_.Name, $resolved, "Process")
        } else {
            [System.Environment]::SetEnvironmentVariable($_.Name, $null, "Process")
        }
    }
    if ($model) {
        foreach ($k in @("ANTHROPIC_MODEL","ANTHROPIC_DEFAULT_OPUS_MODEL","ANTHROPIC_DEFAULT_SONNET_MODEL","ANTHROPIC_DEFAULT_HAIKU_MODEL","CLAUDE_CODE_SUBAGENT_MODEL")) {
            [System.Environment]::SetEnvironmentVariable($k, $model, "Process")
        }
    }

    # PAS d'ecriture de settings.local.json : ce fichier est GLOBAL et provoquait
    # la contamination croisee entre terminaux (le dernier nexus ecrasait les autres).
    # On le supprime s'il subsiste pour qu'un ancien provider n'override pas ce terminal.
    if (Test-Path $LocalConfig) { Remove-Item $LocalConfig -Force -ErrorAction SilentlyContinue }
}

function _p_reset_env {
    # Nettoyer les overrides avant de lancer Ollama ou Anthropic natif
    foreach ($k in @("ANTHROPIC_BASE_URL","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_API_KEY","ANTHROPIC_MODEL","ANTHROPIC_DEFAULT_OPUS_MODEL","ANTHROPIC_DEFAULT_SONNET_MODEL","ANTHROPIC_DEFAULT_HAIKU_MODEL","CLAUDE_CODE_SUBAGENT_MODEL")) {
        [System.Environment]::SetEnvironmentVariable($k, $null, "Process")
    }
}

function _proxy_running {
    # Test rapide TCP du port 4000 (proxy LiteLLM) sans le bruit de Test-NetConnection
    try {
        $c = [System.Net.Sockets.TcpClient]::new()
        $iar = $c.BeginConnect("127.0.0.1", 4000, $null, $null)
        $ok  = $iar.AsyncWaitHandle.WaitOne(500)
        if ($ok -and $c.Connected) { $c.EndConnect($iar); $c.Close(); return $true }
        $c.Close(); return $false
    } catch { return $false }
}

function _litellm_exe {
    # Resout litellm.exe : le dossier Scripts Python user n'est souvent PAS dans le PATH
    $cmd = Get-Command litellm -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $base = (python -m site --user-base 2>$null)
    if ($base) {
        $exe = Join-Path $base "Scripts\litellm.exe"
        if (Test-Path $exe) { return $exe }
    }
    $cand = Get-ChildItem "$env:APPDATA\Python\*\Scripts\litellm.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cand) { return $cand.FullName }
    return $null
}

function _ok_bad([bool]$ok) {
    if ($ok) { return "${GR}OK$R" }
    return "${RD}KO$R"
}

function _active_status_line {
    $base = [Environment]::GetEnvironmentVariable("ANTHROPIC_BASE_URL", "Process")
    $model = [Environment]::GetEnvironmentVariable("ANTHROPIC_MODEL", "Process")
    if (-not $base) { return "${DG}Actif : natif/Ollama dans ce terminal$R" }
    $name = switch -Wildcard ($base) {
        "*openrouter*" { "OpenRouter" }
        "*localhost*"  { "LiteLLM Gateway" }
        "*127.0.0.1*"  { "LiteLLM Gateway" }
        default        { $base }
    }
    return "${DG}Actif :$R ${CY}$name$R ${DG}//$R ${WH}$model$R"
}

function _provider_badge([string]$pName, $p) {
    $free = ($p.models | Where-Object { $_.free }).Count
    if ($p.type -eq "litellm") {
        if (_proxy_running) { return "${GR}gateway actif$R" }
        return "${YL}gateway auto$R"
    }
    if ($pName -eq "openrouter") {
        return "${GR}$free gratuits$R"
    }
    if ($pName -eq "ollama") { return "${GR}cloud + local$R" }
    if ($free -gt 0) { return "${GR}$free gratuits$R" }
    return "${FG_PAID}abonnement$R"
}

# =============================================================================
#  UI helpers
# =============================================================================

function _ui_line([int]$w = 68) { return ($DH * $w) }

function _ui_clear { [Console]::Clear() }

function _ui_w {
    # Largeur de contenu responsive, bornee pour rester lisible
    $cw = try { [Console]::WindowWidth } catch { 80 }
    if ($cw -lt 1) { $cw = 80 }
    return [math]::Max(46, [math]::Min(78, $cw - 4))
}

function _ui_header {
    # Logo : deux rectangles entrelaces (coins arrondis) qui se croisent sur
    # NEXUS / SWITCH, avec des noeuds en diagonale. Centre, fallback si etroit.
    $cw = try { [Console]::WindowWidth } catch { 80 }
    if ($cw -lt 1) { $cw = 80 }

    if ($cw -lt 46) {
        Write-Host ""
        Write-Host "  $B$CY N E X U S  S W I T C H $R  $DG$SPC HexaNexus$R"
        Write-Host ""
        return
    }

    $ind = " " * [math]::Max(2, [int](($cw - 34) / 2))
    $h20 = $H * 20; $h16 = $H * 16; $h3 = $H * 3

    Write-Host ""
    Write-Host "$ind$(' ' * 10)$CY$RTL$h20$RTR$R"
    Write-Host "$ind$(' ' * 10)$CY$V$R$B$WH   N E X U S        $R$CY$LT$H$R$GR$NODE$R"
    Write-Host "$ind$(' ' * 6)$CY$RTL$h3$R$MG$CRS$R$CY$h16$RTR   $LT$H$R$GR$NODE$R"
    Write-Host "$ind$(' ' * 4)$GR$NODE$R$CY$H$RT   $RBL$h16$R$MG$CRS$R$CY$h3$RBR$R"
    Write-Host "$ind$(' ' * 4)$GR$NODE$R$CY$H$RT$R$B$WH    S W I T C H     $R$CY$V$R"
    Write-Host "$ind$(' ' * 6)$CY$RBL$h20$RBR$R"
    Write-Host "$ind$(' ' * 6)$CY${B}HexaNexus$R$DG  $SPC  AI Model Router$R"
    Write-Host ""
}

function _ui_section([string]$title) {
    $dash = $H * 3
    Write-Host "  $CY$dash$R  $B$WH$title$R  $CY$dash$R"
    Write-Host ""
}

function _ui_bar([double]$val, [double]$max, [int]$width = 28) {
    if ($max -le 0) { return "$DG" + ($EMP * $width) + "$R" }
    $pct    = [math]::Min(1.0, $val / $max)
    $filled = [int]($pct * $width)
    $empty  = $width - $filled
    $col    = if ($pct -gt 0.5) { $GR } elseif ($pct -gt 0.2) { $YL } else { $RD }
    return "$col" + ($FUL * $filled) + "$DG" + ($EMP * $empty) + "$R"
}

function _ui_tag([bool]$free) {
    if ($free) { return "${GR}GRATUIT${R}" }
    return "${FG_PAID}PAYANT ${R}"
}

function _ui_ram($m) {
    if ($m.ram_gb) { return "${DG}~$($m.ram_gb)GB${R}" }
    return "${DG}cloud  ${R}"
}

function _ui_launch_anim([string]$provName, [string]$model) {
    _ui_clear
    _ui_header
    Write-Host "  $GR$ARR$R  Connexion a  $B$CY$provName$R  $DG//  $model$R"
    Write-Host ""
    $dots = ""
    for ($i = 0; $i -lt 3; $i++) {
        $dots += "$CY.$R"
        Write-Host -NoNewline "`r  $DG  Lancement$R $dots   "
        Start-Sleep -Milliseconds 280
    }
    Write-Host ""
    Write-Host ""
}

# =============================================================================
#  Menu fleches interactif
# =============================================================================

function _ui_menu {
    param(
        [string]$Title,
        [object[]]$Items,
        [string]$Hint = "",
        [string]$Status = ""
    )
    # Items : array de hashtable avec keys : label, sub, tag, extra, free
    $sel = 0
    $n   = $Items.Count
    $labW = [math]::Max(24, (_ui_w) - 22)   # largeur label responsive
    [Console]::CursorVisible = $false
    [Console]::Clear()   # un seul clear a l'entree ; ensuite on repeint en place (zero flicker)

    while ($true) {
        try { [Console]::SetCursorPosition(0, 0) } catch { [Console]::Clear() }
        _ui_header
        _ui_section $Title
        if ($Status) {
            Write-Host "  $Status"
            Write-Host ""
        }

        for ($i = 0; $i -lt $n; $i++) {
            $it     = $Items[$i]
            $active = ($i -eq $sel)

            if ($active) {
                $prefix = "  $CY$B$ARR$R "
                $bg     = $BG_SEL
                $lc     = "$B$WH"
            } else {
                $prefix = "    "
                $bg     = ""
                $lc     = $FG_LABEL
            }

            $num    = ($i + 1).ToString().PadLeft(2)
            $rawLab = [string]$it.label
            if ($rawLab.Length -gt $labW) { $rawLab = $rawLab.Substring(0, $labW - 3) + "..." }
            $lab  = $rawLab.PadRight($labW)
            $tag  = if ($it.ContainsKey("tag"))   { $it.tag }   else { "" }
            $xtra = if ($it.ContainsKey("extra")) { $it.extra } else { "" }

            Write-Host "$prefix$bg$lc $num.  $lab$R  $tag  $DG$xtra$R"
        }

        Write-Host ""
        $hintText = if ($Hint) { $Hint } else { "[haut/bas] naviguer  [PgUp/PgDn] sauter  [Home/End] extremes  [Entree] choisir  [1-9] direct  [Q] retour" }
        Write-Host "  $DG$H$H  $hintText  $H$H$R"
        Write-Host ""
        [Console]::Write("$e[0J")   # efface les lignes residuelles si la frame precedente etait plus longue

        $key = [Console]::ReadKey($true)

        switch ($key.Key) {
            "UpArrow"   { if ($sel -gt 0) { $sel-- } }
            "DownArrow" { if ($sel -lt ($n - 1)) { $sel++ } }
            "Home"      { $sel = 0 }
            "End"       { $sel = $n - 1 }
            "PageUp"    { $sel = [math]::Max(0, $sel - 5) }
            "PageDown"  { $sel = [math]::Min($n - 1, $sel + 5) }
            "Enter" {
                [Console]::CursorVisible = $true
                return $Items[$sel]
            }
        }
        if ($key.KeyChar -eq 'q' -or $key.KeyChar -eq 'Q') {
            [Console]::CursorVisible = $true
            return $null
        }
        if ($key.KeyChar -ge '1' -and $key.KeyChar -le '9') {
            $idx = [int]$key.KeyChar.ToString() - 1
            if ($idx -ge 0 -and $idx -lt $n) {
                [Console]::CursorVisible = $true
                return $Items[$idx]
            }
        }
    }
}

# =============================================================================
#  Ecrans
# =============================================================================

function _screen_providers {
    $provNames = _p_list
    $items = foreach ($pName in $provNames) {
        $p       = _p_load $pName
        $total   = $p.models.Count
        $free    = ($p.models | Where-Object { $_.free }).Count
        $tagLine = _provider_badge $pName $p
        @{
            label = $p.name
            sub   = ""
            tag   = $tagLine
            extra = "$free gratuits / $total modeles"
            free  = ($free -gt 0)
            pname = $pName
        }
    }
    $choice = _ui_menu -Title "CHOISIR UN PROVIDER" -Items $items -Status (_active_status_line)
    if (-not $choice) { return }
    _screen_models $choice.pname
}

function _screen_models([string]$pName) {
    $prov = _p_load $pName
    $activeModel = [Environment]::GetEnvironmentVariable("ANTHROPIC_MODEL", "Process")
    $items = foreach ($m in $prov.models) {
        $ram = _ui_ram $m
        $isActive = ($activeModel -eq $m.id)
        $isDefault = ($prov.default -eq $m.id)
        $tag = if ($isActive) { "${CY}ACTIF${R}" } else { _ui_tag $m.free }
        $marks = @()
        if ($isDefault) { $marks += "defaut" }
        if ($m.note) { $marks += $m.note }
        @{
            label = $m.id
            tag   = $tag
            extra = "$($ram)  $($marks -join ' · ')"
            free  = $m.free
            modelId = $m.id
        }
    }
    $freeCount = ($prov.models | Where-Object { $_.free }).Count
    $choice = _ui_menu -Title "$($prov.name.ToUpper())  //  CHOISIR UN MODELE ($freeCount gratuits / $($prov.models.Count))" -Items $items -Status (_active_status_line)
    if (-not $choice) {
        _screen_providers
        return
    }
    _launch $pName $choice.modelId
}

function _screen_credits {
    _ui_clear
    _ui_header
    _ui_section "CREDITS ET QUOTAS"

    # OpenRouter
    $prov = _p_load "openrouter"
    if ($prov) {
        $key = _env_resolve $prov.env.ANTHROPIC_AUTH_TOKEN
        Write-Host "  $B${CY}OpenRouter$R"
        if ($key -and -not ($key -like "sk-or-METS*")) {
            try {
                $resp = Invoke-RestMethod "https://openrouter.ai/api/v1/credits" -Headers @{ Authorization = "Bearer $key" }
                $tot  = [double]$resp.data.total_credits
                $used = [double]$resp.data.total_usage
                $left = [math]::Round($tot - $used, 4)
                if ($tot -eq 0) {
                    $bar = _ui_bar 1 1
                    Write-Host "  $bar  ${GR}Tier gratuit$R  ${DG}(modeles :free = 0 credit consomme)$R"
                } else {
                    $pct = [math]::Round(($left / $tot) * 100, 1)
                    $bar = _ui_bar $left $tot
                    Write-Host "  $bar  $B`$$left$R / `$$tot  ($pct%)"
                }
            } catch {
                Write-Host "  ${RD}Erreur API : $_$R"
            }
        } else {
            Write-Host "  ${YL}Cle non configuree  ->  claude-set-key openrouter [cle]$R"
        }
    }

    Write-Host ""

    # LiteLLM providers
    Write-Host "  $B${CY}LiteLLM Gateway$R"
    foreach ($name in @("groq","gemini","cerebras","mistral","nvidia")) {
        $var = (_provider_env_map)[$name]
        $ok = [bool](_env_get $var)
        Write-Host "  $CY$($(_ok_bad $ok))$R  $($name.PadRight(10))  ${DG}$var$R"
    }

    Write-Host ""

    # Ollama
    Write-Host "  $B${CY}Ollama$R"
    $bar = _ui_bar 1 1
    Write-Host "  $bar  Local illimite  +  Cloud : quota 5h reset"
    Write-Host "  ${DG}  Quota cloud : https://ollama.com/dashboard$R"

    Write-Host ""
    Write-Host "  $DG$H$H  [Entree] ou [Q] pour revenir$R"
    [Console]::ReadKey($true) | Out-Null
}

function _screen_help {
    _ui_clear
    _ui_header
    _ui_section "COMMANDES"

    $rows = @(
        @{ cmd = "nexus";                          desc = "Menu interactif complet (navigation clavier)" }
        @{ cmd = "n";                              desc = "Alias court pour nexus" }
        @{ cmd = "nexus [provider]";               desc = "Picker de modeles pour ce provider directement" }
        @{ cmd = "nexus [provider] [modele]";      desc = "Lancement direct sans passer par les menus" }
        @{ cmd = "nexus credits";                  desc = "Solde OpenRouter + statut cles LiteLLM / Ollama" }
        @{ cmd = "nexus status";                   desc = "Provider actuellement actif" }
        @{ cmd = "nexus doctor";                   desc = "Diagnostic config, cles, proxy et conflits" }
        @{ cmd = "nexus proxy-start";              desc = "Demarre le gateway LiteLLM sans lancer Claude" }
        @{ cmd = "nexus proxy-stop";               desc = "Arrete le gateway LiteLLM" }
        @{ cmd = "nexus update";                   desc = "Met a jour Nexus Switch (derniere version npm)" }
        @{ cmd = "nexus help";                     desc = "Cette page" }
        @{ cmd = "";                               desc = "" }
        @{ cmd = "claude-set-key openrouter [k]";  desc = "Enregistre ta cle OpenRouter dans providers/openrouter.json" }
        @{ cmd = "claude-set-key groq [k]";        desc = "Enregistre ta cle Groq (variable d'env persistante)" }
        @{ cmd = "";                               desc = "" }
        @{ cmd = "claude-proxy-start";             desc = "Demarre LiteLLM gateway sur :4000" }
        @{ cmd = "claude-proxy-stop";              desc = "Arrete le proxy LiteLLM" }
    )

    foreach ($row in $rows) {
        if (-not $row.cmd) { Write-Host ""; continue }
        $cmd  = $row.cmd.PadRight(38)
        Write-Host "  $CY$cmd$R  $DG$($row.desc)$R"
    }

    Write-Host ""
    _ui_section "PROVIDERS DISPONIBLES"

    foreach ($pName in (_p_list)) {
        $p    = _p_load $pName
        $free = ($p.models | Where-Object { $_.free }).Count
        $tot  = $p.models.Count
        Write-Host "  $CY$($pName.PadRight(16))$R  $B$WH$($p.name)$R  $DG($free gratuits / $tot modeles)$R"
    }

    Write-Host ""
    _ui_section "EXEMPLES"
    Write-Host "  ${DG}nexus openrouter$R                   picker modeles OpenRouter"
    Write-Host "  ${DG}nexus ollama qwen3.5:cloud$R          lancement direct Ollama cloud"
    Write-Host "  ${DG}nexus openrouter deepseek/deepseek-r1:free --continue$R"
    Write-Host "  ${DG}nexus groq$R                         proxy auto sur :4000"
    Write-Host ""
    Write-Host "  $DG$H$H  [Entree] ou [Q] pour revenir$R"
    [Console]::ReadKey($true) | Out-Null
}

function _screen_status {
    _ui_clear
    _ui_header
    _ui_section "STATUS ACTIF"

    # Option A : le provider actif est defini par les env vars Process de CE terminal
    $base = [Environment]::GetEnvironmentVariable("ANTHROPIC_BASE_URL", "Process")
    $modl = [Environment]::GetEnvironmentVariable("ANTHROPIC_MODEL", "Process")
    if (-not $base) {
        Write-Host "  $GR$ARR$R  Provider  :  $B${GR}Ollama / Anthropic natif$R"
        Write-Host "  $DG     Mode     :  aucune var ANTHROPIC_BASE_URL dans ce terminal$R"
    } else {
        $name = switch -Wildcard ($base) {
            "*openrouter*" { "OpenRouter" }
            "*localhost*"  { "LiteLLM Gateway" }
            "*127.0.0.1*"  { "LiteLLM Gateway" }
            default        { $base }
        }
        Write-Host "  $GR$ARR$R  Provider  :  $B${CY}$name$R"
        Write-Host "  $DG     Modele   :  $modl$R"
        Write-Host "  $DG     Base URL :  $base$R"
        Write-Host "  $DG     Scope    :  variables Process (isolees a ce terminal)$R"
    }

    Write-Host ""
    Write-Host "  $DG$H$H  [Entree] ou [Q] pour revenir$R"
    [Console]::ReadKey($true) | Out-Null
}

function _screen_doctor {
    _ui_clear
    _ui_header
    _ui_section "DIAGNOSTIC NEXUS"

    $openrouter = _p_load "openrouter"
    $openrouterKey = if ($openrouter) { _env_resolve $openrouter.env.ANTHROPIC_AUTH_TOKEN } else { "" }
    $groqKey = _env_get "GROQ_API_KEY"
    $litellm = _litellm_exe
    $proxyOk = _proxy_running
    $localCfg = Test-Path $LocalConfig
    $creds = Test-Path "$ClaudeDir\.credentials.json"
    $base = [Environment]::GetEnvironmentVariable("ANTHROPIC_BASE_URL", "Process")
    $model = [Environment]::GetEnvironmentVariable("ANTHROPIC_MODEL", "Process")

    Write-Host "  $CY$($(_ok_bad (-not $localCfg)))$R  settings.local.json absent       $DG$(if($localCfg){'pollution globale possible'}else{'isolation terminal OK'})$R"
    Write-Host "  $CY$($(_ok_bad ([bool]$openrouterKey)))$R  OpenRouter key configuree"
    Write-Host "  $CY$($(_ok_bad $true))$R  Login Anthropic natif            $DG$(if($creds){'present (coexiste avec les env vars, pas de /logout)'}else{'absent'})$R"
    Write-Host "  $CY$($(_ok_bad ([bool]$groqKey)))$R  GROQ_API_KEY user"
    Write-Host "  $CY$($(_ok_bad ([bool]$litellm)))$R  litellm.exe                    $DG$litellm$R"
    Write-Host "  $CY$($(_ok_bad $proxyOk))$R  Proxy localhost:4000           $DG$(if($proxyOk){'actif'}else{'inactif'})$R"
    Write-Host ""
    Write-Host "  $B${CY}Terminal courant$R"
    Write-Host "  ${DG}Base URL : $base$R"
    Write-Host "  ${DG}Modele   : $model$R"
    Write-Host ""
    if (Test-Path $ProxyErrLog) {
        Write-Host "  $B${CY}Dernieres erreurs LiteLLM$R"
        Get-Content $ProxyErrLog -Tail 6 | ForEach-Object { Write-Host "  ${DG}$_$R" }
        Write-Host ""
    }
    Write-Host "  $DG$H$H  [Entree] ou [Q] pour revenir$R"
    [Console]::ReadKey($true) | Out-Null
}

# =============================================================================
#  Lancement
# =============================================================================

function _launch([string]$pName, [string]$model, [object[]]$rest = @()) {
    $prov = _p_load $pName
    _ui_launch_anim $prov.name $model

    if ($prov.type -eq "ollama") {
        _p_reset_env
        if (Test-Path $LocalConfig) { Remove-Item $LocalConfig -Force }
        if ($rest.Count -gt 0) {
            ollama launch claude --model $model -- @rest
        } else {
            ollama launch claude --model $model
        }
    } else {
        # Provider via LiteLLM Gateway : on garantit que le proxy local tourne.
        if ($prov.type -eq "litellm") {
            if (_proxy_running) {
                Write-Host "  $GR$ARR$R  Proxy LiteLLM deja actif sur :4000$R"
            } else {
                Write-Host "  $YL$ARR$R  Proxy LiteLLM absent - demarrage automatique...$R"
                claude-proxy-start
                if (-not (_proxy_running)) {
                    Write-Host "  ${RD}Gateway LiteLLM injoignable : abandon du lancement provider.$R"
                    return
                }
            }
        }
        _p_apply $prov $model
        claude @rest
    }
}

# =============================================================================
#  Point d'entree principal :  nexus
# =============================================================================

function nexus {
    # nexus                           -> menu complet
    # nexus openrouter                -> picker modeles openrouter
    # nexus openrouter deepseek/...   -> lancement direct
    # nexus credits                   -> ecran credits
    # nexus status                    -> ecran status

    $cmd = if ($args.Count -ge 1) { $args[0] } else { "" }

    switch ($cmd) {
        "credits" { _screen_credits;   return }
        "status"  { _screen_status;    return }
        "doctor"  { _screen_doctor;    return }
        "diag"    { _screen_doctor;    return }
        "proxy-start" { claude-proxy-start; return }
        "proxy-stop"  { claude-proxy-stop;  return }
        "update"  { _nexus_update;     return }
        "upgrade" { _nexus_update;     return }
        "help"    { _screen_help;      return }
        "--help"  { _screen_help;      return }
        "-h"      { _screen_help;      return }
        "ls"      { _screen_providers; return }
        "" {
            # Menu principal avec option credits/status
            while ($true) {
                $mainItems = @(
                    @{ label = "Choisir un provider et lancer"; tag = ""; extra = ""; free = $true; action = "providers" }
                    @{ label = "Credits et quotas";             tag = ""; extra = "OpenRouter + cles gateway"; free = $true; action = "credits" }
                    @{ label = "Status actif";                  tag = ""; extra = "provider en cours"; free = $true; action = "status"  }
                    @{ label = "Diagnostic";                    tag = ""; extra = "cles, proxy, conflits"; free = $true; action = "doctor" }
                    @{ label = "Demarrer gateway LiteLLM";      tag = if(_proxy_running){"${GR}actif$R"}else{"${YL}stop$R"}; extra = "localhost:4000"; free = $true; action = "proxyStart" }
                    @{ label = "Arreter gateway LiteLLM";       tag = ""; extra = "nettoyage proxy"; free = $true; action = "proxyStop" }
                    @{ label = "Mettre a jour Nexus Switch";    tag = ""; extra = "derniere version npm"; free = $true; action = "update" }
                    @{ label = "Aide";                          tag = ""; extra = "commandes + exemples"; free = $true; action = "help"   }
                    @{ label = "Quitter";                       tag = ""; extra = ""; free = $true; action = "quit"    }
                )
                $choice = _ui_menu -Title "MENU PRINCIPAL" -Items $mainItems -Hint "[haut/bas] naviguer  [PgUp/PgDn] sauter  [Entree] choisir  [Q] quitter" -Status (_active_status_line)
                if (-not $choice -or $choice.action -eq "quit") { _ui_clear; return }
                switch ($choice.action) {
                    "providers" { _screen_providers }
                    "credits"   { _screen_credits   }
                    "status"    { _screen_status    }
                    "doctor"     { _screen_doctor     }
                    "proxyStart" { claude-proxy-start }
                    "proxyStop"  { claude-proxy-stop  }
                    "update"     { _nexus_update      }
                    "help"       { _screen_help       }
                }
            }
        }
        default {
            # nexus openrouter [model] [flags...]
            $pName = $cmd
            $prov  = _p_load $pName
            if (-not $prov) {
                Write-Host "  ${RD}Provider inconnu : $pName$R"
                Write-Host "  ${DG}Disponibles : $(_p_list -join ', ')$R"
                return
            }
            if ($args.Count -ge 2 -and -not ($args[1] -like "-*")) {
                $model = $args[1]
                $rest  = if ($args.Count -ge 3) { $args[2..($args.Count-1)] } else { @() }
                _launch $pName $model $rest
            } else {
                $rest = if ($args.Count -ge 2) { $args[1..($args.Count-1)] } else { @() }
                _screen_models $pName
            }
        }
    }
}

# =============================================================================
#  Utilitaires
# =============================================================================

function claude-set-key {
    param([string]$Provider, [string]$Key)
    if (-not $Provider -or -not $Key) {
        Write-Host "  ${YL}Usage : claude-set-key [provider] [cle]$R"
        Write-Host "  Ex    : claude-set-key groq       gsk-xxxx"
        Write-Host "          claude-set-key openrouter sk-or-xxxx"
        Write-Host "          claude-set-key gemini     AIza..."
        return
    }
    $map = _provider_env_map
    if (-not $map.ContainsKey($Provider)) { Write-Host "  ${RD}Provider '$Provider' non supporte$R"; return }
    $var = $map[$Provider]
    [Environment]::SetEnvironmentVariable($var, $Key, "User")
    [Environment]::SetEnvironmentVariable($var, $Key, "Process")
    Write-Host "  ${GR}$var sauvegardee (persistante)$R"
}

function claude-proxy-start {
    $cfg = $LiteLLMConfig
    if (-not (Test-Path $cfg)) { Write-Host "  ${RD}litellm-config.yaml introuvable$R"; return }
    _sync_litellm_env
    if (-not (_litellm_has_any_key)) {
        Write-Host "  ${YL}Aucune cle LiteLLM configuree - claude-set-key groq|gemini|cerebras|mistral|nvidia [cle]$R"
        return
    }
    if (_proxy_running) { Write-Host "  ${GR}Proxy deja actif sur :4000$R"; return }
    $exe = _litellm_exe
    if (-not $exe) {
        Write-Host "  ${RD}litellm introuvable - pip install litellm[proxy]  (ou ajoute le dossier Scripts au PATH)$R"
        return
    }
    _ensure_proxy_key | Out-Null
    Remove-Item $ProxyOutLog,$ProxyErrLog -Force -ErrorAction SilentlyContinue
    $env:PYTHONUTF8 = "1"
    $env:PYTHONIOENCODING = "utf-8"
    Write-Host "  ${CY}Demarrage LiteLLM proxy sur 127.0.0.1:4000...$R  ${DG}($exe)$R"
    # --host 127.0.0.1 : sinon LiteLLM bind 0.0.0.0 -> proxy expose sur tout le LAN
    # (wifi partage) avec une master key connue. Loopback only.
    Start-Process -FilePath $exe -ArgumentList "--config `"$cfg`" --host 127.0.0.1 --port 4000" -WindowStyle Hidden -RedirectStandardOutput $ProxyOutLog -RedirectStandardError $ProxyErrLog
    # Attendre que le port reponde reellement (max 20s) au lieu d'un sleep fixe
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        if (_proxy_running) { Write-Host "  ${GR}Proxy pret sur :4000$R"; return }
    }
    Write-Host "  ${RD}Proxy sans reponse apres 20s.$R"
    if (Test-Path $ProxyErrLog) {
        Get-Content $ProxyErrLog -Tail 10 | ForEach-Object { Write-Host "  ${DG}$_$R" }
    }
}

function claude-proxy-stop {
    Get-Process -Name "litellm" -ErrorAction SilentlyContinue | Stop-Process -Force
    Get-CimInstance Win32_Process -Filter "name = 'python.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$LiteLLMConfig*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Host "  ${YL}LiteLLM proxy arrete.$R"
}

function _nexus_update {
    # Recupere la derniere version publiee sur npm et reinstalle dans ~/.nexus-switch.
    _ui_clear
    _ui_header
    _ui_section "MISE A JOUR"

    if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
        Write-Host "  ${RD}npx introuvable - installe Node.js : https://nodejs.org$R"
        Write-Host ""
        Write-Host "  $DG$H$H  [Entree] pour revenir$R"
        [Console]::ReadKey($true) | Out-Null
        return
    }

    $latest = (npm view "@hexanexus/nexus-switch" version 2>$null)
    if ($latest) { Write-Host "  ${CY}Derniere version npm : $B$latest$R" }
    Write-Host "  ${CY}Telechargement et reinstallation...$R"
    Write-Host ""

    & npx -y "@hexanexus/nexus-switch@latest" update
    $code = $LASTEXITCODE

    Write-Host ""
    if ($code -ne 0) {
        Write-Host "  ${RD}Echec de la mise a jour (code $code).$R"
    } else {
        Write-Host "  ${GR}Nexus Switch mis a jour dans ~/.nexus-switch.$R"
        Write-Host "  ${YL}Recharge ce terminal : $B. `$PROFILE$R  ${DG}(ou ouvre un nouveau terminal)$R"
    }
    Write-Host ""
    Write-Host "  $DG$H$H  [Entree] pour revenir$R"
    [Console]::ReadKey($true) | Out-Null
}

# Alias court
Set-Alias n nexus
