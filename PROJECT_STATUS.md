# Project Status

## Formål

Rumopdelt smart home-dashboard til Home Assistant med:

- lys, kontakter og termostater pr. rum
- Sonos og Spotify
- nyhedsticker med DR og TV 2

## Projektplacering

Projektet ligger her:

- `\\192.168.0.120\unassigned\LITEONIT_LCS-128M6S_2.5_7mm_128GB_TW032GYJ5508542H2706\ha-dashboard-starter`

## Domæne og DNS

- Domæne: `skipperpiben.dk`
- DNS styres hos: `https://dns.services/`

Bruger planlægger selv at:

- lave proxy-indgang
- rette DNS

## Hvad der er bygget

- Dashboardet er ændret fra sektioner (`Lys`, `Termostater`, `Sonos`) til rumopdelt layout.
- Oversigten er gjort mere relevant end blot antal rum.
- Danske tegn er rettet i UI-tekster som `Tænd lys`, `Næste`, `Køkken`, `Værelse`.
- Spotify-sektionen understøtter playlister via Home Assistant-konfiguration.
- Nyhedsticker i bunden henter overskrifter fra DR og TV 2 via server-side endpoint.
- Nyhedsticker scroller automatisk sidelæns og er sat til `90s`.
- TV 2-overskrifter renses for `Live`, og kategori beholdes som fx `Udland - ...`.
- DR og TV 2-overskrifter blandes tilfældigt i tickeren.

## Teknisk struktur

Frontend:

- `app/index.html`
- `app/css/styles.css`
- `app/js/app.js`

Konfiguration:

- `app/config/ha-config.js`
- `app/config/ha-config.template.js`

Server:

- `server.js`
- `package.json`

Docker:

- `Dockerfile`
- `docker-compose.yml`

## Vigtige filer

- Dashboard UI: `app/js/app.js`
- Spotify test: `app/spotify-test.html`
- Spotify testlogik: `app/js/spotify-test.js`
- Nyheds-scraper/API: `server.js`

## Spotify status

Følgende er sat i config:

- `spotify.clientId = 578cd43ba7ac437f9c8d351f50bf75f8`
- `spotify.testPlaylistUri = https://open.spotify.com/playlist/37i9dQZF1DX52kuWtQdNIb?si=b9ef35921db74b9c`

Spotify-testside er lavet for at afgøre, om Sonos-enheder dukker op som styrbare Spotify Connect devices.

Testside:

- `/spotify-test.html`

## Kendt blocker

Spotify OAuth kræver en gyldig redirect URI, som matcher præcist og bruger HTTPS for normal webadgang.

Det betyder:

- dashboardet skal have en HTTPS proxy-indgang
- redirect URI i Spotify Developer skal pege på den præcise test-URL

Eksempel:

- `https://ha.skipperpiben.dk/spotify-test.html`

## Næste skridt

1. Lav proxy-indgang med HTTPS til dashboardet.
2. Opret/ret DNS for valgt subdomæne.
3. Tilføj præcis redirect URI i Spotify Developer app.
4. Rebuild containeren.
5. Åbn Spotify-testsiden og verificér:
   - om Sonos vises
   - om device har ID
   - om den er `restricted`

## Rebuild

```bash
cd /mnt/user/unassigned/LITEONIT_LCS-128M6S_2.5_7mm_128GB_TW032GYJ5508542H2706/ha-dashboard-starter
docker rm -f ha-dashboard 2>/dev/null || true
docker compose up -d --build
```

## Sikkerhed

- Home Assistant token ligger stadig i frontend-config under udvikling.
- Brugeren vil rotere token senere, når løsningen er landet tilfredsstillende.
