#!/bin/sh
set -eu

APP_CONFIG="/app/app/config/ha-config.js"
OPTIONS_FILE="/data/options.json"
DEFAULT_CONFIG_PATH="/config/ha-dashboard/ha-config.js"

CONFIG_PATH="$(node - <<'NODE'
const fs = require("fs");
const optionsFile = "/data/options.json";
let options = {};
try {
  options = JSON.parse(fs.readFileSync(optionsFile, "utf8"));
} catch {
  options = {};
}
process.stdout.write(options.config_path || "/config/ha-dashboard/ha-config.js");
NODE
)"

if [ -f "${CONFIG_PATH}" ]; then
  echo "Using dashboard config from ${CONFIG_PATH}"
  cp "${CONFIG_PATH}" "${APP_CONFIG}"
elif [ -f "${DEFAULT_CONFIG_PATH}" ]; then
  echo "Using dashboard config from ${DEFAULT_CONFIG_PATH}"
  cp "${DEFAULT_CONFIG_PATH}" "${APP_CONFIG}"
else
  echo "No external dashboard config found. Using bundled config."
fi

node - <<'NODE'
const fs = require("fs");
const file = "/app/app/config/ha-config.js";
let content = fs.readFileSync(file, "utf8");
content = content.replace(/haUrl:\s*["'`][^"'`]*["'`]/, 'haUrl: ""');
content = content.replace(/haToken:\s*["'`][^"'`]*["'`]/, 'haToken: ""');
fs.writeFileSync(file, content);
NODE

export HA_DASHBOARD_ADDON_MODE=1
export PORT=80

exec npm start
