const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API = window.location.port === '8080' ? '/api-proxy' : (localHost ? 'http://localhost:8000' : '');
const $ = selector => document.querySelector(selector);
const reportDialog = $('#reportDialog');
const dispatchDialog = $('#dispatchDialog');
const DEFAULT_CENTER = [26.4499, 80.3319];
const PRIORITY_COLORS = {Critical:'#c7382e', High:'#e29218', Medium:'#3d72c3', Low:'#2b9861'};
const SERVICE_ICONS = {Ambulance:'✚', Police:'◆', Fire:'▲', Rescue:'●'};
const KNOWN_LOCATIONS = {
  'civil lines': [26.4761, 80.3447],
  'riverside colony': [26.5022, 80.3194],
  'highway sector 4': [26.4286, 80.3631],
  'green park': [26.4413, 80.3187]
};

let incidentMap;
let incidentLayer;
let stationLayer;
let latestIncidents = [];
let latestStations = [];
let activeDispatchIncident;
const mapMarkers = new Map();

$('#openReport').onclick = () => reportDialog.showModal();
$('#closeReport').onclick = () => reportDialog.close();
$('#closeDispatch').onclick = () => dispatchDialog.close();
$('#refresh').onclick = load;

const nextStatus = {Reported:'Verified', Verified:'Dispatched', Dispatched:'Resolved'};

function esc(value='') {
  return String(value).replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.setTimeout(() => toast.classList.remove('visible'), 4200);
}

async function request(path, options={}) {
  const base = API === '/api-proxy' ? '' : API;
  const actual = API === '/api-proxy' ? path.replace('/api/','/api-proxy/') : path;
  const response = await fetch(base + actual, {headers:{'Content-Type':'application/json'}, ...options});
  if (!response.ok) {
    throw new Error((await response.json().catch(() => ({detail:'Request failed'}))).detail || 'Request failed');
  }
  return response.status === 204 ? null : response.json();
}

