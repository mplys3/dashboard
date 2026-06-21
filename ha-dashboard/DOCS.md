# Kronhjortloekken Dashboard

## Setup

1. Install the add-on from this repository.
2. Create `/config/ha-dashboard/ha-config.js` in Home Assistant if you want to override the bundled dashboard configuration.
3. Start the add-on.
4. Open the dashboard from the add-on page or from the sidebar panel.

## Configuration file

The file should follow the same shape as `app/config/ha-config.js` in the repository.

You do not need to set `haUrl` or `haToken` when running as an add-on. They are removed at startup and replaced by server-side Supervisor API access.

## Network

The add-on exposes port `80` inside the container. The default host port is `8088`, and Ingress is enabled.
