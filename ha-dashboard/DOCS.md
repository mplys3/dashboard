# Kronhjortloekken Dashboard

## Setup

1. Install the add-on from this repository.
2. Start the add-on once to let it create `/config/ha-dashboard/ha-config.js` from the bundled dashboard configuration.
3. Edit `/config/ha-dashboard/ha-config.js` if needed.
4. Restart the add-on.
5. Open the dashboard from the add-on page or from the sidebar panel.

## Configuration file

The file should follow the same shape as `app/config/ha-config.js` in the repository.

On first start, the add-on creates this file automatically if it does not already exist. Edit that file to customize rooms, entities, Spotify settings and system status sensors.

You do not need to set `haUrl` or `haToken` when running as an add-on. They are removed at startup and replaced by server-side Supervisor API access.

## Network

The add-on exposes port `80` inside the container. The default host port is `8088`, and Ingress is enabled.
