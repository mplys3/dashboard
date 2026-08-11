(() => {
  const config = window.APP_CONFIG;
  if (!config) {
    throw new Error("APP_CONFIG mangler.");
  }

  const rooms = Array.isArray(config.rooms) ? config.rooms : [];
  const mediaItems = [
    ...rooms
      .filter((room) => room.media)
      .map((room) => ({
        entity_id: room.media,
        label: room.media_label || room.name,
        room: room.name,
        volume_sensor: room.media_volume_sensor || room.volume_sensor || "",
        kind: "room-media",
      })),
    ...(config.spotify?.entity_id
      ? [
          {
            entity_id: config.spotify.entity_id,
            label: config.spotify.label || "Spotify",
            room: config.spotify.room || "Streaming",
            kind: "spotify",
          },
        ]
      : []),
  ];
  const systemStatusConfig = {
    weather: config.systemStatus?.weather || "",
    electricity: config.systemStatus?.electricity || "",
    charger: config.systemStatus?.charger || "",
    waste: Array.isArray(config.systemStatus?.waste) ? config.systemStatus.waste : [],
    unraid: {
      ram: config.systemStatus?.unraid?.ram || "",
      cpu: config.systemStatus?.unraid?.cpu || "",
      cpuTemp: config.systemStatus?.unraid?.cpuTemp || "",
      uptime: config.systemStatus?.unraid?.uptime || "",
    },
  };

  const stateCache = new Map();
  const failedEntities = new Map();
  const spotifyStorageKeys = {
    accessToken: "spotify_access_token",
    refreshToken: "spotify_refresh_token",
    expiresAt: "spotify_expires_at",
  };
  const spotifyPlaylistCache = {
    items: null,
    loaded: false,
    loading: null,
    error: "",
  };
  const spotifyRecentPlaylistCache = {
    playedAtByPlaylist: new Map(),
    loaded: false,
    loading: null,
  };
  const spotifyTrackCache = {
    itemsByPlaylist: new Map(),
    loadingByPlaylist: new Map(),
    errorByPlaylist: new Map(),
  };
  const mediaArtworkCache = new Map();
  const spotifyUiState = {
    targetByItem: new Map(),
    playlistByItem: new Map(),
    trackByItem: new Map(),
    groupedTargetsByItem: new Map(),
    trackScrollTopByItem: new Map(),
    lastInteractionAt: 0,
  };
  const weatherUiState = {
    isOpen: false,
    loading: false,
    error: "",
    forecast: [],
    locationName: "",
    latitude: null,
    longitude: null,
    country: "",
    fetchedAt: 0,
  };
  const technicalHistory = {
    ram: [],
    cpu: [],
    cpuTemp: [],
  };
  const technicalHistoryWindowMs = 10 * 60 * 1000;
  const mealPlannerConfig = {
    endpoint: config.mealPlanner?.endpoint || "/api/meal-plan",
    webUrl: config.mealPlanner?.webUrl || "http://10.0.0.82:8765",
  };
  const mealPlanState = {
    plan: null,
    loading: true,
    error: "",
  };

  const elements = {
    title: document.getElementById("dashboardTitle"),
    subtitle: document.getElementById("dashboardSubtitle"),
    clock: document.getElementById("clock"),
    haStatus: document.getElementById("haStatus"),
    heroStats: document.getElementById("heroStats"),
    calendarPanel: document.getElementById("calendarPanel"),
    calendarTitle: document.getElementById("calendarTitle"),
    calendarSubtitle: document.getElementById("calendarSubtitle"),
    calendarCards: document.getElementById("calendarCards"),
    mediaCards: document.getElementById("mediaCards"),
    spotifyPanel: document.getElementById("spotifyPanel"),
    spotifyCards: document.getElementById("spotifyCards"),
    roomCards: document.getElementById("roomCards"),
    technicalStatusCards: document.getElementById("technicalStatusCards"),
    newsTicker: document.getElementById("newsTicker"),
  };
  let weatherModalElements = null;

  elements.title.textContent = config.dashboardTitle || "Mit dashboard";
  if (elements.subtitle && config.dashboardSubtitle) {
    elements.subtitle.textContent = config.dashboardSubtitle;
  }
  if (elements.calendarTitle && config.calendar?.label) {
    elements.calendarTitle.textContent = config.calendar.label;
  }
  if (elements.calendarSubtitle && config.calendar?.subtitle) {
    elements.calendarSubtitle.textContent = config.calendar.subtitle;
  }

  function updateClock() {
    const now = new Date();
    elements.clock.textContent = now.toLocaleTimeString("da-DK", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: config.timeZone || "Europe/Copenhagen",
    });
  }

  function proxyHeaders() {
    return {
      "X-HA-URL": config.haUrl,
      "X-HA-Token": config.haToken,
      "Content-Type": "application/json",
    };
  }

  function setStatus(mode, text) {
    elements.haStatus.textContent = text;
    elements.haStatus.classList.remove("ok", "error");
    if (mode === "ok") elements.haStatus.classList.add("ok");
    if (mode === "error") elements.haStatus.classList.add("error");
  }

  function getEntityDomain(entityId) {
    return String(entityId).split(".")[0];
  }

  function getRoomEntities(room) {
    return Array.isArray(room.entities) ? room.entities : [];
  }

  function getSwitchAndLightEntities(room) {
    return getRoomEntities(room).filter((entity) => entity.type === "light" || entity.type === "switch");
  }

  function getBrightnessEntities(room) {
    return getRoomEntities(room).filter((entity) => entity.type === "light" && entity.allow_brightness !== false);
  }

  function getRoomClimateState(room) {
    return room.climate ? stateCache.get(room.climate) || null : null;
  }

  function getRoomMediaState(room) {
    return room.media ? stateCache.get(room.media) || null : null;
  }

  function getMediaVolumePercent(item, state) {
    const sensorValue = toNumber(stateCache.get(item?.volume_sensor)?.state);
    if (sensorValue != null) {
      return clamp(Math.round(sensorValue), 0, 100);
    }

    if (state?.attributes?.volume_level != null) {
      return clamp(Math.round(Number(state.attributes.volume_level) * 100), 0, 100);
    }

    return null;
  }

  function getRoomLightEntries(room) {
    return getSwitchAndLightEntities(room).map((entity) => ({
      config: entity,
      state: stateCache.get(entity.entity_id) || null,
    }));
  }

  function getSystemEntityIds() {
    return [
      systemStatusConfig.weather,
      systemStatusConfig.electricity,
      systemStatusConfig.charger,
      ...systemStatusConfig.waste,
      systemStatusConfig.unraid.ram,
      systemStatusConfig.unraid.cpu,
      systemStatusConfig.unraid.cpuTemp,
      systemStatusConfig.unraid.uptime,
    ].filter(Boolean);
  }

  function getSystemState(entityId) {
    return entityId ? stateCache.get(entityId) || null : null;
  }

  function pruneTechnicalHistory(key) {
    if (!technicalHistory[key]) return;
    const cutoff = Date.now() - technicalHistoryWindowMs;
    technicalHistory[key] = technicalHistory[key].filter((entry) => entry.timestamp >= cutoff);
  }

  function setTechnicalHistory(key, points) {
    if (!technicalHistory[key]) return;
    technicalHistory[key] = points
      .filter((entry) => Number.isFinite(entry?.value) && Number.isFinite(entry?.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp);
    pruneTechnicalHistory(key);
  }

  function pushTechnicalHistory(key, value, timestamp = Date.now()) {
    const number = toNumber(value);
    if (number == null || !technicalHistory[key]) return;

    const lastEntry = technicalHistory[key][technicalHistory[key].length - 1];
    if (lastEntry && Math.abs(lastEntry.value - number) < 0.001 && Math.abs(lastEntry.timestamp - timestamp) < 1000) {
      return;
    }

    technicalHistory[key].push({
      value: number,
      timestamp,
    });
    pruneTechnicalHistory(key);
  }

  function getSpotifyPlaylistsFromConfig() {
    return Array.isArray(config.spotify?.playlists) ? config.spotify.playlists : [];
  }

  function isActivePlayback(state) {
    return Boolean(state && ["playing", "buffering"].includes(state.state));
  }

  function isHeating(state) {
    if (!state) return false;
    const current = Number(state.attributes?.current_temperature);
    const target = Number(state.attributes?.temperature);
    const hasHeatDemand = Number.isFinite(current) && Number.isFinite(target) && current < target - 0.2;

    if (state.attributes?.hvac_action) {
      return state.attributes.hvac_action === "heating" && hasHeatDemand;
    }

    return state.state === "heat" && hasHeatDemand;
  }

  function isOn(state) {
    return Boolean(state && state.state === "on");
  }

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatTemp(value, digits = 1) {
    const number = toNumber(value);
    return number == null ? "--" : `${number.toFixed(digits)}°`;
  }

  function formatPercent(value) {
    const number = toNumber(value);
    return number == null ? "--" : `${Math.round(number)}%`;
  }

  function formatPrice(value) {
    const number = toNumber(value);
    return number == null ? "--" : `${number.toFixed(2)} kr`;
  }

  function formatWeatherState(value) {
    const labels = {
      clear_night: "Klar nat",
      cloudy: "Skyet",
      exceptional: "Varsel",
      fog: "Taaget",
      hail: "Hagl",
      lightning: "Torden",
      lightning_rainy: "Tordenvejr",
      partlycloudy: "Let skyet",
      pouring: "Skybrud",
      rainy: "Regn",
      snowy: "Sne",
      snowy_rainy: "Slud",
      sunny: "Sol",
      windy: "Blaest",
      windy_variant: "Blaesende",
    };
    const key = String(value || "").trim();
    if (!key) return "Ingen vejrdata";
    return labels[key] || key.replace(/_/g, " ");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatSpeed(value, unit = "km/h") {
    const number = toNumber(value);
    if (number == null) return "--";

    const normalizedUnit = String(unit || "").toLowerCase();
    if (normalizedUnit.includes("km/h") || normalizedUnit.includes("kmh")) {
      return `${(number / 3.6).toFixed(1)} m/s`;
    }

    if (normalizedUnit.includes("m/s")) {
      return `${number.toFixed(1)} m/s`;
    }

    return `${number.toFixed(1)} ${unit}`;
  }

  function formatPressure(value) {
    const number = toNumber(value);
    return number == null ? "--" : `${Math.round(number)} hPa`;
  }

  function formatHumidity(value) {
    const number = toNumber(value);
    return number == null ? "--" : `${Math.round(number)}%`;
  }

  function formatCompassDirection(value) {
    const number = toNumber(value);
    if (number == null) return "--";
    const directions = ["N", "NNO", "NO", "ONO", "O", "OSO", "SO", "SSO", "S", "SSV", "SV", "VSV", "V", "VNV", "NV", "NNV"];
    return directions[Math.round(number / 22.5) % 16];
  }

  function formatForecastDay(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleDateString("da-DK", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  function formatMediaLine(state) {
    if (!state) return "Ingen media";
    const title = state.attributes?.media_title || "";
    const artist = state.attributes?.media_artist || "";
    if (!title && !artist) return state.state || "Ukendt";
    return [title, artist].filter(Boolean).join(" · ");
  }

  function formatDuration(seconds, prefix = "") {
    const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = String(totalSeconds % 60).padStart(2, "0");
    return `${prefix}${minutes}:${remainingSeconds}`;
  }

  function formatUptimeFromState(state) {
    const totalSeconds =
      toNumber(state?.attributes?.uptime_total_seconds) ||
      Math.max(0, Math.floor((Date.now() - new Date(state?.state || 0).getTime()) / 1000));
    if (!Number.isFinite(totalSeconds)) return "--";

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${days}d ${hours}t ${minutes}m`;
  }

  function getLiveMediaPosition(state) {
    const basePosition = Number(state?.attributes?.media_position);
    const duration = Number(state?.attributes?.media_duration);
    if (!Number.isFinite(basePosition) || !Number.isFinite(duration) || duration <= 0) {
      return null;
    }

    const updatedAt = state.attributes?.media_position_updated_at;
    if (!updatedAt || !isActivePlayback(state)) {
      return Math.min(duration, Math.max(0, basePosition));
    }

    const updatedTime = new Date(updatedAt).getTime();
    if (!Number.isFinite(updatedTime)) {
      return Math.min(duration, Math.max(0, basePosition));
    }

    const elapsedSinceUpdate = Math.max(0, (Date.now() - updatedTime) / 1000);
    return Math.min(duration, Math.max(0, basePosition + elapsedSinceUpdate));
  }

  function getElectricityHourlySeries(state) {
    const rawToday = Array.isArray(state?.attributes?.raw_today) ? state.attributes.raw_today : [];
    const rawTomorrow = Array.isArray(state?.attributes?.raw_tomorrow) ? state.attributes.raw_tomorrow : [];
    const source = [...rawToday, ...rawTomorrow];
    if (!source.length) return [];

    const hourly = new Map();
    source.forEach((entry) => {
      const price = toNumber(entry?.price);
      const date = entry?.hour ? new Date(entry.hour) : null;
      if (price == null || !date || Number.isNaN(date.getTime())) return;

      const hourKey = date.toISOString().slice(0, 13);
      const bucket = hourly.get(hourKey) || {
        time: date.getTime(),
        label: date.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }).slice(0, 2),
        prices: [],
      };
      bucket.prices.push(price);
      hourly.set(hourKey, bucket);
    });

    const currentHour = new Date();
    currentHour.setMinutes(0, 0, 0);
    const currentHourTime = currentHour.getTime();

    return Array.from(hourly.values())
      .map((bucket) => ({
        time: bucket.time,
        label: bucket.label,
        value: bucket.prices.reduce((sum, price) => sum + price, 0) / bucket.prices.length,
      }))
      .filter((bucket) => bucket.time >= currentHourTime)
      .slice(0, 8);
  }

  function getChargerStatusMeta(state) {
    const labels = {
      disconnected: "Ikke tilsluttet",
      charging: "Lader",
      ready_to_charge: "Klar til ladning",
      awaiting_start: "Venter på start",
      complete: "Færdig",
      paused: "Sat på pause",
      error: "Fejl",
    };
    const rawState = String(state?.state || "").trim();
    const fallback = rawState ? rawState.replace(/_/g, " ") : "Ukendt";
    return {
      label: labels[rawState] || fallback.charAt(0).toUpperCase() + fallback.slice(1),
      detail: state?.attributes?.friendly_name || "Ladestander",
    };
  }

  function getChargerStatusMeta(state) {
    const rawState = String(state?.state || "").trim();
    const fallback = rawState ? rawState.replace(/_/g, " ") : "Ukendt";
    return {
      label: fallback.charAt(0).toUpperCase() + fallback.slice(1),
      detail: state?.attributes?.friendly_name || "Ladestander",
    };
  }

  function getNextWastePickup() {
    const candidates = systemStatusConfig.waste
      .map((entityId) => getSystemState(entityId))
      .filter(Boolean)
      .map((state) => ({
        state,
        days: toNumber(state.state),
      }))
      .filter((entry) => entry.days != null)
      .sort((a, b) => a.days - b.days);

    return candidates[0] || null;
  }

  function getActiveRoomNames() {
    return rooms
      .filter((room) => {
        const hasLightOn = getRoomLightEntries(room).some(({ state }) => isOn(state));
        return hasLightOn || isHeating(getRoomClimateState(room)) || isActivePlayback(getRoomMediaState(room));
      })
      .map((room) => room.name);
  }

  function getHeatingRooms() {
    return rooms
      .filter((room) => isHeating(getRoomClimateState(room)))
      .map((room) => room.name);
  }

  function getWarmestRoom() {
    const candidates = rooms
      .map((room) => ({
        room: room.name,
        value: toNumber(getRoomClimateState(room)?.attributes?.current_temperature),
      }))
      .filter((entry) => entry.value != null)
      .sort((a, b) => b.value - a.value);
    return candidates[0] || null;
  }

  function getPrimaryNowPlaying() {
    const active = mediaItems
      .map((item) => ({
        item,
        state: stateCache.get(item.entity_id) || null,
      }))
      .find(({ state }) => isActivePlayback(state));

    if (!active) return null;

    return {
      label: active.item.label,
      line: formatMediaLine(active.state),
    };
  }

  async function getState(entityId) {
    const response = await fetch(`/api/ha/states/${encodeURIComponent(entityId)}`, {
      headers: proxyHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Kunne ikke hente state for ${entityId} (${response.status})`);
    }

    const json = await response.json();
    stateCache.set(entityId, json);
    failedEntities.delete(entityId);
    return json;
  }

  async function fetchHistory(entityIds, start, end) {
    const params = new URLSearchParams();
    params.set("start", start);
    if (end) params.set("end", end);
    params.set("filter_entity_id", entityIds.join(","));
    params.set("minimal_response", "1");
    params.set("no_attributes", "1");

    const response = await fetch(`/api/ha/history?${params.toString()}`, {
      headers: proxyHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Historikhentning fejlede (${response.status})`);
    }

    return response.json();
  }

  function getTechnicalHistoryEntityMap() {
    return {
      ram: systemStatusConfig.unraid.ram,
      cpu: systemStatusConfig.unraid.cpu,
      cpuTemp: systemStatusConfig.unraid.cpuTemp,
    };
  }

  async function fetchTechnicalHistory() {
    const entityMap = getTechnicalHistoryEntityMap();
    const entityIds = Object.values(entityMap).filter(Boolean);
    if (!entityIds.length) return;

    const end = new Date();
    const start = new Date(end.getTime() - technicalHistoryWindowMs);
    const payload = await fetchHistory(entityIds, start.toISOString(), end.toISOString());
    const seriesList = Array.isArray(payload) ? payload : [];
    const keyByEntityId = new Map(Object.entries(entityMap).map(([key, entityId]) => [entityId, key]));

    Object.keys(entityMap).forEach((key) => setTechnicalHistory(key, []));

    seriesList.forEach((series) => {
      if (!Array.isArray(series) || !series.length) return;
      const entityId = series[0]?.entity_id;
      const key = keyByEntityId.get(entityId);
      if (!key) return;

      const points = series
        .map((entry) => ({
          value: toNumber(entry?.state),
          timestamp: new Date(entry?.last_changed || entry?.last_updated || 0).getTime(),
        }))
        .filter((entry) => Number.isFinite(entry.value) && Number.isFinite(entry.timestamp));

      setTechnicalHistory(key, points);
    });
  }

  async function callService(domain, service, payload) {
    const response = await fetch(`/api/ha/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
      method: "POST",
      headers: proxyHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Servicekald fejlede: ${domain}.${service}`);
    }

    return response.json();
  }

  async function fetchHaConfigMeta() {
    const response = await fetch("/api/ha/config", {
      headers: proxyHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Kunne ikke hente Home Assistant konfiguration (${response.status})`);
    }

    return response.json();
  }

  async function fetchWeatherForecast(type = "daily") {
    if (!systemStatusConfig.weather) return [];

    const response = await fetch("/api/ha/services/weather/get_forecasts?return_response", {
      method: "POST",
      headers: proxyHeaders(),
      body: JSON.stringify({
        entity_id: [systemStatusConfig.weather],
        type,
      }),
    });

    if (!response.ok) {
      throw new Error(`Kunne ikke hente vejrudsigt (${response.status})`);
    }

    const payload = await response.json();
    return payload?.service_response?.[systemStatusConfig.weather]?.forecast || [];
  }

  function saveSpotifyToken(token) {
    localStorage.setItem(spotifyStorageKeys.accessToken, token.access_token);
    if (token.refresh_token) {
      localStorage.setItem(spotifyStorageKeys.refreshToken, token.refresh_token);
    }
    if (token.expires_in) {
      localStorage.setItem(
        spotifyStorageKeys.expiresAt,
        String(Date.now() + Math.max(token.expires_in - 60, 0) * 1000)
      );
    }
  }

  async function refreshSpotifyAccessTokenIfNeeded() {
    const clientId = config.spotify?.clientId;
    if (!clientId) return null;

    const accessToken = localStorage.getItem(spotifyStorageKeys.accessToken);
    const expiresAt = Number(localStorage.getItem(spotifyStorageKeys.expiresAt) || 0);
    if (accessToken && Date.now() < expiresAt) {
      return accessToken;
    }

    const refreshToken = localStorage.getItem(spotifyStorageKeys.refreshToken);
    if (!refreshToken) {
      return null;
    }

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`Spotify refresh fejlede (${response.status})`);
    }

    const token = await response.json();
    saveSpotifyToken({
      ...token,
      refresh_token: token.refresh_token || refreshToken,
    });
    return localStorage.getItem(spotifyStorageKeys.accessToken);
  }

  async function spotifyFetch(url) {
    const token = await refreshSpotifyAccessTokenIfNeeded();
    if (!token) return null;

    const response = await fetch(`https://api.spotify.com/v1${url}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401) {
      localStorage.removeItem(spotifyStorageKeys.accessToken);
      localStorage.removeItem(spotifyStorageKeys.expiresAt);
      throw new Error("Spotify-login er udløbet. Log ind igen på spotify-test.html.");
    }

    if (!response.ok) {
      throw new Error(`Spotify playlist-hentning fejlede (${response.status})`);
    }

    return response.json();
  }

  async function fetchSpotifyPlaylists() {
    if (spotifyPlaylistCache.loaded) {
      return spotifyPlaylistCache.items;
    }

    if (spotifyPlaylistCache.loading) {
      return spotifyPlaylistCache.loading;
    }

    spotifyPlaylistCache.loading = (async () => {
      const fallback = getSpotifyPlaylistsFromConfig();

      try {
        let offset = 0;
        const allItems = [];
        spotifyPlaylistCache.error = "";

        while (true) {
          const payload = await spotifyFetch(`/me/playlists?limit=50&offset=${offset}`);
          if (!payload) {
            spotifyPlaylistCache.items = fallback;
            spotifyPlaylistCache.loaded = true;
            spotifyPlaylistCache.error = "Ingen Spotify-session fundet på denne side endnu.";
            return spotifyPlaylistCache.items;
          }

          const items = Array.isArray(payload.items) ? payload.items : [];
          allItems.push(
            ...items
              .filter((playlist) => playlist?.uri && playlist?.name)
              .map((playlist) => ({
                label: playlist.name,
                value: playlist.uri,
              }))
          );

          if (!payload.next || items.length === 0) {
            break;
          }

          offset += items.length;
        }

        let sortedItems = allItems;
        try {
          const recentPlaylists = await fetchSpotifyRecentPlaylistActivity();
          if (recentPlaylists.size) {
            sortedItems = allItems
              .map((playlist, index) => ({
                ...playlist,
                recentPlayedAt: recentPlaylists.get(playlist.value) || 0,
                originalIndex: index,
              }))
              .sort((left, right) => {
                if (right.recentPlayedAt !== left.recentPlayedAt) {
                  return right.recentPlayedAt - left.recentPlayedAt;
                }
                return left.originalIndex - right.originalIndex;
              })
              .map(({ label, value }) => ({ label, value }));
          }
        } catch (error) {
          console.warn("Spotify recent playlist-sortering blev sprunget over.", error);
        }

        spotifyPlaylistCache.items = sortedItems.length ? sortedItems : fallback;
        spotifyPlaylistCache.loaded = true;
        if (!allItems.length && !fallback.length) {
          spotifyPlaylistCache.error = "Spotify returnerede ingen playlister for den aktuelle konto.";
        }
        return spotifyPlaylistCache.items;
      } catch (error) {
        console.error(error);
        spotifyPlaylistCache.items = fallback;
        spotifyPlaylistCache.loaded = true;
        spotifyPlaylistCache.error = error.message || "Ukendt Spotify-fejl.";
        return spotifyPlaylistCache.items;
      } finally {
        spotifyPlaylistCache.loading = null;
      }
    })();

    return spotifyPlaylistCache.loading;
  }

  async function fetchSpotifyRecentPlaylistActivity() {
    if (spotifyRecentPlaylistCache.loaded) {
      return spotifyRecentPlaylistCache.playedAtByPlaylist;
    }

    if (spotifyRecentPlaylistCache.loading) {
      return spotifyRecentPlaylistCache.loading;
    }

    spotifyRecentPlaylistCache.loading = (async () => {
      const playedAtByPlaylist = new Map();

      try {
        let before = null;
        let pageCount = 0;

        while (pageCount < 3) {
          const query = new URLSearchParams({ limit: "50" });
          if (before) {
            query.set("before", String(before));
          }

          const payload = await spotifyFetch(`/me/player/recently-played?${query.toString()}`);
          const items = Array.isArray(payload?.items) ? payload.items : [];
          if (!items.length) {
            break;
          }

          items.forEach((entry) => {
            const playlistUri = entry?.context?.type === "playlist" ? entry.context?.uri : "";
            const playedAt = playlistUri ? new Date(entry?.played_at || "").getTime() : 0;
            if (!playlistUri || !Number.isFinite(playedAt)) {
              return;
            }

            const existing = playedAtByPlaylist.get(playlistUri) || 0;
            if (playedAt > existing) {
              playedAtByPlaylist.set(playlistUri, playedAt);
            }
          });

          const lastPlayedAt = new Date(items[items.length - 1]?.played_at || "").getTime();
          if (!Number.isFinite(lastPlayedAt)) {
            break;
          }

          before = lastPlayedAt;
          pageCount += 1;
          if (items.length < 50) {
            break;
          }
        }
      } catch (error) {
        console.warn("Kunne ikke hente Spotify recently played til playlist-sortering.", error);
      } finally {
        spotifyRecentPlaylistCache.playedAtByPlaylist = playedAtByPlaylist;
        spotifyRecentPlaylistCache.loaded = true;
        spotifyRecentPlaylistCache.loading = null;
      }

      return spotifyRecentPlaylistCache.playedAtByPlaylist;
    })();

    return spotifyRecentPlaylistCache.loading;
  }

  function extractSpotifyPlaylistId(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    const uriMatch = raw.match(/^spotify:playlist:([A-Za-z0-9]+)$/i);
    if (uriMatch) return uriMatch[1];

    const urlMatch = raw.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/i);
    if (urlMatch) return urlMatch[1];

    return "";
  }

  async function fetchSpotifyPlaylistTracks(playlistRef) {
    const playlistId = extractSpotifyPlaylistId(playlistRef);
    if (!playlistId) return [];

    if (spotifyTrackCache.itemsByPlaylist.has(playlistId)) {
      return spotifyTrackCache.itemsByPlaylist.get(playlistId);
    }

    if (spotifyTrackCache.loadingByPlaylist.has(playlistId)) {
      return spotifyTrackCache.loadingByPlaylist.get(playlistId);
    }

    const loading = (async () => {
      try {
        let offset = 0;
        const allItems = [];
        spotifyTrackCache.errorByPlaylist.delete(playlistId);

        while (true) {
          const payload = await spotifyFetch(`/playlists/${playlistId}/tracks?limit=100&offset=${offset}`);
          if (!payload) {
            spotifyTrackCache.itemsByPlaylist.set(playlistId, []);
            return [];
          }

          const items = Array.isArray(payload.items) ? payload.items : [];
          const mapped = items
            .map((item, index) => {
              const track = item?.track;
              if (!track?.uri || !track?.name || track?.is_local) return null;
              const artists = Array.isArray(track.artists)
                ? track.artists.map((artist) => artist?.name).filter(Boolean).join(" - ")
                : "";
              return {
                label: `${offset + index + 1}. ${track.name}${artists ? ` - ${artists}` : ""}`,
                value: track.uri,
              };
            })
            .filter(Boolean);

          allItems.push(...mapped);

          if (!payload.next || items.length === 0) {
            break;
          }

          offset += items.length;
        }

        spotifyTrackCache.itemsByPlaylist.set(playlistId, allItems);
        return allItems;
      } catch (error) {
        console.error(error);
        spotifyTrackCache.itemsByPlaylist.set(playlistId, []);
        spotifyTrackCache.errorByPlaylist.set(playlistId, error.message || "Ukendt Spotify-fejl.");
        return [];
      } finally {
        spotifyTrackCache.loadingByPlaylist.delete(playlistId);
      }
    })();

    spotifyTrackCache.loadingByPlaylist.set(playlistId, loading);
    return loading;
  }

  function createButton(label, className, onClick) {
    const button = document.createElement("button");
    button.className = `btn ${className || ""}`.trim();
    button.textContent = label;
    button.addEventListener("click", async () => {
      try {
        button.disabled = true;
        await onClick();
      } catch (error) {
        console.error(error);
        setStatus("error", "Fejl");
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  function createSlider(label, value, onChange) {
    const wrapper = document.createElement("div");
    wrapper.className = "slider-group";

    const labelRow = document.createElement("div");
    labelRow.className = "slider-label";
    labelRow.innerHTML = `<span>${label}</span><span>${value}%</span>`;

    const slider = document.createElement("input");
    slider.className = "slider";
    slider.type = "range";
    slider.min = "1";
    slider.max = "100";
    slider.value = String(value);
    slider.addEventListener("change", onChange);

    wrapper.appendChild(labelRow);
    wrapper.appendChild(slider);
    return wrapper;
  }

  function createSelect(label, options, selectedValue, onChange) {
    const wrapper = document.createElement("div");
    wrapper.className = "select-group";

    const caption = document.createElement("label");
    caption.className = "select-label";
    caption.textContent = label;

    const select = document.createElement("select");
    select.className = "select-input";
    options.forEach((option) => {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      if (option.value === selectedValue) {
        node.selected = true;
      }
      select.appendChild(node);
    });
    select.addEventListener("change", onChange);

    wrapper.appendChild(caption);
    wrapper.appendChild(select);
    return wrapper;
  }

  function noteSpotifyInteraction() {
    spotifyUiState.lastInteractionAt = Date.now();
  }

  function createTrackList(label, items, selectedValue, storageKey, onSelect) {
    const wrapper = document.createElement("div");
    wrapper.className = "select-group";

    const caption = document.createElement("label");
    caption.className = "select-label";
    caption.textContent = label;

    const list = document.createElement("div");
    list.className = "spotify-track-list";
    list.addEventListener("scroll", () => {
      noteSpotifyInteraction();
      spotifyUiState.trackScrollTopByItem.set(storageKey, list.scrollTop);
    });
    list.addEventListener("pointerdown", noteSpotifyInteraction);
    list.addEventListener("wheel", noteSpotifyInteraction, { passive: true });

    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `spotify-track-item${item.value === selectedValue ? " is-selected" : ""}`;
      button.textContent = item.label;
      button.addEventListener("focus", noteSpotifyInteraction);
      button.addEventListener("click", () => {
        noteSpotifyInteraction();
        list.querySelectorAll(".spotify-track-item").forEach((node) => node.classList.remove("is-selected"));
        button.classList.add("is-selected");
        spotifyUiState.trackScrollTopByItem.set(storageKey, list.scrollTop);
        onSelect(item.value);
      });
      list.appendChild(button);
    });

    const savedScrollTop = spotifyUiState.trackScrollTopByItem.get(storageKey);
    if (typeof savedScrollTop === "number" && savedScrollTop > 0) {
      list.scrollTop = savedScrollTop;
    }

    wrapper.appendChild(caption);
    wrapper.appendChild(list);
    return wrapper;
  }

  function getMediaArtworkSource(state) {
    const raw = state?.attributes?.entity_picture || state?.attributes?.media_image_url || "";
    if (!raw) return null;
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return { url: raw, requiresHeaders: false };
    }
    let normalized = raw.trim();
    if (normalized.startsWith("%2F") || normalized.startsWith("%2f")) {
      try {
        normalized = decodeURIComponent(normalized);
      } catch {
        // Keep original value if it cannot be decoded cleanly.
      }
    }
    normalized = normalized.startsWith("/") ? normalized : `/${normalized}`;
    return {
      url: `/api/ha/image?path=${encodeURIComponent(normalized)}`,
      requiresHeaders: true,
    };
  }

  async function resolveMediaArtworkUrl(state) {
    const source = getMediaArtworkSource(state);
    if (!source?.url) return "";
    if (!source.requiresHeaders) return source.url;

    if (mediaArtworkCache.has(source.url)) {
      return mediaArtworkCache.get(source.url);
    }

    try {
      const response = await fetch(source.url, {
        headers: proxyHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Artwork fetch fejlede (${response.status})`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      mediaArtworkCache.set(source.url, objectUrl);
      return objectUrl;
    } catch (error) {
      console.error(error);
      return "";
    }
  }

  function createMediaProgressBlock(entityId, state) {
    const mediaPosition = getLiveMediaPosition(state);
    const mediaDuration = Number(state?.attributes?.media_duration);
    if (!Number.isFinite(mediaPosition) || !Number.isFinite(mediaDuration) || mediaDuration <= 0) {
      return null;
    }

    const progress = Math.min(100, Math.max(0, (mediaPosition / mediaDuration) * 100));
    const progressBlock = document.createElement("div");
    progressBlock.className = "media-progress";
    progressBlock.innerHTML = `
      <div class="media-progress-times">
        <span>${formatDuration(mediaPosition)}</span>
        <span>${formatDuration(Math.max(0, mediaDuration - mediaPosition), "-")}</span>
      </div>
      <div class="media-progress-track">
        <div class="media-progress-fill" style="width: ${progress}%"></div>
        <div class="media-progress-thumb" style="left: ${progress}%"></div>
      </div>
    `;
    attachSeekBehavior(progressBlock.querySelector(".media-progress-track"), entityId, mediaDuration);
    return progressBlock;
  }

  async function createSpotifyNowPlayingCard(sourceItem, sourceState) {
    const block = document.createElement("section");
    block.className = `spotify-now-playing${isActivePlayback(sourceState) ? " is-active" : ""}`;
    block.dataset.sourceEntity = sourceItem?.entity_id || "";

    const artworkUrl = await resolveMediaArtworkUrl(sourceState);
    const title = sourceState?.attributes?.media_title || "Ingen titel";
    const artist = sourceState?.attributes?.media_artist || "Ingen kunstner";
    const stateLabel = sourceState?.state || "ukendt";
    const subtitle = sourceItem ? `${sourceItem.label} (${sourceItem.room})` : "Spotify";
    const signature = [sourceItem?.entity_id || "", title, artist, stateLabel, artworkUrl].join("|");
    block.dataset.signature = signature;

    block.innerHTML = `
      <div class="spotify-now-playing-main">
        ${
          artworkUrl
            ? `<div class="spotify-now-playing-cover"><img src="${artworkUrl}" alt="${title}" /></div>`
            : `<div class="spotify-now-playing-cover spotify-now-playing-cover-placeholder">♪</div>`
        }
        <div class="spotify-now-playing-copy">
          <div class="spotify-now-playing-meta">
            <span class="chip-label">${subtitle}</span>
            <span class="media-card-state">${stateLabel}</span>
          </div>
          <div class="media-track">${title}</div>
          <div class="media-artist">${artist}</div>
        </div>
      </div>
    `;

    const sourceEntityId = sourceItem?.entity_id;
    const progressBlock = sourceEntityId ? createMediaProgressBlock(sourceEntityId, sourceState) : null;
    if (progressBlock) {
      block.appendChild(progressBlock);
    }

    if (sourceEntityId) {
      const controls = document.createElement("div");
      controls.className = "entity-controls";
      controls.appendChild(
        createButton(isActivePlayback(sourceState) ? "Pause" : "Afspil", "btn-primary", async () => {
          await callService("media_player", "media_play_pause", { entity_id: sourceEntityId });
          await refreshEntities([sourceEntityId]);
        })
      );
      controls.appendChild(
        createButton("Forrige", "", async () => {
          await callService("media_player", "media_previous_track", { entity_id: sourceEntityId });
          await refreshEntities([sourceEntityId]);
        })
      );
      controls.appendChild(
        createButton("Næste", "", async () => {
          await callService("media_player", "media_next_track", { entity_id: sourceEntityId });
          await refreshEntities([sourceEntityId]);
        })
      );
      block.appendChild(controls);

      const volume = getMediaVolumePercent(sourceItem, sourceState);
      if (volume != null) {
        block.appendChild(
          createSlider("Volumen", volume, async (event) => {
            await callService("media_player", "volume_set", {
              entity_id: sourceEntityId,
              volume_level: Number(event.target.value) / 100,
            });
            await refreshEntities([sourceEntityId]);
          })
        );
      }
    }

    return block;
  }

  function patchMediaProgress(container, entityId, state) {
    if (!container) return;

    const nextBlock = createMediaProgressBlock(entityId, state);
    const existingBlock = container.querySelector(".media-progress");

    if (!nextBlock && existingBlock) {
      existingBlock.remove();
      return;
    }

    if (!nextBlock) return;

    if (!existingBlock) {
      container.appendChild(nextBlock);
      return;
    }

    const nextTimes = nextBlock.querySelector(".media-progress-times")?.innerHTML || "";
    const currentTimes = existingBlock.querySelector(".media-progress-times");
    if (currentTimes) {
      currentTimes.innerHTML = nextTimes;
    }

    const nextFill = nextBlock.querySelector(".media-progress-fill")?.style.width || "0%";
    const currentFill = existingBlock.querySelector(".media-progress-fill");
    if (currentFill) {
      currentFill.style.width = nextFill;
    }

    const nextThumb = nextBlock.querySelector(".media-progress-thumb")?.style.left || "0%";
    const currentThumb = existingBlock.querySelector(".media-progress-thumb");
    if (currentThumb) {
      currentThumb.style.left = nextThumb;
    }
  }

  async function patchSpotifyNowPlaying(existingBlock, sourceItem, sourceState) {
    if (!existingBlock) return;

    const artworkUrl = await resolveMediaArtworkUrl(sourceState);
    const title = sourceState?.attributes?.media_title || "Ingen titel";
    const artist = sourceState?.attributes?.media_artist || "Ingen kunstner";
    const stateLabel = sourceState?.state || "ukendt";
    const sourceEntityId = sourceItem?.entity_id || "";
    const nextSignature = [sourceEntityId, title, artist, stateLabel, artworkUrl].join("|");

    if (existingBlock.dataset.sourceEntity !== sourceEntityId || existingBlock.dataset.signature !== nextSignature) {
      const replacement = await createSpotifyNowPlayingCard(sourceItem, sourceState);
      existingBlock.replaceWith(replacement);
      return;
    }

    if (sourceEntityId) {
      patchMediaProgress(existingBlock, sourceEntityId, sourceState);
    }

    const volume = getMediaVolumePercent(sourceItem, sourceState);
    const volumeSlider = existingBlock.querySelector('input[type="range"]');
    const volumeValue = volumeSlider?.closest(".slider-group")?.querySelector(".slider-value");
    if (volume != null && volumeSlider && document.activeElement !== volumeSlider) {
      volumeSlider.value = String(volume);
      if (volumeValue) {
        volumeValue.textContent = `${volume}%`;
      }
    }
  }

  function createTogglePill(label, active, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn spotify-group-pill${active ? " is-selected" : ""}`;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function createChartBars(series, formatter = (value) => String(value), currentIndex = 0) {
    const wrapper = document.createElement("div");
    wrapper.className = "hero-chart";

    if (!series.length) {
      const empty = document.createElement("div");
      empty.className = "entity-secondary";
      empty.textContent = "Ingen data endnu.";
      wrapper.appendChild(empty);
      return wrapper;
    }

    const maxValue = Math.max(...series.map((item) => item.value), 1);
    const bars = document.createElement("div");
    bars.className = "hero-chart-bars";

    series.forEach((item, index) => {
      const column = document.createElement("div");
      column.className = `hero-chart-column${index === currentIndex ? " is-current" : ""}`;
      column.innerHTML = `
        <div class="hero-chart-bar-wrap">
          <div class="hero-chart-bar" style="height: ${Math.max(16, (item.value / maxValue) * 100)}%"></div>
        </div>
        <div class="hero-chart-axis">${item.label}</div>
      `;
      column.title = `${item.label}: ${formatter(item.value)}`;
      column.setAttribute("aria-label", `${item.label}: ${formatter(item.value)}`);
      column.tabIndex = 0;
      bars.appendChild(column);
    });

    wrapper.appendChild(bars);
    return wrapper;
  }

  function createHeroInsightCard({ label, value, secondary = "", active = false, chart = null, pill = "", onClick = null }) {
    const card = document.createElement("article");
    card.className = `hero-card hero-card-insight${active ? " is-active" : ""}${onClick ? " is-clickable" : ""}`;
    card.innerHTML = `
      <div class="hero-card-top">
        <div class="hero-card-label">${label}</div>
        ${pill ? `<div class="hero-card-pill">${pill}</div>` : ""}
      </div>
      <div class="hero-card-value">${value}</div>
      <div class="entity-secondary">${secondary}</div>
    `;

    if (chart) {
      card.appendChild(chart);
    }

    if (onClick) {
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${label}: åbner detaljer`);
      card.addEventListener("click", onClick);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      });
    }

    return card;
  }

  function localDateKey(date = new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: config.timeZone || "Europe/Copenhagen",
    }).format(date);
  }

  function getIsoWeekNumber(dateKey) {
    const date = new Date(`${dateKey}T12:00:00Z`);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  }

  function selectCurrentMealPlan(plans) {
    const today = localDateKey();
    const normalized = plans
      .filter((plan) => plan && Array.isArray(plan.days) && plan.days.length)
      .map((plan) => ({
        ...plan,
        firstDate: plan.days.map((day) => day.date).filter(Boolean).sort()[0] || plan.startDate,
        lastDate: plan.days.map((day) => day.date).filter(Boolean).sort().at(-1) || plan.startDate,
      }))
      .filter((plan) => plan.firstDate && plan.lastDate)
      .sort((left, right) => left.firstDate.localeCompare(right.firstDate));

    return (
      normalized.find((plan) => plan.firstDate <= today && plan.lastDate >= today) ||
      normalized.find((plan) => plan.firstDate > today) ||
      normalized.at(-1) ||
      null
    );
  }

  function openMealPlanner() {
    window.open(mealPlannerConfig.webUrl, "_blank", "noopener,noreferrer");
  }

  function createMealPlanCard() {
    const plan = mealPlanState.plan;
    const card = document.createElement("article");
    card.className = `hero-card hero-card-meal-plan${plan ? " is-active" : ""}${mealPlannerConfig.webUrl ? " is-clickable" : ""}`;

    const header = document.createElement("div");
    header.className = "hero-card-top";
    const label = document.createElement("div");
    label.className = "hero-card-label";
    label.textContent = "Ugens madplan";
    header.appendChild(label);

    if (plan?.startDate) {
      const pill = document.createElement("div");
      pill.className = "hero-card-pill";
      pill.textContent = `Uge ${getIsoWeekNumber(plan.startDate)}`;
      header.appendChild(pill);
    }

    card.appendChild(header);

    if (plan) {
      const days = document.createElement("div");
      days.className = "meal-plan-days";
      const today = localDateKey();

      plan.days.forEach((day) => {
        const item = document.createElement("div");
        item.className = `meal-plan-day${day.date === today ? " is-today" : ""}`;
        const weekday = document.createElement("div");
        weekday.className = "meal-plan-weekday";
        weekday.textContent = day.weekday || "Dag";
        const meal = document.createElement("div");
        meal.className = "meal-plan-meal";
        meal.textContent = day.mealName || "Ikke planlagt";
        item.append(weekday, meal);
        days.appendChild(item);
      });

      card.appendChild(days);
    } else {
      const message = document.createElement("div");
      message.className = "entity-secondary meal-plan-message";
      message.textContent = mealPlanState.loading
        ? "Henter madplanen…"
        : mealPlanState.error || "Der er ikke lavet en madplan endnu.";
      card.appendChild(message);
    }

    if (mealPlannerConfig.webUrl) {
      card.tabIndex = 0;
      card.setAttribute("role", "link");
      card.setAttribute("aria-label", "Ugens madplan: åbn Meal Planner");
      card.addEventListener("click", openMealPlanner);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openMealPlanner();
        }
      });
    }

    return card;
  }

  async function fetchMealPlan() {
    mealPlanState.loading = true;
    mealPlanState.error = "";

    try {
      const response = await fetch(mealPlannerConfig.endpoint);
      if (!response.ok) {
        throw new Error(`Madplanshentning fejlede (${response.status})`);
      }
      const payload = await response.json();
      mealPlanState.plan = selectCurrentMealPlan(Array.isArray(payload.plans) ? payload.plans : []);
    } catch (error) {
      console.error(error);
      mealPlanState.error = "Madplanen er midlertidigt utilgængelig.";
    } finally {
      mealPlanState.loading = false;
    }
  }

  function ensureWeatherModal() {
    if (weatherModalElements) return weatherModalElements;

    const overlay = document.createElement("div");
    overlay.className = "weather-modal-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="weather-modal" role="dialog" aria-modal="true" aria-labelledby="weatherModalTitle">
        <button class="weather-modal-close" type="button" aria-label="Luk vejrudsigt">×</button>
        <div class="weather-modal-header">
          <div>
            <div class="weather-modal-title" id="weatherModalTitle">Vejrudsigt</div>
            <div class="weather-modal-subtitle" id="weatherModalSubtitle">Henter data...</div>
          </div>
        </div>
        <div class="weather-modal-body" id="weatherModalBody"></div>
      </div>
    `;

    const closeButton = overlay.querySelector(".weather-modal-close");
    if (closeButton) {
      closeButton.innerHTML = "&times;";
      closeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeWeatherModal();
      });
    }

    overlay.addEventListener("click", (event) => {
      if (event.target.closest(".weather-modal-close")) {
        closeWeatherModal();
        return;
      }

      if (!event.target.closest(".weather-modal")) {
        closeWeatherModal();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && weatherUiState.isOpen) {
        closeWeatherModal();
      }
    });

    document.body.appendChild(overlay);
    weatherModalElements = {
      overlay,
      subtitle: overlay.querySelector("#weatherModalSubtitle"),
      body: overlay.querySelector("#weatherModalBody"),
    };
    return weatherModalElements;
  }

  function renderWeatherModal() {
    const modal = ensureWeatherModal();
    const weatherState = getSystemState(systemStatusConfig.weather);
    const subtitleParts = [];
    const locationLabel = weatherUiState.locationName || "Hjem";
    subtitleParts.push(locationLabel);
    if (weatherUiState.country) {
      subtitleParts.push(weatherUiState.country);
    }

    modal.subtitle.textContent = subtitleParts.join(", ");
    modal.overlay.hidden = !weatherUiState.isOpen;
    modal.overlay.style.display = weatherUiState.isOpen ? "grid" : "none";
    document.body.classList.toggle("modal-open", weatherUiState.isOpen);

    if (!weatherUiState.isOpen) {
      return;
    }

    if (weatherUiState.loading) {
      modal.body.innerHTML = '<div class="empty-state">Henter vejrdata...</div>';
      return;
    }

    if (weatherUiState.error) {
      modal.body.innerHTML = `<div class="empty-state">${weatherUiState.error}</div>`;
      return;
    }

    if (!weatherState) {
      modal.body.innerHTML = '<div class="empty-state">Ingen vejrdata fundet endnu.</div>';
      return;
    }

    const metrics = [
      { label: "Temperatur", value: formatTemp(weatherState.attributes?.temperature), detail: formatWeatherState(weatherState.state) },
      { label: "Luftfugtighed", value: formatHumidity(weatherState.attributes?.humidity), detail: "Aktuelt nu" },
      { label: "Vind", value: formatSpeed(weatherState.attributes?.wind_speed, weatherState.attributes?.wind_speed_unit || "km/h"), detail: `${formatCompassDirection(weatherState.attributes?.wind_bearing)} vindretning` },
      { label: "Lufttryk", value: formatPressure(weatherState.attributes?.pressure), detail: weatherState.attributes?.pressure_unit || "hPa" },
      { label: "Skydække", value: formatHumidity(weatherState.attributes?.cloud_coverage), detail: "Skyer" },
      { label: "UV-index", value: toNumber(weatherState.attributes?.uv_index)?.toFixed(1) || "--", detail: "Solstyrke" },
    ];

    const forecastMarkup = weatherUiState.forecast.length
      ? weatherUiState.forecast
          .slice(0, 5)
          .map((entry) => {
            const tempHigh = toNumber(entry.temperature);
            const tempLow = toNumber(entry.templow);
            const wind = formatSpeed(entry.wind_speed, weatherState.attributes?.wind_speed_unit || "km/h");
            return `
              <div class="weather-forecast-row">
                <div class="weather-forecast-day">${formatForecastDay(entry.datetime)}</div>
                <div class="weather-forecast-condition">${formatWeatherState(entry.condition)}</div>
                <div class="weather-forecast-meta">
                  <span>${tempHigh != null ? `${Math.round(tempHigh)}°` : "--"}</span>
                  <span>${tempLow != null ? `${Math.round(tempLow)}°` : "--"}</span>
                  <span>${wind}</span>
                </div>
              </div>
            `;
          })
          .join("")
      : '<div class="empty-state">Ingen prognose fundet endnu.</div>';

    const radarUrl =
      weatherUiState.latitude != null && weatherUiState.longitude != null
        ? `https://embed.windy.com/embed2.html?lat=${encodeURIComponent(weatherUiState.latitude)}&lon=${encodeURIComponent(
            weatherUiState.longitude
          )}&detailLat=${encodeURIComponent(weatherUiState.latitude)}&detailLon=${encodeURIComponent(
            weatherUiState.longitude
          )}&width=650&height=450&zoom=8&level=surface&overlay=radar&product=radar&menu=&message=true&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=m%2Fs&metricTemp=%C2%B0C&radarRange=-1&play=1`
        : "";

    modal.body.innerHTML = `
      <div class="weather-modal-layout">
        <section class="weather-summary-grid">
          ${metrics
            .map(
              (item) => `
                <article class="weather-metric-card">
                  <div class="weather-metric-label">${item.label}</div>
                  <div class="weather-metric-value">${item.value}</div>
                  <div class="weather-metric-detail">${item.detail}</div>
                </article>
              `
            )
            .join("")}
        </section>
        <section class="weather-forecast-panel">
          <div class="weather-section-title">5-dages prognose</div>
          <div class="weather-forecast-list">
            ${forecastMarkup}
          </div>
        </section>
        <section class="weather-radar-panel">
          <div class="weather-section-title">Radar</div>
          ${
            radarUrl
              ? `<div class="weather-radar-frame"><iframe src="${radarUrl}" title="Vejrradar" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>`
              : '<div class="empty-state">Radar kunne ikke klargøres endnu.</div>'
          }
        </section>
      </div>
    `;
  }

  function closeWeatherModal() {
    weatherUiState.isOpen = false;
    renderWeatherModal();
  }

  async function openWeatherModal() {
    weatherUiState.isOpen = true;
    weatherUiState.loading = true;
    weatherUiState.error = "";
    renderWeatherModal();

    try {
      const [haConfig, forecast] = await Promise.all([
        weatherUiState.locationName && weatherUiState.latitude != null && weatherUiState.longitude != null
          ? Promise.resolve({
              location_name: weatherUiState.locationName,
              latitude: weatherUiState.latitude,
              longitude: weatherUiState.longitude,
              country: weatherUiState.country,
            })
          : fetchHaConfigMeta(),
        fetchWeatherForecast("daily"),
      ]);

      weatherUiState.locationName = haConfig?.location_name || weatherUiState.locationName || "Hjem";
      weatherUiState.latitude = toNumber(haConfig?.latitude);
      weatherUiState.longitude = toNumber(haConfig?.longitude);
      weatherUiState.country = haConfig?.country || weatherUiState.country || "";
      weatherUiState.forecast = Array.isArray(forecast) ? forecast : [];
      weatherUiState.fetchedAt = Date.now();
    } catch (error) {
      console.error(error);
      weatherUiState.error = error.message || "Kunne ikke hente vejrdata.";
    } finally {
      weatherUiState.loading = false;
      renderWeatherModal();
    }
  }

  function createTechnicalMetricCard(title, value, subtitle, progress = null) {
    const card = document.createElement("article");
    card.className = "status-card";
    card.innerHTML = `
      <div class="status-card-title">${title}</div>
      <div class="status-card-value">${value}</div>
      <div class="entity-secondary">${subtitle}</div>
    `;

    if (progress != null) {
      const clamped = Math.max(0, Math.min(100, progress));
      const meter = document.createElement("div");
      meter.className = "mini-meter";
      meter.innerHTML = `<div class="mini-meter-fill" style="width: ${clamped}%"></div>`;
      card.appendChild(meter);
    }

    return card;
  }

  function createSparkline(values, { min = null, max = null, className = "" } = {}) {
    const points = values.filter((entry) => Number.isFinite(entry?.value));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 220 68");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("sparkline");
    if (className) svg.classList.add(className);

    if (!points.length) {
      return svg;
    }

    const chartMin = min != null ? min : Math.min(...points.map((entry) => entry.value));
    const chartMax = max != null ? max : Math.max(...points.map((entry) => entry.value));
    const paddedRange = Math.max(chartMax - chartMin, 1);
    const topPadding = 8;
    const bottomPadding = 10;
    const chartHeight = 68 - topPadding - bottomPadding;
    const stepX = points.length === 1 ? 0 : 220 / (points.length - 1);

    const coordinates = points.map((entry, index) => {
      const x = points.length === 1 ? 110 : index * stepX;
      const ratio = (entry.value - chartMin) / paddedRange;
      const y = topPadding + chartHeight - ratio * chartHeight;
      return { x, y };
    });

    const linePath = coordinates.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
    const areaPath = `${linePath} L ${coordinates[coordinates.length - 1].x.toFixed(2)} ${(68 - bottomPadding).toFixed(2)} L ${coordinates[0].x.toFixed(2)} ${(68 - bottomPadding).toFixed(2)} Z`;

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
    const gradientId = `sparkline-gradient-${Math.random().toString(36).slice(2, 9)}`;
    gradient.setAttribute("id", gradientId);
    gradient.setAttribute("x1", "0%");
    gradient.setAttribute("y1", "0%");
    gradient.setAttribute("x2", "0%");
    gradient.setAttribute("y2", "100%");

    const stopTop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stopTop.setAttribute("offset", "0%");
    stopTop.setAttribute("stop-color", "rgba(35, 229, 139, 0.34)");

    const stopBottom = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stopBottom.setAttribute("offset", "100%");
    stopBottom.setAttribute("stop-color", "rgba(35, 229, 139, 0.02)");

    gradient.appendChild(stopTop);
    gradient.appendChild(stopBottom);
    defs.appendChild(gradient);

    const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
    area.setAttribute("d", areaPath);
    area.setAttribute("fill", `url(#${gradientId})`);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", linePath);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#23e58b");
    line.setAttribute("stroke-width", "3");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");

    const latest = coordinates[coordinates.length - 1];
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", latest.x.toFixed(2));
    dot.setAttribute("cy", latest.y.toFixed(2));
    dot.setAttribute("r", "4");
    dot.setAttribute("fill", "#23e58b");

    svg.appendChild(defs);
    svg.appendChild(area);
    svg.appendChild(line);
    svg.appendChild(dot);
    return svg;
  }

  function attachSeekBehavior(trackElement, entityId, duration) {
    if (!trackElement || !entityId || !Number.isFinite(duration) || duration <= 0) {
      return;
    }

    const seekToPointer = async (clientX) => {
      const rect = trackElement.getBoundingClientRect();
      if (!rect.width) return;

      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const seekPosition = Math.round(duration * ratio);

      try {
        await callService("media_player", "media_seek", {
          entity_id: entityId,
          seek_position: seekPosition,
        });
        await refreshEntities([entityId]);
      } catch (error) {
        console.error(error);
        setStatus("error", "Fejl");
      }
    };

    let pointerDown = false;

    trackElement.addEventListener("pointerdown", async (event) => {
      pointerDown = true;
      trackElement.setPointerCapture?.(event.pointerId);
      await seekToPointer(event.clientX);
    });

    trackElement.addEventListener("pointermove", async (event) => {
      if (!pointerDown) return;
      await seekToPointer(event.clientX);
    });

    const endPointer = (event) => {
      pointerDown = false;
      trackElement.releasePointerCapture?.(event.pointerId);
    };

    trackElement.addEventListener("pointerup", endPointer);
    trackElement.addEventListener("pointercancel", endPointer);
  }

  function isInteractingWithMediaControls() {
    const activeElement = document.activeElement;
    return Boolean(activeElement && elements.mediaCards?.contains(activeElement));
  }

  function isInteractingWithSpotifyControls() {
    const activeElement = document.activeElement;
    return Boolean(
      (activeElement && elements.spotifyCards?.contains(activeElement)) ||
        Date.now() - spotifyUiState.lastInteractionAt < 2500
    );
  }

  function renderHeroStats() {
    elements.heroStats.innerHTML = "";

    const heatingRooms = getHeatingRooms();
    const warmestRoom = getWarmestRoom();
    const nowPlaying = getPrimaryNowPlaying();
    const weatherState = getSystemState(systemStatusConfig.weather);
    const electricityState = getSystemState(systemStatusConfig.electricity);
    const electricitySeries = getElectricityHourlySeries(electricityState);
    const chargerState = getSystemState(systemStatusConfig.charger);
    const chargerMeta = getChargerStatusMeta(chargerState);
    const nextWastePickup = getNextWastePickup();

    const cards = [
      createHeroInsightCard({
        label: "Vejrudsigt",
        value: weatherState ? formatTemp(weatherState.attributes?.temperature) : "--",
        secondary: weatherState
          ? `${formatWeatherState(weatherState.state)}${weatherState.attributes?.humidity != null ? ` · ${formatPercent(weatherState.attributes.humidity)}` : ""}`
          : "Ingen vejrdata endnu",
        pill: weatherState?.attributes?.friendly_name || "",
        active: Boolean(weatherState),
        onClick: weatherState ? openWeatherModal : null,
      }),
      createHeroInsightCard({
        label: "Elpris nu",
        value: electricityState ? `${formatPrice(electricityState.attributes?.current_price)} /kWh` : "--",
        secondary: electricityState
          ? `Lavest i dag ${formatPrice(electricityState.attributes?.today_min?.price)}`
          : "Ingen elprisdata endnu",
        pill: electricityState?.attributes?.region_code || "",
        chart: createChartBars(electricitySeries, (value) => `${formatPrice(value)} /kWh`),
      }),
      createHeroInsightCard({
        label: "Ladestander",
        value: chargerMeta.label,
        secondary: chargerMeta.detail,
        active: Boolean(chargerState && chargerState.state && chargerState.state !== "unknown" && chargerState.state !== "unavailable"),
      }),
      createHeroInsightCard({
        label: "Næste afhentning",
        value: nextWastePickup ? (nextWastePickup.state.attributes?.name || "Affald") : "Ingen data",
        secondary: nextWastePickup
          ? `${nextWastePickup.state.attributes?.duration || ""} · ${nextWastePickup.state.attributes?.date_short || ""}`
          : "Affaldskalender mangler data",
        active: Boolean(nextWastePickup && nextWastePickup.days != null && nextWastePickup.days <= 3),
      }),
      createMealPlanCard(),
      createHeroInsightCard({
        label: "Varmest nu",
        value: warmestRoom ? warmestRoom.room : "Ingen data",
        secondary: warmestRoom ? formatTemp(warmestRoom.value) : "Ingen termostater fundet",
        active: Boolean(warmestRoom),
      }),
      createHeroInsightCard({
        label: "Spiller nu",
        value: nowPlaying ? nowPlaying.label : "Stille",
        secondary: nowPlaying
          ? nowPlaying.line
          : heatingRooms.length
            ? `Varme i ${heatingRooms.join(", ")}`
            : "Ingen afspilning lige nu",
        active: Boolean(nowPlaying),
      }),
    ];

    cards.forEach((card) => elements.heroStats.appendChild(card));
  }

  function roomStatusText(room) {
    const lightsOn = getRoomLightEntries(room).filter(({ state }) => isOn(state)).length;
    const climate = getRoomClimateState(room);
    const media = getRoomMediaState(room);

    if (isActivePlayback(media)) return "Musik aktiv";
    if (isHeating(climate)) return "Varmer op";
    if (lightsOn > 0) return `${lightsOn} lys tændt`;
    if (climate) return "Temperatur overvåges";
    return "Standby";
  }

  function renderRooms() {
    elements.roomCards.innerHTML = "";

    rooms.forEach((room) => {
      const lightEntries = getRoomLightEntries(room);
      const climate = getRoomClimateState(room);
      const media = getRoomMediaState(room);
      const currentTemp = climate?.attributes?.current_temperature;
      const targetTemp = climate?.attributes?.temperature;
      const lightsOn = lightEntries.filter(({ state }) => isOn(state)).length;
      const hasLights = lightEntries.length > 0;
      const roomActive = lightsOn > 0 || isActivePlayback(media) || isHeating(climate);

      const card = document.createElement("article");
      card.className = `room-card${roomActive ? " is-active" : ""}${isHeating(climate) ? " is-heating" : ""}`;

      const badgeText = climate && currentTemp != null ? formatTemp(currentTemp) : roomActive ? "Aktiv" : "Klar";
      const lightSummary = hasLights ? `${lightsOn}/${lightEntries.length} tændt` : "Ingen lys";

      card.innerHTML = `
        <div class="room-top">
          <div>
            <div class="room-name">${room.name}</div>
            <div class="entity-meta">${roomStatusText(room)}</div>
          </div>
          <div class="room-badge${roomActive ? "" : " off"}">${badgeText}</div>
        </div>
        <div class="room-footnote">${lightSummary}</div>
      `;

      const lightGrid = document.createElement("div");
      lightGrid.className = "room-light-grid";

      if (lightEntries.length) {
        lightEntries.forEach(({ config: entity, state }) => {
          const isLightOn = isOn(state);
          const lightCard = document.createElement("div");
          lightCard.className = `room-light-control${isLightOn ? " is-on" : ""}`;

          const indicator = document.createElement("div");
          indicator.className = "room-light-meta";
          indicator.innerHTML = `
            <span class="indicator-dot${isLightOn ? " on" : ""}"></span>
            <span>${isLightOn ? "Tændt" : "Slukket"}</span>
          `;
          lightCard.appendChild(indicator);

          lightCard.appendChild(
            createButton(`${room.name} ${entity.label}`, isLightOn ? "room-light-button btn-primary" : "room-light-button", async () => {
              await callService(getEntityDomain(entity.entity_id), isLightOn ? "turn_off" : "turn_on", {
                entity_id: entity.entity_id,
              });
              await refreshEntities([entity.entity_id]);
            })
          );

          if (
            entity.type === "light" &&
            entity.allow_brightness !== false &&
            isLightOn &&
            state?.attributes?.brightness != null
          ) {
            const brightness = Math.max(1, Math.round((state.attributes.brightness / 255) * 100));
            lightCard.appendChild(
              createSlider("%", brightness, async (event) => {
                try {
                  await callService("light", "turn_on", {
                    entity_id: entity.entity_id,
                    brightness_pct: Number(event.target.value),
                  });
                  await refreshEntities([entity.entity_id]);
                } catch (error) {
                  console.error(error);
                  setStatus("error", "Fejl");
                }
              })
            );
          }

          lightGrid.appendChild(lightCard);
        });
      } else {
        const empty = document.createElement("div");
        empty.className = "entity-secondary";
        empty.textContent = "Ingen lys i dette rum.";
        lightGrid.appendChild(empty);
      }

      card.appendChild(lightGrid);

      const footer = document.createElement("div");
      footer.className = "room-footer-grid";

      if (climate && room.climate) {
        const heatSection = document.createElement("div");
        heatSection.className = "room-footer-card";
        const steps = Array.from({ length: 13 }, (_, index) => 18 + index);
        const normalizedSetpoint = Number.isFinite(Number(targetTemp))
          ? clamp(Math.round(Number(targetTemp)), steps[0], steps[steps.length - 1])
          : steps[0];
        const currentSetpoint = String(normalizedSetpoint);
        heatSection.innerHTML = `
          <div class="chip-label">Varme</div>
          <div class="chip-value">${currentTemp != null ? formatTemp(currentTemp) : "--"} · Setpunkt ${formatTemp(targetTemp, 0)}</div>
        `;
        const heatValue = heatSection.querySelector(".chip-value");
        if (heatValue) {
          heatValue.textContent = `${currentTemp != null ? formatTemp(currentTemp) : "--"} · Setpunkt ${normalizedSetpoint}°`;
        }
        heatSection.appendChild(
          createSelect(
            "Setpunkt",
            steps.map((temp) => ({
              label: `${temp}°`,
              value: String(temp),
            })),
            currentSetpoint,
            async (event) => {
              try {
                await callService("climate", "set_temperature", {
                  entity_id: room.climate,
                  temperature: Number(event.target.value),
                });
                await refreshEntities([room.climate]);
              } catch (error) {
                console.error(error);
                setStatus("error", "Fejl");
              }
            }
          )
        );
        footer.appendChild(heatSection);
      }

      if (media && room.media && isActivePlayback(media)) {
        const mediaSection = document.createElement("div");
        mediaSection.className = "room-footer-card";
        mediaSection.innerHTML = `
          <div class="chip-label">Medie</div>
          <div class="chip-value">${formatMediaLine(media)}</div>
        `;

        const mediaControls = document.createElement("div");
        mediaControls.className = "room-inline-control";
        mediaControls.appendChild(
          createButton(isActivePlayback(media) ? "Pause" : "Afspil", "", async () => {
            await callService("media_player", "media_play_pause", { entity_id: room.media });
            await refreshEntities([room.media]);
          })
        );
        mediaSection.appendChild(mediaControls);

        if (media.attributes?.volume_level != null) {
          const volume = Math.round(media.attributes.volume_level * 100);
          mediaSection.appendChild(
            createSlider("Volumen", volume, async (event) => {
              try {
                await callService("media_player", "volume_set", {
                  entity_id: room.media,
                  volume_level: Number(event.target.value) / 100,
                });
                await refreshEntities([room.media]);
              } catch (error) {
                console.error(error);
                setStatus("error", "Fejl");
              }
            })
          );
        }

        footer.appendChild(mediaSection);
      }

      if (footer.childElementCount) {
        card.appendChild(footer);
      }

      elements.roomCards.appendChild(card);
    });
  }

  async function createSpotifyControls(item, state, card) {
    const playlists = await fetchSpotifyPlaylists();
    const playbackTargets = mediaItems
      .filter((mediaItem) => mediaItem.kind === "room-media")
      .map((mediaItem) => ({
        label: `${mediaItem.label} (${mediaItem.room})`,
        value: mediaItem.entity_id,
      }));

    let chosenTarget =
      spotifyUiState.targetByItem.get(item.entity_id) ||
      playbackTargets[0]?.value ||
      "";
    let chosenGroupedTargets = [...(spotifyUiState.groupedTargetsByItem.get(item.entity_id) || [])];
    const selectedTargetItem = mediaItems.find((mediaItem) => mediaItem.entity_id === chosenTarget) || null;
    const selectedTargetState = selectedTargetItem ? stateCache.get(selectedTargetItem.entity_id) : null;
    const activeTargetItem =
      mediaItems.find(
        (mediaItem) => mediaItem.kind === "room-media" && isActivePlayback(stateCache.get(mediaItem.entity_id))
      ) || null;
    const previewItem = (selectedTargetState && isActivePlayback(selectedTargetState) ? selectedTargetItem : null) || activeTargetItem;
    const previewState = previewItem ? stateCache.get(previewItem.entity_id) : state;

    card.appendChild(await createSpotifyNowPlayingCard(previewItem, previewState));

    if (playbackTargets.length) {
      card.appendChild(
        createSelect("Primær højttaler", playbackTargets, chosenTarget, async (event) => {
          noteSpotifyInteraction();
          chosenTarget = event.target.value;
          spotifyUiState.targetByItem.set(item.entity_id, chosenTarget);
          chosenGroupedTargets = chosenGroupedTargets.filter((target) => target !== chosenTarget);
          spotifyUiState.groupedTargetsByItem.set(item.entity_id, chosenGroupedTargets);
          await renderSpotifyPanel(true);
        })
      );

      const groupOptions = playbackTargets.filter((target) => target.value !== chosenTarget);
      if (groupOptions.length) {
        const groupWrapper = document.createElement("div");
        groupWrapper.className = "select-group";

        const caption = document.createElement("label");
        caption.className = "select-label";
        caption.textContent = "Gruppér med";
        groupWrapper.appendChild(caption);

        const pillRow = document.createElement("div");
        pillRow.className = "entity-controls";

        groupOptions.forEach((target) => {
          const isSelected = chosenGroupedTargets.includes(target.value);
          pillRow.appendChild(
            createTogglePill(target.label, isSelected, () => {
              if (chosenGroupedTargets.includes(target.value)) {
                chosenGroupedTargets = chosenGroupedTargets.filter((value) => value !== target.value);
              } else {
                chosenGroupedTargets = [...chosenGroupedTargets, target.value];
              }
              spotifyUiState.groupedTargetsByItem.set(item.entity_id, chosenGroupedTargets);
              renderAll();
            })
          );
        });

        groupWrapper.appendChild(pillRow);
        card.appendChild(groupWrapper);

        const groupingActions = document.createElement("div");
        groupingActions.className = "entity-controls";
        groupingActions.appendChild(
          createButton("Gruppér valgte", "", async () => {
            if (!chosenTarget || !chosenGroupedTargets.length) {
              throw new Error("Vælg først en primær højttaler og mindst ét ekstra rum.");
            }

            await callService("media_player", "join", {
              entity_id: chosenTarget,
              group_members: chosenGroupedTargets,
            });
            await refreshEntities([chosenTarget, ...chosenGroupedTargets]);
          })
        );
        groupingActions.appendChild(
          createButton("Opløs gruppe", "", async () => {
            const targets = [chosenTarget, ...chosenGroupedTargets].filter(Boolean);
            await Promise.all(
              targets.map((entityId) =>
                callService("media_player", "unjoin", {
                  entity_id: entityId,
                })
              )
            );
            await refreshEntities(targets);
          })
        );
        card.appendChild(groupingActions);
      }
    }

    if (playlists.length) {
      const selectedPlaylist = playlists[0];
      let chosenValue =
        spotifyUiState.playlistByItem.get(item.entity_id) ||
        selectedPlaylist.value ||
        selectedPlaylist.uri;
      const tracks = await fetchSpotifyPlaylistTracks(chosenValue);
      let chosenTrack = spotifyUiState.trackByItem.get(item.entity_id) || tracks[0]?.value || "";

      card.appendChild(
        createTrackList(
          "Vælg playliste",
          playlists.map((playlist) => ({
            label: playlist.label,
            value: playlist.value || playlist.uri,
          })),
          chosenValue,
          `playlist:${item.entity_id}`,
          async (value) => {
            noteSpotifyInteraction();
            chosenValue = value;
            spotifyUiState.playlistByItem.set(item.entity_id, chosenValue);
            spotifyUiState.trackByItem.delete(item.entity_id);
            spotifyUiState.trackScrollTopByItem.delete(item.entity_id);
            await renderSpotifyPanel(true);
          }
        )
      );

      if (tracks.length) {
        card.appendChild(
          createTrackList("V\u00e6lg nummer", tracks, chosenTrack, item.entity_id, (value) => {
            chosenTrack = value;
            spotifyUiState.trackByItem.set(item.entity_id, chosenTrack);
          })
        );
      }

      const actions = document.createElement("div");
      actions.className = "entity-controls";
      actions.appendChild(
        createButton("Start playliste", "btn-primary", async () => {
          if (!chosenTarget) {
            throw new Error("Vælg først en højttaler.");
          }
          await callService("media_player", "play_media", {
            entity_id: chosenTarget,
            media_content_id: chosenValue,
            media_content_type: "playlist",
          });
          await refreshEntities([chosenTarget, item.entity_id]);
        })
      );
      actions.appendChild(
        createButton("Shuffle playliste", "", async () => {
          if (!chosenTarget) {
            throw new Error("V\u00e6lg f\u00f8rst en h\u00f8jttaler.");
          }
          await callService("media_player", "shuffle_set", {
            entity_id: chosenTarget,
            shuffle: true,
          });
          await callService("media_player", "play_media", {
            entity_id: chosenTarget,
            media_content_id: chosenValue,
            media_content_type: "playlist",
          });
          await refreshEntities([chosenTarget, item.entity_id]);
        })
      );
      if (config.spotify?.drP4FynStreamUrl) {
        actions.appendChild(
          createButton("DR P4 Fyn", "", async () => {
            if (!chosenTarget) {
              throw new Error("V\u00e6lg f\u00f8rst en h\u00f8jttaler.");
            }
            await callService("media_player", "play_media", {
              entity_id: chosenTarget,
              media_content_id: config.spotify.drP4FynStreamUrl,
              media_content_type: "music",
            });
            await refreshEntities([chosenTarget, item.entity_id]);
          })
        );
      }
      if (tracks.length) {
        actions.appendChild(
          createButton("Start nummer", "", async () => {
            if (!chosenTarget) {
              throw new Error("V\u00e6lg f\u00f8rst en h\u00f8jttaler.");
            }
            if (!chosenTrack) {
              throw new Error("V\u00e6lg f\u00f8rst et nummer.");
            }
            await callService("media_player", "play_media", {
              entity_id: chosenTarget,
              media_content_id: chosenTrack,
              media_content_type: "track",
            });
            await refreshEntities([chosenTarget, item.entity_id]);
          })
        );
      }
      card.appendChild(actions);
    } else {
      const empty = document.createElement("div");
      empty.className = "entity-secondary";
      empty.innerHTML = spotifyPlaylistCache.error
        ? `${spotifyPlaylistCache.error} <a class="news-link" href="/spotify-test.html">Åbn Spotify-testsiden</a>`
        : 'Log ind via <a class="news-link" href="/spotify-test.html">Spotify-testsiden</a> for at hente alle dine playlister automatisk.';
      card.appendChild(empty);
    }
  }

  async function renderMedia() {
    if (isInteractingWithMediaControls()) {
      return;
    }

    elements.mediaCards.innerHTML = "";

    if (!mediaItems.length) {
      elements.mediaCards.innerHTML = '<div class="empty-state">Ingen mediaenheder i konfigurationen endnu.</div>';
      return;
    }

    const playingItems = mediaItems.filter(
      (item) => item.kind === "room-media" && isActivePlayback(stateCache.get(item.entity_id))
    );

    if (!playingItems.length) {
      elements.mediaCards.innerHTML =
        '<div class="empty-state">Ingen aktiv afspilning lige nu. Start musik i et rum, så vises det her.</div>';
      return;
    }

    for (const item of playingItems) {
      const state = stateCache.get(item.entity_id);
      if (!state) continue;

      const volume = getMediaVolumePercent(item, state);

      const card = document.createElement("article");
      card.className = `media-card${isActivePlayback(state) ? " is-active" : ""}`;
      card.innerHTML = `
        <div class="media-card-header">
          <div>
            <div class="media-card-title">${item.label}</div>
            <div class="entity-meta">${item.room}</div>
          </div>
          <div class="media-card-state">${state.state}</div>
        </div>
        <div class="media-track">${state.attributes?.media_title || "Ingen titel"}</div>
        <div class="media-artist">${state.attributes?.media_artist || "Ingen kunstner"}</div>
      `;

      const mediaPosition = getLiveMediaPosition(state);
      const mediaDuration = Number(state.attributes?.media_duration);
      if (Number.isFinite(mediaPosition) && Number.isFinite(mediaDuration) && mediaDuration > 0) {
        const progress = Math.min(100, Math.max(0, (mediaPosition / mediaDuration) * 100));
        const progressBlock = document.createElement("div");
        progressBlock.className = "media-progress";
        progressBlock.innerHTML = `
          <div class="media-progress-times">
            <span>${formatDuration(mediaPosition)}</span>
            <span>${formatDuration(Math.max(0, mediaDuration - mediaPosition), "-")}</span>
          </div>
          <div class="media-progress-track">
            <div class="media-progress-fill" style="width: ${progress}%"></div>
            <div class="media-progress-thumb" style="left: ${progress}%"></div>
          </div>
        `;
        attachSeekBehavior(progressBlock.querySelector(".media-progress-track"), item.entity_id, mediaDuration);
        card.appendChild(progressBlock);
      }

      const controls = document.createElement("div");
      controls.className = "entity-controls";
      controls.appendChild(
        createButton("Pause", "btn-primary", async () => {
          await callService("media_player", "media_play_pause", { entity_id: item.entity_id });
          await refreshEntities([item.entity_id]);
        })
      );
      controls.appendChild(
        createButton("Forrige", "", async () => {
          await callService("media_player", "media_previous_track", { entity_id: item.entity_id });
          await refreshEntities([item.entity_id]);
        })
      );
      controls.appendChild(
        createButton("Næste", "", async () => {
          await callService("media_player", "media_next_track", { entity_id: item.entity_id });
          await refreshEntities([item.entity_id]);
        })
      );
      card.appendChild(controls);

      if (volume != null) {
        card.appendChild(
          createSlider("Volumen", volume, async (event) => {
            try {
              await callService("media_player", "volume_set", {
                entity_id: item.entity_id,
                volume_level: Number(event.target.value) / 100,
              });
              await refreshEntities([item.entity_id]);
            } catch (error) {
              console.error(error);
              setStatus("error", "Fejl");
            }
          })
        );
      }

      if (item.kind === "spotify") {
        await createSpotifyControls(item, state, card);
      }

      elements.mediaCards.appendChild(card);
    }
  }

  async function renderSpotifyPanel(force = false) {
    if (!elements.spotifyCards) return;
    if (!force && isInteractingWithSpotifyControls()) return;

    const spotifyItem = mediaItems.find((item) => item.kind === "spotify");
    if (!spotifyItem) {
      elements.spotifyCards.innerHTML = '<div class="empty-state">Ingen Spotify-entitet er sat i konfigurationen.</div>';
      if (elements.spotifyPanel) {
        elements.spotifyPanel.hidden = false;
      }
      return;
    }

    const spotifyState = stateCache.get(spotifyItem.entity_id);
    const existingCard = elements.spotifyCards.querySelector(".media-card");
    if (!force && existingCard) {
      const playbackTargets = mediaItems
        .filter((mediaItem) => mediaItem.kind === "room-media")
        .map((mediaItem) => mediaItem.entity_id);
      const chosenTarget = spotifyUiState.targetByItem.get(spotifyItem.entity_id) || playbackTargets[0] || "";
      const selectedTargetItem = mediaItems.find((mediaItem) => mediaItem.entity_id === chosenTarget) || null;
      const selectedTargetState = selectedTargetItem ? stateCache.get(selectedTargetItem.entity_id) : null;
      const activeTargetItem =
        mediaItems.find(
          (mediaItem) => mediaItem.kind === "room-media" && isActivePlayback(stateCache.get(mediaItem.entity_id))
        ) || null;
      const previewItem = (selectedTargetState && isActivePlayback(selectedTargetState) ? selectedTargetItem : null) || activeTargetItem;
      const previewState = previewItem ? stateCache.get(previewItem.entity_id) : spotifyState;
      const nowPlaying = existingCard.querySelector(".spotify-now-playing");
      if (nowPlaying) {
        await patchSpotifyNowPlaying(nowPlaying, previewItem, previewState);
      }
      existingCard.className = `media-card${isActivePlayback(spotifyState) ? " is-active" : ""}`;
      const headerState = existingCard.querySelector(".media-card-header > .media-card-state");
      if (headerState) {
        headerState.textContent = spotifyState?.state || "ukendt";
      }
      if (elements.spotifyPanel) {
        elements.spotifyPanel.hidden = false;
      }
      return;
    }

    elements.spotifyCards.innerHTML = "";
    const card = document.createElement("article");
    card.className = `media-card${isActivePlayback(spotifyState) ? " is-active" : ""}`;
    card.innerHTML = `
      <div class="media-card-header">
        <div>
          <div class="media-card-title">${spotifyItem.label}</div>
          <div class="entity-meta">${spotifyItem.room}</div>
        </div>
        <div class="media-card-state">${spotifyState?.state || "ukendt"}</div>
      </div>
      <div class="entity-secondary">Spotify-bibliotek og afspilning via Home Assistant-højttalere.</div>
    `;

    await createSpotifyControls(spotifyItem, spotifyState, card);
    elements.spotifyCards.appendChild(card);
    if (elements.spotifyPanel) {
      elements.spotifyPanel.hidden = false;
    }
  }

  function formatCalendarTimeRange(event) {
    const startDateTime = event.start?.dateTime;
    const endDateTime = event.end?.dateTime;
    const startDate = event.start?.date;
    const endDate = event.end?.date;

    if (startDateTime && endDateTime) {
      const start = new Date(startDateTime);
      const end = new Date(endDateTime);
      const day = start.toLocaleDateString("da-DK", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
      const startTime = start.toLocaleTimeString("da-DK", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const endTime = end.toLocaleTimeString("da-DK", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `${day} ${startTime} - ${endTime}`;
    }

    if (startDate && endDate) {
      const start = new Date(startDate);
      const day = start.toLocaleDateString("da-DK", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
      return `${day} · Hele dagen`;
    }

    return "Tidspunkt ukendt";
  }

  function renderCalendar(items) {
    if (!elements.calendarPanel || !elements.calendarCards) return;

    const calendarConfig = config.calendar;
    if (!calendarConfig?.entityId) {
      elements.calendarPanel.hidden = true;
      return;
    }

    elements.calendarPanel.hidden = false;
    elements.calendarCards.innerHTML = "";

    if (!items.length) {
      elements.calendarCards.innerHTML = '<div class="empty-state">Ingen kommende kalenderaftaler.</div>';
      return;
    }

    items.forEach((event) => {
      const card = document.createElement("article");
      card.className = "calendar-item";
      card.innerHTML = `
        <div class="calendar-item-time">${formatCalendarTimeRange(event)}</div>
        <div class="calendar-item-title">${event.summary || "Uden titel"}</div>
        ${event.location ? `<div class="calendar-item-meta">${event.location}</div>` : ""}
      `;
      elements.calendarCards.appendChild(card);
    });
  }

  async function fetchCalendar() {
    if (!elements.calendarPanel || !elements.calendarCards) return;

    const calendarConfig = config.calendar;
    if (!calendarConfig?.entityId) {
      elements.calendarPanel.hidden = true;
      return;
    }

    try {
      const start = new Date();
      const end = new Date(start);
      end.setDate(end.getDate() + (calendarConfig.daysAhead || 7));

      const params = new URLSearchParams({
        start: start.toISOString(),
        end: end.toISOString(),
      });

      const response = await fetch(`/api/ha/calendars/${encodeURIComponent(calendarConfig.entityId)}?${params.toString()}`, {
        headers: proxyHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Kalenderhentning fejlede (${response.status})`);
      }

      const payload = await response.json();
      const items = Array.isArray(payload) ? payload : [];
      const sorted = items
        .slice()
        .sort((a, b) => {
          const aTime = new Date(a.start?.dateTime || a.start?.date || 0).getTime();
          const bTime = new Date(b.start?.dateTime || b.start?.date || 0).getTime();
          return aTime - bTime;
        })
        .slice(0, calendarConfig.maxItems || 6);

      renderCalendar(sorted);
    } catch (error) {
      console.error(error);
      elements.calendarPanel.hidden = false;
      elements.calendarCards.innerHTML = '<div class="empty-state">Kalenderen kunne ikke hentes.</div>';
    }
  }

  function renderTechnicalStatus() {
    if (!elements.technicalStatusCards) return;

    elements.technicalStatusCards.innerHTML = "";

    const ramState = getSystemState(systemStatusConfig.unraid.ram);
    const cpuState = getSystemState(systemStatusConfig.unraid.cpu);
    const cpuTempState = getSystemState(systemStatusConfig.unraid.cpuTemp);
    const uptimeState = getSystemState(systemStatusConfig.unraid.uptime);
    pushTechnicalHistory("ram", ramState?.state);
    pushTechnicalHistory("cpu", cpuState?.state);
    pushTechnicalHistory("cpuTemp", cpuTempState?.state);

    const cards = [
      createTechnicalMetricCard(
        "Unraid RAM",
        formatPercent(ramState?.state),
        ramState ? `${ramState.attributes?.ram_used || "--"} / ${ramState.attributes?.ram_total || "--"}` : "Ingen data"
      ),
      createTechnicalMetricCard(
        "CPU Usage",
        formatPercent(cpuState?.state),
        cpuState ? `${cpuState.attributes?.cpu_model || "CPU"} · ${cpuState.attributes?.cpu_frequency || ""}` : "Ingen data"
      ),
      createTechnicalMetricCard(
        "CPU Temp",
        cpuTempState ? formatTemp(cpuTempState.state, 1) : "--",
        cpuTempState ? "Processor temperatur" : "Ingen data"
      ),
      createTechnicalMetricCard(
        "Uptime",
        uptimeState ? formatUptimeFromState(uptimeState) : "--",
        uptimeState ? `${uptimeState.attributes?.hostname || "Unraid"} · ${uptimeState.attributes?.version || ""}` : "Ingen data"
      ),
    ];

    if (cards[0]) {
      cards[0].appendChild(createSparkline(technicalHistory.ram, { min: 0, max: 100 }));
    }
    if (cards[1]) {
      cards[1].appendChild(createSparkline(technicalHistory.cpu, { min: 0, max: 100 }));
    }
    if (cards[2]) {
      cards[2].appendChild(createSparkline(technicalHistory.cpuTemp, { min: 0, max: 100, className: "sparkline-temp" }));
    }

    cards.forEach((card) => elements.technicalStatusCards.appendChild(card));
  }

  function renderNews(items) {
    if (!elements.newsTicker) return;

    if (!items.length) {
      elements.newsTicker.textContent = "Kunne ikke hente nyhedslinjen endnu.";
      return;
    }

    elements.newsTicker.innerHTML = "";

    const createRun = () => {
      const run = document.createElement("div");
      run.className = "news-bar-run";

      items.forEach((item) => {
        const link = document.createElement("a");
        link.className = "news-link";
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.innerHTML = `<span class="news-source">${item.source}</span>${item.title}`;
        run.appendChild(link);
      });

      return run;
    };

    elements.newsTicker.appendChild(createRun());
    elements.newsTicker.appendChild(createRun());
  }

  async function fetchNews() {
    if (!elements.newsTicker) return;

    try {
      const response = await fetch("/api/news");
      if (!response.ok) {
        throw new Error(`Nyhedsfeed fejlede (${response.status})`);
      }
      const payload = await response.json();
      renderNews(Array.isArray(payload.items) ? payload.items : []);
    } catch (error) {
      console.error(error);
      elements.newsTicker.textContent = "Nyhedslinjen er midlertidigt utilgængelig.";
    }
  }

  function allConfiguredEntityIds() {
    return [
      ...new Set(
        [
          ...rooms.flatMap((room) => [
            ...getRoomEntities(room).map((entity) => entity.entity_id),
            room.climate,
            room.media,
            room.media_volume_sensor,
            room.volume_sensor,
          ]),
          ...mediaItems.map((item) => item.entity_id),
          ...getSystemEntityIds(),
        ].filter(Boolean)
      ),
    ];
  }

  async function fetchInitialStates() {
    const entityIds = allConfiguredEntityIds();
    const results = await Promise.allSettled(entityIds.map((entityId) => getState(entityId)));

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failedEntities.set(entityIds[index], result.reason?.message || "Ukendt fejl");
      }
    });

    return {
      total: entityIds.length,
      failed: failedEntities.size,
    };
  }

  async function refreshEntities(entityIds) {
    await Promise.allSettled(entityIds.map((entityId) => getState(entityId)));
    await renderAll();
  }

  async function renderAll() {
    renderHeroStats();
    await renderMedia();
    await renderSpotifyPanel();
    renderRooms();
    renderTechnicalStatus();

    if (failedEntities.size > 0) {
      setStatus("error", `${failedEntities.size} fejl`);
    } else {
      setStatus("ok", "Forbundet");
    }
  }

  async function fetchInitialStatesAndRender() {
    try {
      failedEntities.clear();
      await fetchInitialStates();
      await renderAll();
    } catch (error) {
      console.error(error);
      setStatus("error", "Fejl");
    }
  }

  async function bootstrap() {
    updateClock();
    setInterval(updateClock, 1000);

    try {
      const summary = await fetchInitialStates();
      await Promise.all([fetchTechnicalHistory(), fetchMealPlan()]);
      await renderAll();
      await fetchCalendar();
      await fetchNews();

      if (summary.total === 0) {
        setStatus("error", "Ingen data");
      }

      setInterval(fetchInitialStatesAndRender, config.refreshIntervalMs || 5000);
      setInterval(async () => {
        try {
          await fetchTechnicalHistory();
          renderTechnicalStatus();
        } catch (error) {
          console.error(error);
        }
      }, 60 * 1000);
      setInterval(fetchCalendar, 15 * 60 * 1000);
      setInterval(fetchNews, 15 * 60 * 1000);
      setInterval(async () => {
        await fetchMealPlan();
        renderHeroStats();
      }, 15 * 60 * 1000);
    } catch (error) {
      console.error(error);
      setStatus("error", "Fejl");
    }
  }

  bootstrap();
})();
