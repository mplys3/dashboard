# Changelog

## 1.0.4

- Restores the original responsive overview-card layout.
- Moves the weekly meal plan into its own panel above Media in the right column.

## 1.0.3

- Cache-busts dashboard assets so browsers load the new meal-plan UI immediately after deployment.

## 1.0.2

- Invalidates the Docker source layer for every add-on version so deployments always include the latest dashboard assets.

## 1.0.1

- Adds a responsive weekly meal-plan overview backed by the local Meal Planner.
- Places the meal plan directly below the charger and waste-pickup cards.
- Opens Meal Planner at `10.0.0.82:8765` from the dashboard card.
- Migrates the office spots from the retired entity to the new Zigbee light entity.

## 1.0.0

- Initial Home Assistant add-on wrapper for the dashboard.
- Builds directly from the public GitHub repository to avoid GHCR authentication during add-on installation.
- Adds Home Assistant Supervisor API fallback for dashboard proxy calls.
