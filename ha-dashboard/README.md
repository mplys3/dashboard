# Kronhjortloekken Dashboard

Custom Home Assistant dashboard packaged as an add-on.

The add-on serves the dashboard on port 80 and can also be opened through Home Assistant Ingress.

## Configuration

By default the add-on looks for:

```text
/config/ha-dashboard/ha-config.js
```

If that file exists, it is copied into the dashboard at startup. If it does not exist, the add-on creates it from the bundled config on first start.

When running as a Home Assistant add-on, `haUrl` and `haToken` are intentionally cleared at startup. The server talks to Home Assistant through the Supervisor API using the internal add-on token.
