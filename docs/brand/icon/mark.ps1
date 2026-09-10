param([string]$Out, [int]$Size = 1024, [switch]$FullBleed)
# Tironian app icon: U+204A (Tironian et) drawn as geometry, single weight,
# flat terminals, on the brand's window ground. Colors from docs/brand/tironian.md:
# --ground #1C1A18, --text #EDEAE6.
Add-Type -AssemblyName System.Drawing
$s = $Size / 1024.0
$bmp = New-Object System.Drawing.Bitmap $Size, $Size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$ground = [System.Drawing.ColorTranslator]::FromHtml('#1C1A18')
$ink = [System.Drawing.ColorTranslator]::FromHtml('#EDEAE6')

# macOS icon grid: 824px rounded square centred on a 1024 canvas, radius ~185.
if ($FullBleed) { $x0 = 0; $w = 1024; $r = 0 } else { $x0 = 100; $w = 824; $r = 185 }
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
if ($r -gt 0) {
  $d = 2 * $r * $s; $X = $x0 * $s; $W = $w * $s
  $path.AddArc($X, $X, $d, $d, 180, 90)
  $path.AddArc($X + $W - $d, $X, $d, $d, 270, 90)
  $path.AddArc($X + $W - $d, $X + $W - $d, $d, $d, 0, 90)
  $path.AddArc($X, $X + $W - $d, $d, $d, 90, 90)
  $path.CloseFigure()
} else {
  $path.AddRectangle((New-Object System.Drawing.RectangleF 0, 0, $Size, $Size))
}
$g.FillPath((New-Object System.Drawing.SolidBrush $ground), $path)

# The mark: a short bar and a vertical stem falling from its right end, the
# proportions of U+204A as Segoe UI Symbol sets it. Stroke weight 96 at 1024.
# A vertical stem and a bar shorter than the stem is what keeps it from reading
# as a 7, whose stroke slants.
function P([double]$x, [double]$y) { New-Object System.Drawing.PointF ([float]($x * $s)), ([float]($y * $s)) }
$brush = New-Object System.Drawing.SolidBrush $ink
$bar = [System.Drawing.PointF[]]@((P 372 262), (P 662 262), (P 662 358), (P 372 358))
$stem = [System.Drawing.PointF[]]@((P 566 262), (P 662 262), (P 662 782), (P 566 782))
$g.FillPolygon($brush, $bar)
$g.FillPolygon($brush, $stem)

$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "wrote $Out ($Size px)"
