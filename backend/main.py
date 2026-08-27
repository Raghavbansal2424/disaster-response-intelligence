from datetime import datetime, timezone
from itertools import count
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Disaster Response Intelligence API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

Severity = Literal["Critical", "High", "Medium", "Low"]
Status = Literal["Reported", "Verified", "Dispatched", "Resolved"]

class IncidentCreate(BaseModel):
    reporter: str = Field(min_length=2, max_length=80)
    phone: str = Field(default="", max_length=30)
    location: str = Field(min_length=2, max_length=160)
    description: str = Field(min_length=5, max_length=2000)
    people_affected: int = Field(default=1, ge=0, le=100000)

class StatusUpdate(BaseModel):
    status: Status

counter = count(1001)
incidents: list[dict] = []

KEYWORDS = {
    "Medical Emergency": ["injured", "injury", "bleeding", "medical", "unconscious", "hospital", "ambulance"],
    "Trapped People": ["trapped", "stuck", "buried", "rescue", "inside"],
    "Flood": ["flood", "water", "submerged", "river", "rain"],
    "Fire": ["fire", "smoke", "burning", "flame", "explosion"],
    "Collapsed Building": ["collapse", "collapsed", "building", "debris", "rubble"],
    "Road Blockage": ["road", "blocked", "tree", "landslide", "bridge"],
    "Missing Person": ["missing", "lost", "not found"],
}

CRITICAL_WORDS = ["unconscious", "bleeding", "trapped", "collapse", "collapsed", "fire", "explosion", "drowning", "critical", "dead"]
HIGH_WORDS = ["injured", "flood", "rescue", "medical", "landslide", "blocked", "missing"]


def classify(description: str, people: int) -> tuple[str, Severity, int]:
    text = description.lower()
    category = "General Emergency"
    best = 0
    for name, words in KEYWORDS.items():
        score = sum(word in text for word in words)
        if score > best:
            best, category = score, name

    critical_hits = sum(word in text for word in CRITICAL_WORDS)
    high_hits = sum(word in text for word in HIGH_WORDS)
    score = min(100, 20 + critical_hits * 25 + high_hits * 12 + min(people, 20) * 2)
    if score >= 75 or people >= 20:
        severity: Severity = "Critical"
    elif score >= 50 or people >= 8:
        severity = "High"
    elif score >= 30:
        severity = "Medium"
    else:
        severity = "Low"
    return category, severity, score


def seed():
    if incidents:
        return
    samples = [
        ("Asha", "Civil Lines", "Two people trapped inside a collapsed building, one person injured", 3),
        ("Rahul", "Riverside Colony", "Flood water entering houses; elderly residents need rescue", 12),
        ("Control Room", "Highway Sector 4", "Large tree blocking road after storm, traffic stopped", 0),
    ]
    for reporter, location, description, people in samples:
        create_incident(IncidentCreate(reporter=reporter, location=location, description=description, people_affected=people))


def create_incident(payload: IncidentCreate):
    category, severity, priority = classify(payload.description, payload.people_affected)
    incident = {
        "id": next(counter),
        **payload.model_dump(),
        "category": category,
        "severity": severity,
        "priority_score": priority,
        "status": "Reported",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    incidents.append(incident)
    return incident

@app.on_event("startup")
def startup():
    seed()

@app.get("/health")
def health():
    return {"status": "ok", "service": "disaster-response-intelligence"}

@app.get("/api/incidents")
def list_incidents():
    return sorted(incidents, key=lambda x: (x["status"] == "Resolved", -x["priority_score"], x["id"]))

@app.get("/api/stats")
def stats():
    active = [i for i in incidents if i["status"] != "Resolved"]
    return {
        "total": len(incidents),
        "active": len(active),
        "critical": sum(i["severity"] == "Critical" and i["status"] != "Resolved" for i in incidents),
        "dispatched": sum(i["status"] == "Dispatched" for i in incidents),
        "resolved": sum(i["status"] == "Resolved" for i in incidents),
        "people_affected": sum(i["people_affected"] for i in active),
    }

@app.post("/api/incidents", status_code=201)
def report_incident(payload: IncidentCreate):
    return create_incident(payload)

@app.patch("/api/incidents/{incident_id}/status")
def update_status(incident_id: int, payload: StatusUpdate):
    for incident in incidents:
        if incident["id"] == incident_id:
            incident["status"] = payload.status
            return incident
    raise HTTPException(status_code=404, detail="Incident not found")

@app.delete("/api/incidents/{incident_id}", status_code=204)
def delete_incident(incident_id: int):
    for index, incident in enumerate(incidents):
        if incident["id"] == incident_id:
            incidents.pop(index)
            return
    raise HTTPException(status_code=404, detail="Incident not found")
