window.APP_CONFIG = {
  haUrl: "http://192.168.0.50:8123",
  haToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIxMjllYjRlZjZhOTE0ODAyYmEzNWI2ZDE0NWQ3OTQwMiIsImlhdCI6MTc3NjU0ODUyNiwiZXhwIjoyMDkxOTA4NTI2fQ.6fqtGke_Wrjm7e2Deb8_kSF8qde1W2Lcm-vRK-QEBf0",

  dashboardTitle: "Kronhjortl\u00f8kken 172",
  dashboardSubtitle: "",
  timeZone: "Europe/Copenhagen",
  refreshIntervalMs: 5000,

  calendar: {
    entityId: "calendar.skipsen_og_mulles_kalender",
    label: "Mulle Og Skipsens Kalender",
    subtitle: "Kommende aftaler",
    daysAhead: 7,
    maxItems: 6,
  },

  systemStatus: {
    weather: "weather.forecast_hjem",
    electricity: "sensor.energi_data_service",
    charger: "sensor.monta_kronhjortlokken_172_sidste_opladning",
    waste: [
      "sensor.affalddk_kronhjortlokken_172_pap_papir_glas_metal",
      "sensor.affalddk_kronhjortlokken_172_plast_mad_drikkekartoner",
    ],
    unraid: {
      ram: "sensor.skipserv_ram_usage",
      cpu: "sensor.skipserv_cpu_usage",
      cpuTemp: "sensor.skipserv_cpu_temperature",
      uptime: "sensor.skipserv_uptime",
    },
  },

  spotify: {
    clientId: "578cd43ba7ac437f9c8d351f50bf75f8",
    entity_id: "media_player.spotify_skipperpiben",
    label: "Spotify",
    room: "Spotify",
    drP4FynStreamUrl: "http://live-icy.gss.dr.dk:8000/A/A07L.mp3",
    testPlaylistUri: "https://open.spotify.com/playlist/37i9dQZF1DX52kuWtQdNIb?si=b9ef35921db74b9c",
    playlists: [
      // Indsæt dine egne Spotify-playlister her.
      // Brug enten playlist-link eller spotify:playlist:... URI.
      // { label: "Morgenmusik", uri: "https://open.spotify.com/playlist/..." },
      // { label: "Fredag", uri: "spotify:playlist:37i9dQZF1DX..." },
    ],
  },

  rooms: [
    {
      name: "Kontor",
      climate: "climate.gaestevaerelse",
      media: "media_player.frederikkes_vaerelse",
      entities: [
        {
          type: "light",
          label: "Spots",
          entity_id: "light.spots_kontor",
          allow_brightness: true,
        },
      ],
    },
    {
      name: "Spisestue",
      entities: [
        {
          type: "light",
          label: "Pendler",
          entity_id: "light.daemper_pendler_spisebord",
          allow_brightness: true,
        },
        {
          type: "light",
          label: "Spots",
          entity_id: "light.daemper_spots_spisebord",
          allow_brightness: true,
        },
      ],
    },
    {
      name: "Stue",
      climate: "climate.stue",
      media: "media_player.stue_playbar",
      entities: [
        {
          type: "light",
          label: "Spots",
          entity_id: "light.daemper_stue",
          allow_brightness: true,
        },
        {
          type: "light",
          label: "Pendel",
          entity_id: "light.spots_reol_lampeudtag",
          allow_brightness: true,
        },
      ],
    },
    {
      name: "Mathildes Værelse",
      climate: "climate.mathilde",
      entities: [
        {
          type: "light",
          label: "Lys",
          entity_id: "light.mathildes_vaerelse_gen_3_tulles_vaerelse_sg_eco_dtw",
          allow_brightness: true,
        },
      ],
    },
    {
      name: "Frederikkes Værelse",
      climate: "climate.frederikke",
      entities: [
        {
          type: "light",
          label: "Lys",
          entity_id: "light.daemper_spots",
          allow_brightness: true,
        },
      ],
    },
    {
      name: "Køkken",
      media: "media_player.familierum",
      media_volume_sensor: "sensor.vol_pct_koek",
      entities: [
        {
          type: "light",
          label: "Spots",
          entity_id: "light.daemper_kokken",
          allow_brightness: true,
        },
        {
          type: "switch",
          label: "Pendler",
          entity_id: "switch.kip_kokken",
        },
      ],
    },
    {
      name: "Forældre Soveværelse",
      climate: "climate.sovevaerelse",
      entities: [
        {
          type: "light",
          label: "Lys",
          entity_id: "light.sovevaerelse",
          allow_brightness: true,
        },
      ],
    },
    {
      name: "Forældre Badeværelse",
      media: "media_player.sovevaerelse",
      entities: [
        {
          type: "light",
          label: "Lys",
          entity_id: "light.shellydimmerg4_acebe6e8f3dc",
          allow_brightness: true,
        },
      ],
    },
    {
      name: "Børne Badeværelse",
      climate: "climate.lille_badevaerelse",
      entities: [],
    },
    {
      name: "Entré",
      entities: [
        {
          type: "light",
          label: "Lys",
          entity_id: "light.daemper_entre",
          allow_brightness: true,
        },
      ],
    },
  ],
};
