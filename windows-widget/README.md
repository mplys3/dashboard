# HA Dashboard Windows-widget

Widgetprovideren viser det eksisterende dashboard som en HTML-baseret Windows-widget. URL-parameteren `widget=1` aktiverer et tæt, responsivt layout, mens data og betjening fortsat håndteres af dashboardets eksisterende JavaScript.

## Byg

Åbn PowerShell i denne mappe og kør:

```powershell
.\build.ps1
```

Scriptet henter en lokal .NET 8 SDK under `%LOCALAPPDATA%\HaDashboardWidget\dotnet`, hvis den ikke allerede findes. Windows App SDK og Windows SDK-buildværktøjerne gendannes som NuGet-pakker. Der oprettes desuden et lokalt signeringscertifikat under `%LOCALAPPDATA%\HaDashboardWidget\certificate`.

## Installer

Når dashboardcontaineren er bygget og kører, installeres widgetten med:

```powershell
.\install.ps1 -DashboardUrl "http://192.168.0.120:8088/"
```

Åbn derefter Widget-området med `Win+W`, vælg **Tilføj widgets**, og tilføj **Mit hjem**. Vælg stor størrelse for at få mest af dashboardlayoutet med.

Installationsscriptet installerer den lokale udviklingspakke med `-AllowUnsigned`; det ændrer ikke computerens betroede rodcertifikater. Buildcertifikatet er kun beregnet til lokal udvikling af denne widget.

HTML-webwidgets er en nyere Windows-widgetfunktion. Brug en opdateret Windows Web Experience Pack og Windows App Runtime. HTTPS er den mest robuste løsning, hvis Widget-området afviser en lokal HTTP-adresse.
