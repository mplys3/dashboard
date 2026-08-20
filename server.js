const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cheerio = require("cheerio");

const PORT = Number(process.env.PORT || 80);
const MEAL_PLANNER_URL = String(process.env.MEAL_PLANNER_URL || "http://10.0.0.82:8765").replace(/\/+$/, "");
const app = express();
app.use(express.json());

const SOURCES = [
  {
    name: "DR",
    url: "https://www.dr.dk/nyheder",
    baseUrl: "https://www.dr.dk",
    match: (href) => href.startsWith("https://www.dr.dk/nyheder"),
  },
  {
    name: "TV 2",
    url: "https://nyheder.tv2.dk",
    baseUrl: "https://nyheder.tv2.dk",
    match: (href) => href.startsWith("https://nyheder.tv2.dk"),
  },
];

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function normalizeHeadline(source, value) {
  const leadingLabels = new Set([
    "live",
    "udland",
    "indland",
    "sport",
    "vejret",
    "krimi",
    "business",
    "politik",
    "debat",
    "forbrug",
    "sundhed",
    "teknologi",
  ]);

  let title = cleanText(value)
    .replace(/([a-zæøå0-9])([A-ZÆØÅ])/g, "$1 $2")
    .replace(/([A-ZÆØÅ]{2,})([A-ZÆØÅ][a-zæøå])/g, "$1 $2");

  if (source.name === "TV 2") {
    title = title.replace(/^TV\s*2\s+/i, "");
  }

  const words = title.split(" ").filter(Boolean);
  const labels = [];
  while (words.length > 2 && leadingLabels.has(words[0].toLowerCase())) {
    labels.push(words.shift());
  }

  const visibleLabel = labels.find((label) => label.toLowerCase() !== "live");
  const headline = words.join(" ").trim();
  if (!headline) return "";

  return visibleLabel ? `${visibleLabel} - ${headline}` : headline;
}

function absoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function randomUrlSafeString(size) {
  return crypto
    .randomBytes(size)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkceChallenge(verifier) {
  return crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function getHaConnection(req) {
  const haUrl = String(req.headers["x-ha-url"] || "").trim().replace(/\/+$/, "");
  const haToken = String(req.headers["x-ha-token"] || "").trim();
  const isAddonMode = process.env.HA_DASHBOARD_ADDON_MODE === "1";

  if (isAddonMode && process.env.SUPERVISOR_TOKEN) {
    return {
      haUrl: "http://supervisor/core",
      haToken: process.env.SUPERVISOR_TOKEN,
    };
  }

  if (!haUrl || !/^https?:\/\//i.test(haUrl)) {
    return { error: "Manglende eller ugyldig Home Assistant URL." };
  }

  if (!haToken) {
    return { error: "Manglende Home Assistant token." };
  }

  return { haUrl, haToken };
}

async function proxyHomeAssistant(req, res, targetPath) {
  const connection = getHaConnection(req);
  if (connection.error) {
    res.status(400).json({ error: connection.error });
    return;
  }

  const url = `${connection.haUrl}${targetPath}`;

  try {
    const headers = {
      Authorization: `Bearer ${connection.haToken}`,
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : JSON.stringify(req.body || {}),
    });

    const contentType = response.headers.get("content-type") || "application/json";
    res.status(response.status);
    res.set("content-type", contentType);

    const isTextLike =
      contentType.includes("json") ||
      contentType.startsWith("text/") ||
      contentType.includes("xml") ||
      contentType.includes("javascript");

    if (isTextLike) {
      const text = await response.text();
      res.send(text);
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    res.status(502).json({
      error: `Home Assistant proxy fejlede: ${error.message}`,
    });
  }
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; SkipperDashboard/1.0; +https://example.local)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`Could not fetch ${url} (${response.status})`);
  }

  return response.text();
}

function extractAnchors($, root, source) {
  const seen = new Set();
  const items = [];

  root.find("a[href]").each((_, element) => {
    const href = cleanText($(element).attr("href"));
    const rawTitle = $(element).attr("aria-label") || $(element).attr("title") || $(element).text();
    const title = normalizeHeadline(source, rawTitle);
    if (!href || !title || title.length < 18) return;

    const absolute = absoluteUrl(source.baseUrl, href);
    if (!absolute || !source.match(absolute)) return;
    if (seen.has(absolute)) return;

    seen.add(absolute);
    items.push({
      source: source.name,
      title,
      url: absolute,
    });
  });

  return items;
}

function findMostReadSection($) {
  const sectionTerms = ["mest læste", "mest læst", "popular", "most viewed", "mest læs"];
  let found = null;

  $("h1, h2, h3, h4, span, div").each((_, element) => {
    if (found) return;

    const text = cleanText($(element).text()).toLowerCase();
    if (!sectionTerms.some((term) => text.includes(term))) return;

    const section = $(element).closest("section, article, div");
    if (section && section.length) {
      found = section;
    }
  });

  return found;
}

function extractNewsItems(html, source, limit = 5) {
  const $ = cheerio.load(html);
  const mostReadSection = findMostReadSection($);

  let items = [];
  if (mostReadSection) {
    items = extractAnchors($, mostReadSection, source);
  }

  if (!items.length) {
    items = extractAnchors($, $("main"), source);
  }

  if (!items.length) {
    items = extractAnchors($, $("body"), source);
  }

  return items.slice(0, limit);
}

async function fetchCombinedNews() {
  const results = await Promise.allSettled(
    SOURCES.map(async (source) => {
      const html = await fetchHtml(source.url);
      return extractNewsItems(html, source, 5);
    })
  );

  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

function shuffleItems(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

app.get("/api/news", async (_req, res) => {
  try {
    const items = shuffleItems(await fetchCombinedNews());
    res.json({
      items: items.slice(0, 10),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(502).json({
      error: error.message,
      items: [],
    });
  }
});

app.get("/api/meal-plan", async (_req, res) => {
  try {
    const [plansResponse, mealsResponse] = await Promise.all([
      fetch(`${MEAL_PLANNER_URL}/api/plans`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }),
      fetch(`${MEAL_PLANNER_URL}/api/meals`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }),
    ]);

    if (!plansResponse.ok) {
      throw new Error(`Madplansserveren svarede med status ${plansResponse.status}`);
    }

    const plans = await plansResponse.json();
    const meals = mealsResponse.ok ? await mealsResponse.json() : [];
    if (!Array.isArray(plans) || !Array.isArray(meals)) {
      throw new Error("Madplansserveren returnerede et ugyldigt svar");
    }

    res.json({
      plans,
      meals: meals.map((meal) => ({
        id: meal.id,
        name: meal.name,
        servings: meal.servings,
        ingredients: Array.isArray(meal.ingredients) ? meal.ingredients : [],
      })),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(502).json({
      error: `Kunne ikke hente ugens madplan: ${error.message}`,
      plans: [],
      meals: [],
    });
  }
});

app.get("/api/spotify/pkce", (_req, res) => {
  const verifier = randomUrlSafeString(72);
  const state = randomUrlSafeString(18);
  const challenge = createPkceChallenge(verifier);

  res.json({
    verifier,
    state,
    challenge,
  });
});

app.get("/api/ha/states/:entityId", async (req, res) => {
  await proxyHomeAssistant(req, res, `/api/states/${encodeURIComponent(req.params.entityId)}`);
});

app.get("/api/ha/config", async (req, res) => {
  await proxyHomeAssistant(req, res, "/api/config");
});

app.get("/api/ha/image", async (req, res) => {
  let requestedPath = String(req.query.path || "").trim();
  if (requestedPath.startsWith("%2F") || requestedPath.startsWith("%2f")) {
    try {
      requestedPath = decodeURIComponent(requestedPath);
    } catch {
      // Keep original value if decoding fails.
    }
  }

  if (!requestedPath || !requestedPath.startsWith("/")) {
    res.status(400).json({ error: "Manglende eller ugyldig billedsti." });
    return;
  }

  await proxyHomeAssistant(req, res, requestedPath);
});

app.get("/api/ha/history", async (req, res) => {
  const start = String(req.query.start || "").trim();
  if (!start) {
    res.status(400).json({ error: "Manglende start-tid til historik." });
    return;
  }

  const params = new URLSearchParams();
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (key === "start") return;
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, String(item)));
      return;
    }
    if (value != null && value !== "") {
      params.set(key, String(value));
    }
  });

  const targetPath = `/api/history/period/${encodeURIComponent(start)}${params.toString() ? `?${params.toString()}` : ""}`;
  await proxyHomeAssistant(req, res, targetPath);
});

app.get("/api/ha/calendars/:entityId", async (req, res) => {
  const params = new URLSearchParams();
  if (req.query.start) params.set("start", String(req.query.start));
  if (req.query.end) params.set("end", String(req.query.end));

  const targetPath = `/api/calendars/${encodeURIComponent(req.params.entityId)}${params.toString() ? `?${params.toString()}` : ""}`;
  await proxyHomeAssistant(req, res, targetPath);
});

app.post("/api/ha/services/:domain/:service", async (req, res) => {
  const params = new URLSearchParams();
  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, String(item)));
      return;
    }
    if (value != null) {
      params.set(key, String(value));
    }
  });

  await proxyHomeAssistant(
    req,
    res,
    `/api/services/${encodeURIComponent(req.params.domain)}/${encodeURIComponent(req.params.service)}${
      params.toString() ? `?${params.toString()}` : ""
    }`
  );
});

app.use(express.static(path.join(__dirname, "app")));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "app", "index.html"));
});

app.listen(PORT, () => {
  console.log(`ha-dashboard listening on ${PORT}`);
});
