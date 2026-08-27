import json
import os
from datetime import datetime, timezone
from itertools import count
from math import atan2, cos, radians, sin, sqrt
from typing import Literal
from urllib import error as urllib_error
from urllib import request as urllib_request

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Disaster Response Intelligence API", version="1.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

Severity = Literal["Critical", "High", "Medium", "Low"]
Status = Literal["Reported", "Verified", "Dispatched", "Resolved"]
ServiceType = Literal["Ambulance", "Police", "Fire", "Rescue"]


class IncidentCreate(BaseModel):
    reporter: str = Field(min_length=2, max_length=80)
    phone: str = Field(default="", max_length=30)
    location: str = Field(min_length=2, max_length=160)
    description: str = Field(min_length=5, max_length=2000)
    people_affected: int = Field(default=1, ge=0, le=100000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class StatusUpdate(BaseModel):
    status: Status


class DispatchRequestCreate(BaseModel):
    station_id: int
    confirmed_by: str = Field(min_length=2, max_length=80)
    human_verified: bool
    notes: str = Field(default="", max_length=500)


counter = count(1001)
dispatch_counter = count(5001)
incidents: list[dict] = []
dispatch_requests: list[dict] = []

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
MEDICAL_WORDS = ["injured", "injury", "bleeding", "medical", "unconscious", "ambulance", "hospital", "critical"]
RESCUE_WORDS = ["trapped", "stuck", "buried", "rescue", "collapse", "collapsed", "flood", "drowning", "landslide"]
POLICE_WORDS = ["missing", "lost", "road", "blocked", "traffic", "crowd", "unsafe"]
FIRE_WORDS = ["fire", "smoke", "burning", "flame", "explosion", "electrical"]

DEFAULT_COORDINATES = (26.4499, 80.3319)
KNOWN_COORDINATES = {
    "civil lines": (26.4761, 80.3447),
    "riverside colony": (26.5022, 80.3194),
    "highway sector 4": (26.4286, 80.3631),
    "green park": (26.4413, 80.3187),
}

# Demo response network. Replace these records with verified agency data before
# operational use. No phone numbers are exposed to the public client.
RESPONSE_STATIONS = [
    {
        "id": 201,
        "name": "Central Ambulance Unit",
        "services": ["Ambulance"],
        "latitude": 26.4718,
        "longitude": 80.3504,
        "availability": "Available",
        "control_channel": "MED-CENTRAL",
    },
    {
        "id": 202,
        "name": "Civil Lines Police Control",
        "services": ["Police"],
        "latitude": 26.4802,
        "longitude": 80.3378,
        "availability": "Available",
        "control_channel": "POL-NORTH",
    },
    {
        "id": 203,
        "name": "South Fire and Rescue Unit",
        "services": ["Fire", "Rescue"],
        "latitude": 26.4275,
        "longitude": 80.3445,
        "availability": "Available",
        "control_channel": "FIRE-SOUTH",
    },
    {
        "id": 204,
        "name": "River Rescue Unit",
        "services": ["Rescue", "Ambulance"],
        "latitude": 26.5058,
        "longitude": 80.3144,
        "availability": "Available",
        "control_channel": "RESCUE-RIVER",
    },
    {
        "id": 205,
        "name": "East Emergency Support Post",
        "services": ["Police", "Ambulance"],
        "latitude": 26.4451,
        "longitude": 80.3786,
        "availability": "Available",
        "control_channel": "MULTI-EAST",
    },
]


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


def infer_required_services(category: str, description: str) -> list[ServiceType]:
    text = description.lower()
    services: list[ServiceType] = []

    if category == "Medical Emergency" or any(word in text for word in MEDICAL_WORDS):
        services.append("Ambulance")
    if category == "Fire" or any(word in text for word in FIRE_WORDS):
        services.append("Fire")
    if category in {"Trapped People", "Flood", "Collapsed Building"} or any(word in text for word in RESCUE_WORDS):
        services.append("Rescue")
    if category in {"Road Blockage", "Missing Person"} or any(word in text for word in POLICE_WORDS):
        services.append("Police")
    if not services:
        services.append("Police")

    return list(dict.fromkeys(services))


def infer_coordinates(location: str, incident_id: int) -> tuple[float, float]:
    normalized = location.lower()
    for name, coordinates in KNOWN_COORDINATES.items():
        if name in normalized:
            return coordinates

    offset = (incident_id % 9 - 4) * 0.004
    return DEFAULT_COORDINATES[0] + offset, DEFAULT_COORDINATES[1] - offset / 2


def distance_km(latitude_a: float, longitude_a: float, latitude_b: float, longitude_b: float) -> float:
    earth_radius_km = 6371.0
    latitude_delta = radians(latitude_b - latitude_a)
    longitude_delta = radians(longitude_b - longitude_a)
    start_latitude = radians(latitude_a)
    end_latitude = radians(latitude_b)
    haversine = sin(latitude_delta / 2) ** 2 + cos(start_latitude) * cos(end_latitude) * sin(longitude_delta / 2) ** 2
    return earth_radius_km * 2 * atan2(sqrt(haversine), sqrt(1 - haversine))


def get_incident(incident_id: int) -> dict:
    for incident in incidents:
        if incident["id"] == incident_id:
            return incident
    raise HTTPException(status_code=404, detail="Incident not found")


def get_station(station_id: int) -> dict:
    for station in RESPONSE_STATIONS:
        if station["id"] == station_id:
            return station
    raise HTTPException(status_code=404, detail="Response station not found")


def build_recommendations(incident: dict) -> list[dict]:
    recommendations = []
    required_services = set(incident["required_services"])
    for station in RESPONSE_STATIONS:
        matching_services = sorted(required_services.intersection(station["services"]))
        if not matching_services or station["availability"] != "Available":
            continue

        station_distance = distance_km(
            incident["latitude"],
            incident["longitude"],
            station["latitude"],
            station["longitude"],
        )
        estimated_eta = max(4, round((station_distance / 35) * 60 + 3))
        recommendations.append(
            {
                **station,
                "matching_services": matching_services,
                "distance_km": round(station_distance, 1),
                "estimated_eta_minutes": estimated_eta,
                "reason": f"Nearest available unit supporting {', '.join(matching_services)}",
            }
        )

    return sorted(recommendations, key=lambda item: (item["distance_km"], item["estimated_eta_minutes"]))[:4]


def deliver_dispatch(payload: dict) -> tuple[str, str]:
    webhook_url = os.getenv("DISPATCH_WEBHOOK_URL", "").strip()
    webhook_token = os.getenv("DISPATCH_WEBHOOK_TOKEN", "").strip()
    if not webhook_url:
        return "Simulation", "Recorded"

    headers = {"Content-Type": "application/json"}
    if webhook_token:
        headers["Authorization"] = f"Bearer {webhook_token}"

    outbound_request = urllib_request.Request(
        webhook_url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib_request.urlopen(outbound_request, timeout=5) as response:
            if 200 <= response.status < 300:
                return "Configured agency webhook", "Sent"
    except (urllib_error.URLError, TimeoutError, ValueError):
        return "Configured agency webhook", "Delivery failed"
    return "Configured agency webhook", "Delivery failed"


def seed():
    if incidents:
        return
    samples = [
        ("Asha", "Civil Lines, Kanpur", "Two people trapped inside a collapsed building, one person injured", 3, 26.4761, 80.3447),
        ("Rahul", "Riverside Colony, Kanpur", "Flood water entering houses; elderly residents need rescue", 12, 26.5022, 80.3194),
        ("Control Room", "Highway Sector 4, Kanpur", "Large tree blocking road after storm, traffic stopped", 0, 26.4286, 80.3631),
    ]
    for reporter, location, description, people, latitude, longitude in samples:
        create_incident(
            IncidentCreate(
                reporter=reporter,
                location=location,
                description=description,
                people_affected=people,
                latitude=latitude,
                longitude=longitude,
            )
        )


def create_incident(payload: IncidentCreate):
    category, severity, priority = classify(payload.description, payload.people_affected)
    required_services = infer_required_services(category, payload.description)
    incident_id = next(counter)
    latitude = payload.latitude
    longitude = payload.longitude
    if latitude is None or longitude is None:
        latitude, longitude = infer_coordinates(payload.location, incident_id)

    incident = {
        "id": incident_id,
        **payload.model_dump(),
        "latitude": latitude,
        "longitude": longitude,
        "category": category,
        "severity": severity,
        "priority_score": priority,
        "required_services": required_services,
        "dispatch_status": "Not requested",
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
    return {"status": "ok", "service": "disaster-response-intelligence", "dispatch_mode": "configured" if os.getenv("DISPATCH_WEBHOOK_URL") else "simulation"}


@app.get("/api/incidents")
def list_incidents():
    return sorted(incidents, key=lambda item: (item["status"] == "Resolved", -item["priority_score"], item["id"]))


@app.get("/api/stations")
def list_stations():
    return RESPONSE_STATIONS


@app.get("/api/stats")
def stats():
    active = [incident for incident in incidents if incident["status"] != "Resolved"]
    return {
        "total": len(incidents),
        "active": len(active),
        "critical": sum(incident["severity"] == "Critical" and incident["status"] != "Resolved" for incident in incidents),
        "dispatched": sum(incident["status"] == "Dispatched" for incident in incidents),
        "dispatch_requests": len(dispatch_requests),
        "resolved": sum(incident["status"] == "Resolved" for incident in incidents),
        "people_affected": sum(incident["people_affected"] for incident in active),
    }


@app.post("/api/incidents", status_code=201)
def report_incident(payload: IncidentCreate):
    return create_incident(payload)


@app.get("/api/incidents/{incident_id}/dispatch-recommendations")
def dispatch_recommendations(incident_id: int):
    incident = get_incident(incident_id)
    return {
        "incident_id": incident_id,
        "required_services": incident["required_services"],
        "human_approval_required": True,
        "recommendations": build_recommendations(incident),
    }


@app.get("/api/incidents/{incident_id}/dispatch-requests")
def list_dispatch_requests(incident_id: int):
    get_incident(incident_id)
    return [item for item in dispatch_requests if item["incident_id"] == incident_id]


@app.post("/api/incidents/{incident_id}/dispatch-requests", status_code=201)
def create_dispatch_request(incident_id: int, payload: DispatchRequestCreate):
    incident = get_incident(incident_id)
    station = get_station(payload.station_id)

    if not payload.human_verified:
        raise HTTPException(status_code=400, detail="A dispatcher must verify the incident before sending a request")
    if station["availability"] != "Available":
        raise HTTPException(status_code=409, detail="The selected response station is not currently available")
    if not set(station["services"]).intersection(incident["required_services"]):
        raise HTTPException(status_code=400, detail="The selected station does not provide a required service")
    if any(
        item["incident_id"] == incident_id
        and item["station_id"] == station["id"]
        and item["delivery_status"] in {"Recorded", "Sent"}
        for item in dispatch_requests
    ):
        raise HTTPException(status_code=409, detail="A request has already been created for this incident and station")

    minimum_necessary_payload = {
        "incident_id": incident["id"],
        "location": incident["location"],
        "latitude": incident["latitude"],
        "longitude": incident["longitude"],
        "severity": incident["severity"],
        "category": incident["category"],
        "people_affected": incident["people_affected"],
        "required_services": incident["required_services"],
        "station_id": station["id"],
        "control_channel": station["control_channel"],
        "confirmed_by": payload.confirmed_by,
        "notes": payload.notes,
    }
    delivery_mode, delivery_status = deliver_dispatch(minimum_necessary_payload)
    dispatch_request = {
        "id": next(dispatch_counter),
        "incident_id": incident_id,
        "station_id": station["id"],
        "station_name": station["name"],
        "services": sorted(set(station["services"]).intersection(incident["required_services"])),
        "confirmed_by": payload.confirmed_by,
        "delivery_mode": delivery_mode,
        "delivery_status": delivery_status,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    dispatch_requests.append(dispatch_request)

    incident["status"] = "Dispatched" if delivery_status == "Sent" else "Verified"
    incident["dispatch_status"] = f"{delivery_status} via {delivery_mode}"
    operational_notice = (
        "Request sent through the configured agency gateway."
        if delivery_status == "Sent"
        else "Demo request recorded. No real emergency agency was contacted."
        if delivery_mode == "Simulation"
        else "The configured agency gateway did not confirm delivery."
    )
    return {**dispatch_request, "operational_notice": operational_notice}


@app.patch("/api/incidents/{incident_id}/status")
def update_status(incident_id: int, payload: StatusUpdate):
    incident = get_incident(incident_id)
    incident["status"] = payload.status
    return incident


@app.delete("/api/incidents/{incident_id}", status_code=204)
def delete_incident(incident_id: int):
    for index, incident in enumerate(incidents):
        if incident["id"] == incident_id:
            incidents.pop(index)
            return
    raise HTTPException(status_code=404, detail="Incident not found")
