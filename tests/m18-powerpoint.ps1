param(
  [string]$DeckPath = 'output/playwright/m18-real.pptx',
  [string]$SnapshotPath = 'output/playwright/m18-real-presentation.json',
  [string]$OutputPrefix = 'output/playwright/m18-powerpoint',
  [int[]]$AdditionalSlides = @()
)
$ErrorActionPreference = 'Stop'
$payload = Get-Content -LiteralPath $SnapshotPath -Raw | ConvertFrom-Json
if ($payload.result) { $deck = $payload.result.deck; $paper = $payload.result.paper } else { $deck = $payload.deck; $paper = $payload.paper }
$fullDeckPath = (Resolve-Path -LiteralPath $DeckPath).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputPrefix)
$speechById = @{}
foreach ($speech in $deck.speech) { $speechById[$speech.id] = $speech }
function NormalizeText([string]$text) { return ($text -replace "\r\n?", "`n").Trim() }
$app = New-Object -ComObject PowerPoint.Application
$presentation = $null
$copy = $null
$issues = [System.Collections.Generic.List[string]]::new()
$overflows = [System.Collections.Generic.List[object]]::new()
$images = 0
$editable = 0
$notesMatched = 0
$samples = [System.Collections.Generic.HashSet[int]]::new()
[void]$samples.Add(1)
foreach ($index in $AdditionalSlides) { [void]$samples.Add($index) }
$seenFigures = [System.Collections.Generic.HashSet[string]]::new()
try {
  $presentation = $app.Presentations.Open($fullDeckPath, 0, 0, 0)
  if ($presentation.Slides.Count -ne $deck.slides.Count) { throw 'Slide count differs from saved Deck' }
  for ($index = 1; $index -le $presentation.Slides.Count; $index++) {
    $slide = $presentation.Slides.Item($index)
    $saved = $deck.slides[$index - 1]
    $expectedNotes = ''
    $paragraph = ''
    foreach ($id in $saved.speechIds) {
      $segment = $speechById[$id]
      if ($paragraph -and $paragraph -ne $segment.paragraphId) { $expectedNotes += "`n`n" }
      $expectedNotes += $segment.text
      $paragraph = $segment.paragraphId
    }
    $actualNotes = $slide.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text
    if ((NormalizeText $actualNotes) -eq (NormalizeText $expectedNotes)) { $notesMatched++ } else { $issues.Add("Notes mismatch on slide $index") }
    $figureElements = @($saved.elements | Where-Object { $_.type -eq 'figure' })
    $imageIndex = 0
    for ($shapeIndex = 1; $shapeIndex -le $slide.Shapes.Count; $shapeIndex++) {
      $shape = $slide.Shapes.Item($shapeIndex)
      if ($shape.Type -eq 13) {
        $images++
        $element = $figureElements[$imageIndex]
        $figure = $paper.figures | Where-Object { $_.id -eq $element.figureId }
        $region = $figure.regions | Where-Object { $_.id -eq $element.regionId }
        if (!$region) { $region = $figure.regions[0] }
        $sourceId = $region.sourceId
        if ($element.panelId) { $sourceId = ($region.panels | Where-Object { $_.id -eq $element.panelId }).sourceId }
        $source = $paper.sources | Where-Object { $_.id -eq $sourceId }
        $bbox = if ($element.cropOverride) { $element.cropOverride } else { $source.bbox }
        $page = $paper.pages | Where-Object { $_.documentId -eq $source.documentId -and $_.pageNumber -eq $source.pageNumber }
        $expectedAspect = ($page.width * $bbox.width) / ($page.height * $bbox.height)
        if ([Math]::Abs(($shape.Width / $shape.Height) / $expectedAspect - 1) -gt 0.001) { $issues.Add("Image aspect mismatch on slide $index") }
        if ($seenFigures.Add($figure.id)) { [void]$samples.Add($index) }
        $imageIndex++
      }
      if ($shape.HasTextFrame -and $shape.TextFrame.HasText) {
        $editable++
        if ($shape.TextFrame.TextRange.BoundHeight -gt $shape.Height + 2) {
          $overflows.Add(@{slide=$index;shape=$shapeIndex;height=$shape.Height;boundHeight=$shape.TextFrame.TextRange.BoundHeight;text=$shape.TextFrame.TextRange.Text})
        }
      }
    }
    if ($imageIndex -ne $figureElements.Count) { $issues.Add("Image count mismatch on slide $index") }
  }
  foreach ($index in $samples) { $presentation.Slides.Item($index).Export("$outputPath-slide-$index.jpg", 'JPG', 1280, 720) }
  $title = $presentation.Slides.Item(1).Shapes.Item(1).TextFrame.TextRange
  $original = $title.Text
  $title.Text = $original + ' [edit verification]'
  $copyPath = "$outputPath-editable.pptx"
  $presentation.SaveCopyAs($copyPath)
  $title.Text = $original
  $presentation.Close()
  $presentation = $null
  $copy = $app.Presentations.Open($copyPath, -1, 0, 0)
  $editVerified = $copy.Slides.Item(1).Shapes.Item(1).TextFrame.TextRange.Text.Contains('[edit verification]')
  $report = @{slides=$deck.slides.Count;nativeTextShapes=$editable;independentImages=$images;notesMatched=$notesMatched;textEditSavedAndReopened=$editVerified;imagesProportionate=($issues.Count -eq 0);issues=@($issues.ToArray());textOverflows=@($overflows.ToArray());sampleSlides=@($samples)}
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath "$outputPath.json" -Encoding utf8
  $report | Select-Object slides,nativeTextShapes,independentImages,notesMatched,textEditSavedAndReopened,imagesProportionate | ConvertTo-Json
  if ($issues.Count -or $overflows.Count -or !$editVerified) { throw 'PowerPoint audit failed; inspect the local report.' }
} finally {
  if ($presentation) { $presentation.Close() }
  if ($copy) { $copy.Close() }
  if ($app.Presentations.Count -eq 0) { $app.Quit() }
}
