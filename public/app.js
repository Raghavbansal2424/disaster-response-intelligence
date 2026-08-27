const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API = window.location.port === '8080' ? '/api-proxy' : (localHost ? 'http://localhost:8000' : '');
const $ = selector => document.querySelector(selector);
const dialog = $('#reportDialog');
const DEFAULT_CENTER = [26.4499, 80.3319];
const PRIORITY_COLORS = {Critical:'#c7382e', High:'#e29218', Medium:'#3d72c3', Low:'#2b9861'};
const KNOWN_LOCATIONS = {
  'civil lines': [26.4761, 80.3447],
  'riverside colony': [26.5022, 80.3194],
  'highway sector 4': [26.4286, 80.3631],
  'green park': [26.4413, 80.3187]
};

let incidentMap;
let incidentLayer;
const mapMarkers = new Map();

$('#openReport').onclick = () => dialog.showModal();
$('#closeReport').onclick = () => dialog.close();
$('#refresh').onclick = load;

const nextStatus = {Reported:'Verified', Verified:'Dispatched', Dispatched:'Resolved'};

function esc(value='') {
  return String(value).replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
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

function renderMap(incidents) {
  if (!initializeMap()) {
    $('#mapStatus').textContent = 'Map service unavailable';
    return;
  }

  incidentLayer.clearLayers();
  mapMarkers.clear();
  const active = incidents.filter(incident => incident.status !== 'Resolved');

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

  $('#mapStatus').textContent = `${active.length} active incident${active.length === 1 ? '' : 's'} mapped`;
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
    const [stats, incidents] = await Promise.all([request('/api/stats'), request('/api/incidents')]);
    $('#stats').innerHTML = [
      ['Active incidents',stats.active],['Critical',stats.critical],['Teams dispatched',stats.dispatched],['Resolved',stats.resolved],['People affected',stats.people_affected]
    ].map(([label,value]) => `<div class="stat"><small>${label}</small><strong>${value}</strong></div>`).join('');
    $('#incidents').innerHTML = incidents.length ? incidents.map(card).join('') : '<p class="muted">No incidents reported.</p>';
    renderMap(incidents);
    document.querySelectorAll('[data-next]').forEach(button => button.onclick = () => changeStatus(Number(button.dataset.id), button.dataset.next));
    document.querySelectorAll('[data-focus]').forEach(button => button.onclick = () => focusIncident(Number(button.dataset.focus)));
  } catch (error) {
    $('#incidents').innerHTML = '<p class="muted">The incident service is temporarily unavailable. Please refresh in a moment.</p>';
    $('#mapStatus').textContent = 'Incident data unavailable';
  }
}

function card(incident) {
  const next = nextStatus[incident.status];
  return `<article class="incident"><div><div class="incident-top"><span class="badge ${esc(incident.severity)}">${esc(incident.severity)}</span><span class="badge">${esc(incident.category)}</span><span class="badge">Priority ${incident.priority_score}</span><span class="badge">${esc(incident.status)}</span></div><h3>#${incident.id} · ${esc(incident.location)}</h3><p>${esc(incident.description)}</p><small>${esc(incident.reporter)} · ${incident.people_affected} people affected · ${new Date(incident.created_at).toLocaleString()}</small></div><div class="actions"><button class="secondary" data-focus="${incident.id}">Show on map</button>${next ? `<button data-id="${incident.id}" data-next="${next}">Mark ${next}</button>` : '<span class="badge Low">Closed</span>'}</div></article>`;
}

async function changeStatus(id, status) {
  await request(`/api/incidents/${id}/status`, {method:'PATCH', body:JSON.stringify({status})});
  load();
}

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
    dialog.close();
    load();
  } catch (error) {
    $('#formMessage').textContent = error.message;
  }
};

initializeMap();
load();
