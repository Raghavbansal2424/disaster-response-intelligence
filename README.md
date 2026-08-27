# Disaster Response Intelligence System

A full-stack emergency-response platform for collecting incident reports, classifying urgency, identifying likely incident type, visualizing incidents, and helping response teams prioritize rescue operations.

## Features

- Citizen / volunteer incident reporting
- Automatic urgency scoring (Critical / High / Medium / Low)
- Incident classification: trapped people, injuries, flood, fire, collapsed building, road blockage, missing persons, medical emergencies, and more
- Duplicate-aware incident workflow
- Operations dashboard with live counters and priority queue
- Status management: Reported → Verified → Dispatched → Resolved
- FastAPI backend with REST API
- Responsive frontend with no build step required
- Docker support

## Project structure

```text
backend/
  main.py
  requirements.txt
frontend/
  index.html
  app.js
  styles.css
Dockerfile
docker-compose.yml
.gitignore
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

Open `frontend/index.html` in your browser. The frontend calls `http://localhost:8000` by default.

## Docker

```bash
docker compose up --build
```

Then open http://localhost:8080

## API

- `GET /health`
- `GET /api/incidents`
- `GET /api/stats`
- `POST /api/incidents`
- `PATCH /api/incidents/{incident_id}/status`
- `DELETE /api/incidents/{incident_id}`

## Demo

Original ChatGPT-hosted prototype: https://disaster-response-intelligence.rv9889777798.chatgpt.site

## Notes

The current AI-style classifier is deterministic and runs locally so the project works without paid API keys. It can later be replaced with Gemini/OpenAI/other models for richer multilingual and multimodal analysis.
