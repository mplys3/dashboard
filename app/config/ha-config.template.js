window.APP_CONFIG = {
  haUrl: "http://HOMEASSISTANT-IP:8123",
  haToken: "INDSÆT_DIT_TOKEN_HER",

  dashboardTitle: "Kronhjortl\u00f8kken 172",
  dashboardSubtitle: "",
  timeZone: "Europe/Copenhagen",
  refreshIntervalMs: 5000,

  mealPlanner: {
    endpoint: "/api/meal-plan",
    webUrl: "http://MEALPLANNER-IP:8765",
  },

  calendar: {
    entityId: "calendar.familie",
    label: "Familiekalender",
    subtitle: "Kommende aftaler",
    daysAhead: 7,
    maxItems: 6,
  },

  systemStatus: {
    weather: "weather.forecast_home",
    electricity: "sensor.energi_data_service",
    charger: "sensor.monta_sidste_opladning",
    waste: [
      "sensor.affald_papir",
      "sensor.affald_plast",
    ],
    unraid: {
      ram: "sensor.server_ram_usage",
      cpu: "sensor.server_cpu_usage",
      cpuTemp: "sensor.server_cpu_temperature",
      uptime: "sensor.server_uptime",
    },
  },

  spotify: {
    clientId: "DIN_SPOTIFY_CLIENT_ID",
    entity_id: "media_player.spotify_dit_navn",
    label: "Spotify",
    room: "Spotify",
    drP4FynStreamUrl: "http://live-icy.gss.dr.dk:8000/A/A07L.mp3",
    testPlaylistUri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
    playlists: [
      { label: "Morgen", uri: "https://open.spotify.com/playlist/..." },
      { label: "Fredag", uri: "spotify:playlist:37i9dQZF1DX..." },
    ],
  },

  rooms: [
    {
      name: "Stue",
      climate: "climate.stue",
      media: "media_player.stue",
      entities: [
        {
          type: "light",
          label: "Loft",
          entity_id: "light.stue",
          allow_brightness: true,
        },
      ],
    },
    {
      name: "Køkken",
      media: "media_player.kokken",
      media_volume_sensor: "sensor.vol_pct_koek",
      entities: [
        {
          type: "light",
          label: "Spots",
          entity_id: "light.kokken",
          allow_brightness: true,
        },
        {
          type: "switch",
          label: "Pendler",
          entity_id: "switch.kokken_pendler",
        },
      ],
    },
    {
      name: "Kontor",
      climate: "climate.kontor",
      entities: [
        {
          type: "light",
          label: "Skrivebord",
          entity_id: "light.kontor",
          allow_brightness: true,
        },
      ],
    },
  ],
};
