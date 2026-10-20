# Runs one table's worth of stress tests and prints its rows.
#
#   .\stress_test\run_tests.ps1 -Table A          # load test by scenario
#   .\stress_test\run_tests.ps1 -Table B          # rising concurrency
#   .\stress_test\run_tests.ps1 -Table C          # rate limiting (server must run with STRESS_THROTTLE=on)
#   .\stress_test\run_tests.ps1 -Table Break      # step up to 1,000 users to find the breaking point
#   .\stress_test\run_tests.ps1 -Table Spike      # sudden jump 20 -> 300 -> 20 users
#   .\stress_test\run_tests.ps1 -Table Soak       # 100 realistic users for 30 minutes
#
# Options: -Runs 3 (repeats per row), -TargetHost http://<server-ip>:8000
# Start the server first (see stress_test/README.md). Results land in
# results\<Table>\ and the summary table is printed at the end.

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("A", "B", "C", "Break", "Spike", "Soak")]
    [string]$Table,
    [int]$Runs = 3,
    [string]$TargetHost = "http://127.0.0.1:8000"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$locust = Join-Path $root "venv\Scripts\locust.exe"
$python = Join-Path $root "venv\Scripts\python.exe"
$locustfile = Join-Path $PSScriptRoot "locustfile.py"
$outDir = Join-Path $root "results\$Table"
# Keep an earlier attempt instead of averaging its runs into this one.
if (Test-Path $outDir) {
    $old = "$outDir" + "_old_" + (Get-Date -Format "yyyyMMdd_HHmmss")
    Move-Item $outDir $old
    Write-Host "Earlier results moved to $old" -ForegroundColor Yellow
}
New-Item -ItemType Directory -Force $outDir | Out-Null

function Assert-ServerUp {
    try {
        Invoke-WebRequest "$TargetHost/api/site/branding/" -UseBasicParsing -TimeoutSec 15 | Out-Null
    } catch {
        Write-Host ""
        Write-Host "The server at $TargetHost is not answering, so the test was stopped." -ForegroundColor Red
        Write-Host "Check the server window: if its title starts with 'Select', press Esc;" -ForegroundColor Red
        Write-Host "if it shows an error, restart it. Then run this table again." -ForegroundColor Red
        exit 1
    }
}

function Invoke-Scenario {
    param(
        [string]$Scenario, [int]$Users, [int]$MaxRequests = 0, [string]$Duration = "10m",
        [string]$Shape = "", [int]$PauseSeconds = 5
    )
    for ($run = 1; $run -le $Runs; $run++) {
        Assert-ServerUp
        $prefix = Join-Path $outDir "${Scenario}_u${Users}_r${run}"
        Write-Host "==> $Scenario, $Users users, run $run of $Runs" -ForegroundColor Cyan
        $env:STRESS_RESULT = $prefix
        $env:STRESS_MAX_REQUESTS = "$MaxRequests"
        $env:STRESS_SHAPE = $Shape
        $spawnRate = [Math]::Max(1, $Users)
        & $locust -f $locustfile --host $TargetHost --headless -u $Users -r $spawnRate -t $Duration `
            --csv $prefix --csv-full-history --only-summary $Scenario
        Remove-Item Env:STRESS_RESULT, Env:STRESS_MAX_REQUESTS, Env:STRESS_SHAPE -ErrorAction SilentlyContinue
        Start-Sleep -Seconds $PauseSeconds
    }
    Assert-ServerUp  # a run that ended because the server died shouldn't count
}

switch ($Table) {
    "A" {
        Invoke-Scenario BrowseOrdinances 50 -MaxRequests 1000
        Invoke-Scenario HomeAbout        50 -MaxRequests 1000
        Invoke-Scenario MyProfile        50 -MaxRequests 1000
        Invoke-Scenario OrdinanceMatch   50 -MaxRequests 1000
        Invoke-Scenario Login            50 -MaxRequests 200
        Invoke-Scenario FileReport       20 -MaxRequests 300
    }
    "B" {
        foreach ($users in 10, 25, 50, 100, 200, 300, 500) {
            Invoke-Scenario BrowseOrdinances $users -MaxRequests 2000
        }
    }
    "C" {
        # 65 s apart so each run starts with a fresh one-minute allowance.
        Invoke-Scenario BrowseOrdinances 20 -MaxRequests 600 -PauseSeconds 65
        Invoke-Scenario LoginFlood       20 -MaxRequests 60  -PauseSeconds 65
    }
    "Break" {
        $Runs = 1
        Invoke-Scenario BrowseOrdinances 0 -Shape step -Duration 15m
        Invoke-Scenario OrdinanceMatch   0 -Shape step -Duration 15m
    }
    "Spike" {
        Invoke-Scenario BrowseOrdinances 0 -Shape spike -Duration 10m
    }
    "Soak" {
        $Runs = 1
        Invoke-Scenario MixedCitizen 100 -Duration 30m
    }
}

Write-Host ""
Write-Host "Results for Table $Table" -ForegroundColor Green
& $python (Join-Path $PSScriptRoot "summarize.py") $outDir
