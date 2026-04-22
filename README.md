# Home Assistant Dashboard

Rumopdelt dashboard til Home Assistant med:

- lys, kontakter og termostater pr. rum
- Sonos- og Spotify-kontrol
- valg af Spotify-playlister via `media_player.play_media`
- bundlinje med overskrifter fra DR og TV 2 hentet server-side

## Konfiguration

Ret `app/config/ha-config.js`:

- `haUrl`
- `haToken`
- `rooms`
- `spotify.playlists`

Spotify-playlister kan være almindelige playlist-links eller `spotify:playlist:...` URI'er.

## Docker

```bash
docker compose up -d --build
```

Siden kører derefter på:

- `http://UNRAID-IP:8088`

## Bemærkninger

- Token ligger stadig i frontend og løsningen bør kun bruges internt på dit LAN.
- Nyhedslinjen bruger et lille Node-endpoint i containeren, fordi TV 2 og DR ikke kan hentes stabilt direkte fra browseren.
- Kildesiderne kan ændre markup. Hvis deres "mest læste"-sektion ændrer sig, falder feedet tilbage til de første fundne overskrifter.
