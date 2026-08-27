# Disaster Response Intelligence System

A full-stack emergency-response platform for collecting incident reports, classifying urgency, mapping incidents, and helping human dispatchers coordinate the nearest capable response unit.

## Features

- Citizen and volunteer incident reporting with optional GPS coordinates
- Automatic urgency scoring: Critical, High, Medium, or Low
- Incident classification for medical emergencies, trapped people, floods, fires, collapsed buildings, road blockages, and missing persons
- Live Leaflet/OpenStreetMap incident and response-station map
- Capability-aware matching for ambulance, police, fire, and rescue units
- Haversine distance and estimated response time calculations
- Human verification before any dispatch request can be sent
- Dispatch delivery adapter with safe demo mode and optional authorized agency webhook
- Status workflow: Reported → Verified → Dispatched → Resolved
- FastAPI REST backend and responsive frontend
- Docker and Vercel support

## Safety model

The recommendation engine does not automatically dispatch emergency resources. It ranks nearby available stations using required service, distance, and estimated travel time. A dispatcher must verify the incident, choose a station, and explicitly confirm the request.

Without `DISPATCH_WEBHOOK_URL`, requests are recorded in **Simulation** mode and no real agency is contacted. Real deployment requires a verified agency webhook, SMS gateway, or control-room integration and approved station data.

Only the minimum necessary incident fields are sent to a configured dispatch webhook. Citizen phone numbers and reporter details are excluded.

## Project structure

```text
backend/
  main.py
  requirements.txt
frontend/
  Dockerfile
  nginx.conf
public/
  index.html
  app.js
  styles.css
  dispatch.css
app.py
docker-compose.yml
.env.example
```

## Run locally

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Open `public/index.html` in a browser. The frontend calls `http://localhost:8000` by default.

## Docker

```bash
docker compose up --build
```

Then open http://localhost:8080.

## Dispatch integration

Copy `.env.example` to `.env` and configure an approved gateway:

```env
DISPATCH_WEBHOOK_URL=https://your-authorized-gateway.example/dispatch
DISPATCH_WEBHOOK_TOKEN=replace-with-a-secret-token
```

The gateway receives incident ID, location, coordinates, severity, category, people affected, required services, station/control channel, dispatcher name, and dispatch notes. It does not receive the citizen's phone number or reporter name.

## API

- `GET /health`
- `GET /api/incidents`
- `GET /api/stations`
- `GET /api/stats`
- `POST /api/incidents`
- `PATCH /api/incidents/{incident_id}/status`
- `GET /api/incidents/{incident_id}/dispatch-recommendations`
- `GET /api/incidents/{incident_id}/dispatch-requests`
- `POST /api/incidents/{incident_id}/dispatch-requests`
- `DELETE /api/incidents/{incident_id}`

## Production note

The current hosted MVP uses in-memory demo data. Connect PostgreSQL/PostGIS before operational use so incidents, stations, dispatch requests, and audit history persist across serverless restarts.
