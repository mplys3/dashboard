# Home Assistant Dashboard

Rumopdelt dashboard til Home Assistant med:

- lys, kontakter og termostater pr. rum
- Sonos- og Spotify-kontrol
- valg af Spotify-playlister via `media_player.play_media`
- bundlinje med overskrifter fra DR og TV 2 hentet server-side
- ugens madplan hentet fra den lokale Meal Planner

## Konfiguration

Ret `app/config/ha-config.js`:

- `haUrl`
- `haToken`
- `rooms`
- `spotify.playlists`
- `mealPlanner.webUrl`

Dashboard-serveren henter planerne fra `http://10.0.0.82:8765` som standard. En anden adresse kan sættes med miljøvariablen `MEAL_PLANNER_URL`.

Spotify-playlister kan være almindelige playlist-links eller `spotify:playlist:...` URI'er.

## Docker

```bash
docker compose up -d --build
```

Siden kører derefter på:

- `http://UNRAID-IP:8088`

## Home Assistant add-on

Repoet kan også tilføjes som et Home Assistant add-on repository:

```text
https://github.com/mplys3/dashboard
```

Add-on'et ligger i `ha-dashboard/` og bygger dashboardet fra repoet. Når det kører som add-on, bruger serveren Home Assistants Supervisor API internt, så `haUrl` og `haToken` ikke behøver at være sat i frontend-configen.

Add-on'en opretter automatisk en redigerbar config på første start. Inde i add-on'en hedder den:

```text
/config/ha-config.js
```

På Home Assistant hosten ligger den under `/addon_configs/...`.

## Bemærkninger

- Token ligger stadig i frontend og løsningen bør kun bruges internt på dit LAN.
- Nyhedslinjen bruger et lille Node-endpoint i containeren, fordi TV 2 og DR ikke kan hentes stabilt direkte fra browseren.
- Kildesiderne kan ændre markup. Hvis deres "mest læste"-sektion ændrer sig, falder feedet tilbage til de første fundne overskrifter.
