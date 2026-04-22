(() => {
  const config = window.APP_CONFIG || {};
  const spotifyConfig = config.spotify || {};

  const storageKeys = {
    verifier: "spotify_pkce_verifier",
    state: "spotify_pkce_state",
    accessToken: "spotify_access_token",
    refreshToken: "spotify_refresh_token",
    expiresAt: "spotify_expires_at",
  };

  const scopes = [
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "user-read-recently-played",
    "playlist-read-private",
    "playlist-read-collaborative",
  ];

  const elements = {
    redirectUri: document.getElementById("spotifyRedirectUri"),
    clientIdStatus: document.getElementById("spotifyClientIdStatus"),
    playlistHint: document.getElementById("spotifyPlaylistHint"),
    playlistInput: document.getElementById("spotifyPlaylistInput"),
    loginBtn: document.getElementById("spotifyLoginBtn"),
    refreshBtn: document.getElementById("spotifyRefreshBtn"),
    logoutBtn: document.getElementById("spotifyLogoutBtn"),
    playSelectedBtn: document.getElementById("spotifyPlaySelectedBtn"),
    transferBtn: document.getElementById("spotifyTransferBtn"),
    statusBox: document.getElementById("spotifyStatusBox"),
    playbackBox: document.getElementById("spotifyPlaybackBox"),
    devices: document.getElementById("spotifyDevices"),
  };

  let selectedDeviceId = null;
  let deviceCache = [];

  const redirectUri = window.location.origin + window.location.pathname;

  elements.redirectUri.textContent = redirectUri;
  elements.clientIdStatus.textContent = spotifyConfig.clientId ? "Sat" : "Mangler i APP_CONFIG.spotify.clientId";

  const defaultPlaylist =
    spotifyConfig.testPlaylistUri ||
    (Array.isArray(spotifyConfig.playlists) && spotifyConfig.playlists[0]?.uri) ||
    "";

  elements.playlistInput.value = defaultPlaylist;
  elements.playlistHint.textContent = defaultPlaylist || "Ingen standard-playliste sat endnu";

  function setStatus(message, isError = false) {
    elements.statusBox.textContent = message;
    elements.statusBox.style.borderColor = isError ? "rgba(255, 123, 123, 0.22)" : "rgba(35, 229, 139, 0.22)";
  }

  function setPlaybackMessage(message) {
    elements.playbackBox.textContent = message;
  }

  async function getPkceBundle() {
    const response = await fetch("/api/spotify/pkce");
    if (!response.ok) {
      throw new Error(`PKCE-forberedelse fejlede (${response.status})`);
    }
    return response.json();
  }

  async function login() {
    if (!spotifyConfig.clientId) {
      setStatus("Indsæt først APP_CONFIG.spotify.clientId i ha-config.js", true);
      return;
    }

    const { verifier, state, challenge } = await getPkceBundle();

    sessionStorage.setItem(storageKeys.verifier, verifier);
    sessionStorage.setItem(storageKeys.state, state);

    const params = new URLSearchParams({
      client_id: spotifyConfig.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      code_challenge_method: "S256",
      code_challenge: challenge,
      state,
      scope: scopes.join(" "),
    });

    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  async function exchangeCodeForToken(code) {
    const verifier = sessionStorage.getItem(storageKeys.verifier);
    const expectedState = sessionStorage.getItem(storageKeys.state);
    const actualState = new URLSearchParams(window.location.search).get("state");

    if (!verifier || !expectedState || expectedState !== actualState) {
      throw new Error("PKCE state matcher ikke. Prøv login igen.");
    }

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: spotifyConfig.clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token exchange fejlede (${response.status})`);
    }

    const token = await response.json();
    saveToken(token);
    sessionStorage.removeItem(storageKeys.verifier);
    sessionStorage.removeItem(storageKeys.state);
    window.history.replaceState({}, document.title, redirectUri);
  }

  function saveToken(token) {
    localStorage.setItem(storageKeys.accessToken, token.access_token);
    if (token.refresh_token) {
      localStorage.setItem(storageKeys.refreshToken, token.refresh_token);
    }
    localStorage.setItem(storageKeys.expiresAt, String(Date.now() + (token.expires_in - 60) * 1000));
  }

  async function refreshAccessTokenIfNeeded() {
    const accessToken = localStorage.getItem(storageKeys.accessToken);
    const expiresAt = Number(localStorage.getItem(storageKeys.expiresAt) || 0);
    if (accessToken && Date.now() < expiresAt) {
      return accessToken;
    }

    const refreshToken = localStorage.getItem(storageKeys.refreshToken);
    if (!refreshToken) {
      return null;
    }

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: spotifyConfig.clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`Refresh token fejlede (${response.status})`);
    }

    const token = await response.json();
    saveToken({
      ...token,
      refresh_token: token.refresh_token || refreshToken,
    });
    return localStorage.getItem(storageKeys.accessToken);
  }

  async function spotifyFetch(url, options = {}) {
    const token = await refreshAccessTokenIfNeeded();
    if (!token) {
      throw new Error("Ingen Spotify-session fundet endnu.");
    }

    const response = await fetch(`https://api.spotify.com/v1${url}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    if (!response.ok && response.status !== 204) {
      const text = await response.text();
      throw new Error(`Spotify API ${response.status}: ${text}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  function isSonosDevice(device) {
    const text = `${device.name} ${device.type}`.toLowerCase();
    return text.includes("sonos") || text.includes("playbar") || text.includes("beam") || text.includes("arc");
  }

  function renderDevices(devices) {
    elements.devices.innerHTML = "";

    if (!devices.length) {
      elements.devices.innerHTML =
        '<div class="empty-state">Ingen Spotify Connect-devices fundet endnu. Åbn Spotify på en Sonos eller anden enhed først.</div>';
      return;
    }

    devices.forEach((device) => {
      const card = document.createElement("article");
      card.className = `media-card device-card${device.id === selectedDeviceId ? " is-selected" : ""}${device.is_restricted ? " is-restricted" : ""}`;

      const sonosPill = isSonosDevice(device) ? '<span class="device-pill active">Sonos-kandidat</span>' : "";
      const activePill = device.is_active ? '<span class="device-pill active">Aktiv</span>' : "";
      const restrictedPill = device.is_restricted
        ? '<span class="device-pill warn">Restricted</span>'
        : '<span class="device-pill">Kan styres</span>';

      card.innerHTML = `
        <div class="media-card-header">
          <div>
            <div class="media-card-title">${device.name}</div>
            <div class="entity-meta">${device.type}</div>
          </div>
          <div class="media-card-state">${device.id ? "ID fundet" : "Ingen device ID"}</div>
        </div>
        <div class="device-pill-row">
          ${sonosPill}
          ${activePill}
          ${restrictedPill}
        </div>
        <div class="device-meta-grid">
          <div class="room-chip">
            <span class="chip-label">Volumen</span>
            <span class="chip-value">${device.volume_percent ?? "-"}%</span>
          </div>
          <div class="room-chip">
            <span class="chip-label">Private session</span>
            <span class="chip-value">${device.is_private_session ? "Ja" : "Nej"}</span>
          </div>
        </div>
      `;

      const controls = document.createElement("div");
      controls.className = "entity-controls";
      controls.appendChild(
        (() => {
          const button = document.createElement("button");
          button.className = "btn btn-primary";
          button.textContent = "Vælg device";
          button.addEventListener("click", () => {
            selectedDeviceId = device.id || null;
            setPlaybackMessage(
              selectedDeviceId
                ? `Valgt device: ${device.name}${device.is_restricted ? " (restricted)" : ""}`
                : `Device ${device.name} har ikke et brugbart device_id`
            );
            renderDevices(deviceCache);
          });
          return button;
        })()
      );

      elements.devices.appendChild(card);
      card.appendChild(controls);
    });
  }

  async function refreshDevices() {
    try {
      setStatus("Henter devices ...");
      const payload = await spotifyFetch("/me/player/devices");
      deviceCache = Array.isArray(payload?.devices) ? payload.devices : [];

      if (!selectedDeviceId && deviceCache[0]?.id) {
        selectedDeviceId = deviceCache[0].id;
      }

      renderDevices(deviceCache);

      const sonosDevices = deviceCache.filter(isSonosDevice);
      const controllableSonos = sonosDevices.filter((device) => device.id && !device.is_restricted);

      if (controllableSonos.length > 0) {
        setStatus(`Spotify ser ${controllableSonos.length} styrbar(e) Sonos-device(s).`);
      } else if (sonosDevices.length > 0) {
        setStatus("Spotify kan se Sonos, men de er restricted eller mangler device ID.", true);
      } else {
        setStatus("Ingen Sonos-devices fundet i Spotify Connect-listen endnu.", true);
      }
    } catch (error) {
      console.error(error);
      setStatus(error.message, true);
    }
  }

  async function transferPlayback(play = false) {
    if (!selectedDeviceId) {
      setPlaybackMessage("Vælg først en device.");
      return;
    }

    await spotifyFetch("/me/player", {
      method: "PUT",
      body: JSON.stringify({
        device_ids: [selectedDeviceId],
        play,
      }),
    });

    setPlaybackMessage(`Playback overført til valgt device${play ? " og bedt om at afspille" : ""}.`);
    await refreshDevices();
  }

  async function playPlaylistOnSelectedDevice() {
    if (!selectedDeviceId) {
      setPlaybackMessage("Vælg først en device.");
      return;
    }

    const playlistUri = elements.playlistInput.value.trim();
    if (!playlistUri) {
      setPlaybackMessage("Indtast først en playlist URI eller et playlist-link.");
      return;
    }

    await spotifyFetch(`/me/player/play?device_id=${encodeURIComponent(selectedDeviceId)}`, {
      method: "PUT",
      body: JSON.stringify({
        context_uri: playlistUri.startsWith("http")
          ? playlistUri.replace("https://open.spotify.com/", "spotify:").replace(/\//g, ":").replace(/\?.*$/, "")
          : playlistUri,
      }),
    });

    setPlaybackMessage("Playliste sendt til valgt device.");
  }

  function logout() {
    Object.values(storageKeys).forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
    selectedDeviceId = null;
    deviceCache = [];
    renderDevices([]);
    setStatus("Spotify-session ryddet.");
    setPlaybackMessage("Logget ud.");
    window.history.replaceState({}, document.title, redirectUri);
  }

  async function bootstrap() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");

    if (error) {
      setStatus(`Spotify-login blev afvist: ${error}`, true);
      return;
    }

    if (code) {
      try {
        setStatus("Bytter Spotify-kode til token ...");
        await exchangeCodeForToken(code);
      } catch (exchangeError) {
        console.error(exchangeError);
        setStatus(exchangeError.message, true);
        return;
      }
    }

    const token = await refreshAccessTokenIfNeeded().catch((tokenError) => {
      console.error(tokenError);
      setStatus(tokenError.message, true);
      return null;
    });

    if (token) {
      setStatus("Spotify-login klar. Hent devices for at teste Sonos.");
      await refreshDevices();
    }
  }

  elements.loginBtn.addEventListener("click", login);
  elements.refreshBtn.addEventListener("click", refreshDevices);
  elements.logoutBtn.addEventListener("click", logout);
  elements.transferBtn.addEventListener("click", () => transferPlayback(false));
  elements.playSelectedBtn.addEventListener("click", playPlaylistOnSelectedDevice);

  renderDevices([]);
  bootstrap();
})();