function initializeMap() {
  if (incidentMap || !window.L) return Boolean(incidentMap);

  incidentMap = L.map('incidentMap', {zoomControl:true, scrollWheelZoom:true}).setView(DEFAULT_CENTER, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(incidentMap);
  stationLayer = L.featureGroup().addTo(incidentMap);
  incidentLayer = L.featureGroup().addTo(incidentMap);
  requestAnimationFrame(() => incidentMap.invalidateSize());
  return true;
}

function coordinatesFor(incident) {
  const latitude = Number(incident.latitude);
  const longitude = Number(incident.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0) {
    return [latitude, longitude];
  }

  const location = String(incident.location || '').toLowerCase();
  const known = Object.entries(KNOWN_LOCATIONS).find(([name]) => location.includes(name));
  if (known) return known[1];

  const offset = ((Number(incident.id) || 1) % 9 - 4) * 0.004;
  return [DEFAULT_CENTER[0] + offset, DEFAULT_CENTER[1] - offset / 2];
}

function renderMap(incidents, stations) {
  if (!initializeMap()) {
    $('#mapStatus').textContent = 'Map service unavailable';
    return;
  }

  incidentLayer.clearLayers();
  stationLayer.clearLayers();
  mapMarkers.clear();
  const active = incidents.filter(incident => incident.status !== 'Resolved');

  stations.forEach(station => {
    const services = station.services.map(service => `${SERVICE_ICONS[service] || '•'} ${service}`).join(' · ');
    L.circleMarker([station.latitude, station.longitude], {
      radius: 7,
      color: '#0d5c49',
      weight: 2,
      fillColor: '#ffffff',
      fillOpacity: 1,
      dashArray: '3 2'
    }).bindTooltip(station.name, {direction:'top'})
      .bindPopup(`<div class="station-popup"><strong>${esc(station.name)}</strong><p>${esc(services)}</p><span class="dispatch-chip">${esc(station.availability)}</span></div>`)
      .addTo(stationLayer);
  });

  active.forEach(incident => {
    const coordinates = coordinatesFor(incident);
    const marker = L.circleMarker(coordinates, {
      radius: incident.severity === 'Critical' ? 12 : 10,
      color: '#ffffff',
      weight: 3,
      fillColor: PRIORITY_COLORS[incident.severity] || PRIORITY_COLORS.Medium,
      fillOpacity: 0.96
    });
    marker.bindTooltip(`${incident.severity}: ${incident.location}`, {direction:'top'});
    marker.bindPopup(`<div class="map-popup"><div class="incident-top"><span class="badge ${esc(incident.severity)}">${esc(incident.severity)}</span><span class="badge">Priority ${incident.priority_score}</span></div><strong>#${incident.id} · ${esc(incident.location)}</strong><p>${esc(incident.description)}</p><small>${incident.people_affected} people affected · ${esc(incident.status)}</small></div>`);
    marker.addTo(incidentLayer);
    mapMarkers.set(Number(incident.id), marker);
  });

  if (active.length > 1) {
    incidentMap.fitBounds(incidentLayer.getBounds(), {padding:[42, 42], maxZoom:14});
  } else if (active.length === 1) {
    incidentMap.setView(coordinatesFor(active[0]), 14);
  } else {
    incidentMap.setView(DEFAULT_CENTER, 12);
  }

  $('#mapStatus').textContent = `${active.length} active incident${active.length === 1 ? '' : 's'} · ${stations.length} response stations`;
}

function focusIncident(id) {
  const marker = mapMarkers.get(id);
  if (!marker || !incidentMap) return;
  $('#incidentMap').scrollIntoView({behavior:'smooth', block:'center'});
  window.setTimeout(() => {
    incidentMap.setView(marker.getLatLng(), Math.max(incidentMap.getZoom(), 14), {animate:true});
    marker.openPopup();
  }, 350);
}

async function load() {
  try {
    const [stats, incidents, stations] = await Promise.all([
      request('/api/stats'),
      request('/api/incidents'),
      request('/api/stations')
    ]);
    latestIncidents = incidents;
    latestStations = stations;
    $('#stats').innerHTML = [
      ['Active incidents',stats.active],
      ['Critical',stats.critical],
      ['Requests recorded',stats.dispatch_requests],
      ['Resolved',stats.resolved],
      ['People affected',stats.people_affected]
    ].map(([label,value]) => `<div class="stat"><small>${label}</small><strong>${value}</strong></div>`).join('');
    $('#incidents').innerHTML = incidents.length ? incidents.map(card).join('') : '<p class="muted">No incidents reported.</p>';
    renderMap(incidents, stations);
    document.querySelectorAll('[data-next]').forEach(button => button.onclick = () => changeStatus(Number(button.dataset.id), button.dataset.next));
    document.querySelectorAll('[data-focus]').forEach(button => button.onclick = () => focusIncident(Number(button.dataset.focus)));
    document.querySelectorAll('[data-dispatch]').forEach(button => button.onclick = () => openDispatch(Number(button.dataset.dispatch)));
  } catch (error) {
    $('#incidents').innerHTML = '<p class="muted">The incident service is temporarily unavailable. Please refresh in a moment.</p>';
    $('#mapStatus').textContent = 'Incident data unavailable';
  }
}

function serviceTags(services=[]) {
  return `<div class="service-tags">${services.map(service => `<span class="service-tag">${SERVICE_ICONS[service] || '•'} ${esc(service)}</span>`).join('')}</div>`;
}

function card(incident) {
  const next = nextStatus[incident.status];
  const canDispatch = incident.status !== 'Resolved';
  const dispatchStatus = incident.dispatch_status && incident.dispatch_status !== 'Not requested'
    ? `<span class="dispatch-chip">${esc(incident.dispatch_status)}</span>`
    : '';
  return `<article class="incident"><div><div class="incident-top"><span class="badge ${esc(incident.severity)}">${esc(incident.severity)}</span><span class="badge">${esc(incident.category)}</span><span class="badge">Priority ${incident.priority_score}</span><span class="badge">${esc(incident.status)}</span></div><h3>#${incident.id} · ${esc(incident.location)}</h3><p>${esc(incident.description)}</p>${serviceTags(incident.required_services)}${dispatchStatus}<small>${esc(incident.reporter)} · ${incident.people_affected} people affected · ${new Date(incident.created_at).toLocaleString()}</small></div><div class="actions"><button class="secondary" data-focus="${incident.id}">Show on map</button>${canDispatch ? `<button class="dispatch-button" data-dispatch="${incident.id}">Find nearest help</button>` : ''}${next ? `<button data-id="${incident.id}" data-next="${next}">Mark ${next}</button>` : '<span class="badge Low">Closed</span>'}</div></article>`;
}

function renderRecommendations(recommendations) {
  if (!recommendations.length) {
    return '<div class="dispatch-result error">No suitable available response station was found. Escalate to the regional control room.</div>';
  }
  return recommendations.map((station, index) => `<label class="recommendation"><input type="radio" name="station_id" value="${station.id}" ${index === 0 ? 'checked' : ''} required /><span class="recommendation-main"><strong>${esc(station.name)}</strong><small>${esc(station.reason)}</small>${serviceTags(station.matching_services)}</span><span class="recommendation-metrics"><strong>${station.distance_km} km</strong><small>ETA ${station.estimated_eta_minutes} min</small></span></label>`).join('');
}

async function openDispatch(incidentId) {
  activeDispatchIncident = latestIncidents.find(incident => Number(incident.id) === incidentId);
  if (!activeDispatchIncident) return;

  const form = $('#dispatchForm');
  form.reset();
  $('#dispatchMessage').className = 'dispatch-result';
  $('#dispatchMessage').textContent = '';
  $('#sendDispatch').disabled = false;
  $('#sendDispatch').textContent = 'Confirm & Send Request';
  $('#dispatchIncidentSummary').innerHTML = `<strong>#${activeDispatchIncident.id} · ${esc(activeDispatchIncident.location)}</strong><p>${esc(activeDispatchIncident.description)}</p>${serviceTags(activeDispatchIncident.required_services)}`;
  $('#dispatchRecommendations').innerHTML = '<p class="muted">Finding the nearest available response units…</p>';
  dispatchDialog.showModal();

  try {
    const result = await request(`/api/incidents/${incidentId}/dispatch-recommendations`);
    $('#dispatchRecommendations').innerHTML = renderRecommendations(result.recommendations);
  } catch (error) {
    $('#dispatchRecommendations').innerHTML = `<div class="dispatch-result error">${esc(error.message)}</div>`;
    $('#sendDispatch').disabled = true;
  }
}

async function changeStatus(id, status) {
  await request(`/api/incidents/${id}/status`, {method:'PATCH', body:JSON.stringify({status})});
  load();
}

$('#dispatchForm').onsubmit = async event => {
  event.preventDefault();
  if (!activeDispatchIncident) return;

  const form = new FormData(event.target);
  const stationId = Number(form.get('station_id'));
  const message = $('#dispatchMessage');
  const sendButton = $('#sendDispatch');
  message.className = 'dispatch-result';
  message.textContent = '';

  if (!stationId) {
    message.className = 'dispatch-result error';
    message.textContent = 'Select a response station.';
    return;
  }

  sendButton.disabled = true;
  sendButton.textContent = 'Sending request…';
  try {
    const result = await request(`/api/incidents/${activeDispatchIncident.id}/dispatch-requests`, {
      method:'POST',
      body:JSON.stringify({
        station_id:stationId,
        confirmed_by:form.get('confirmed_by'),
        human_verified:form.get('human_verified') === 'on',
        notes:form.get('notes') || ''
      })
    });
    const isLiveDelivery = result.delivery_status === 'Sent';
    message.className = `dispatch-result ${isLiveDelivery ? 'success' : 'warning'}`;
    message.textContent = `${result.operational_notice} Selected unit: ${result.station_name}.`;
    showToast(result.operational_notice);
    sendButton.textContent = isLiveDelivery ? 'Request sent' : 'Request recorded';
    await load();
  } catch (error) {
    message.className = 'dispatch-result error';
    message.textContent = error.message;
    sendButton.disabled = false;
    sendButton.textContent = 'Confirm & Send Request';
  }
};

$('#useLocation').onclick = () => {
  const status = $('#locationStatus');
  if (!navigator.geolocation) {
    status.textContent = 'GPS is not supported by this browser.';
    return;
  }

  status.textContent = 'Requesting your current location…';
  navigator.geolocation.getCurrentPosition(position => {
    const latitude = position.coords.latitude.toFixed(6);
    const longitude = position.coords.longitude.toFixed(6);
    $('#reportForm [name="latitude"]').value = latitude;
    $('#reportForm [name="longitude"]').value = longitude;
    if (!$('#reportForm [name="location"]').value.trim()) {
      $('#reportForm [name="location"]').value = `GPS location (${latitude}, ${longitude})`;
    }
    status.textContent = 'Current GPS coordinates attached.';
  }, () => {
    status.textContent = 'Location permission was not granted. Enter a landmark instead.';
  }, {enableHighAccuracy:true, timeout:10000, maximumAge:60000});
};

$('#reportForm').onsubmit = async event => {
  event.preventDefault();
  $('#formMessage').textContent = '';
  const form = new FormData(event.target);
  const latitude = form.get('latitude');
  const longitude = form.get('longitude');
  const payload = {
    reporter:form.get('reporter'),
    phone:form.get('phone'),
    location:form.get('location'),
    description:form.get('description'),
    people_affected:Number(form.get('people_affected') || 0),
    latitude:latitude ? Number(latitude) : null,
    longitude:longitude ? Number(longitude) : null
  };
  try {
    await request('/api/incidents', {method:'POST', body:JSON.stringify(payload)});
    event.target.reset();
    $('#locationStatus').textContent = 'Coordinates help responders locate the report.';
    reportDialog.close();
    showToast('Incident recorded and nearest response units are ready for dispatcher review.');
    load();
  } catch (error) {
    $('#formMessage').textContent = error.message;
  }
};

initializeMap();
load();
