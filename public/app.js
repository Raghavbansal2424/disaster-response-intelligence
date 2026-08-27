const localHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API = window.location.port === '8080' ? '/api-proxy' : (localHost ? 'http://localhost:8000' : '');
const $ = s => document.querySelector(s);
const dialog = $('#reportDialog');

$('#openReport').onclick = () => dialog.showModal();
$('#closeReport').onclick = () => dialog.close();
$('#refresh').onclick = load;

const nextStatus = {Reported:'Verified', Verified:'Dispatched', Dispatched:'Resolved'};

function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

async function request(path, options={}) {
  const base = API === '/api-proxy' ? '' : API;
  const actual = API === '/api-proxy' ? path.replace('/api/','/api-proxy/') : path;
  const res = await fetch(base + actual, {headers:{'Content-Type':'application/json'}, ...options});
  if(!res.ok) throw new Error((await res.json().catch(()=>({detail:'Request failed'}))).detail || 'Request failed');
  return res.status === 204 ? null : res.json();
}

async function load(){
  try{
    const [stats, incidents] = await Promise.all([request('/api/stats'), request('/api/incidents')]);
    $('#stats').innerHTML = [
      ['Active incidents',stats.active],['Critical',stats.critical],['Teams dispatched',stats.dispatched],['Resolved',stats.resolved],['People affected',stats.people_affected]
    ].map(([label,value])=>`<div class="stat"><small>${label}</small><strong>${value}</strong></div>`).join('');
    $('#incidents').innerHTML = incidents.length ? incidents.map(card).join('') : '<p class="muted">No incidents reported.</p>';
    document.querySelectorAll('[data-next]').forEach(b=>b.onclick=()=>changeStatus(+b.dataset.id,b.dataset.next));
  }catch(e){$('#incidents').innerHTML=`<p class="muted">The incident service is temporarily unavailable. Please refresh in a moment.</p>`}
}

function card(i){
  const next=nextStatus[i.status];
  return `<article class="incident"><div><div class="incident-top"><span class="badge ${i.severity}">${i.severity}</span><span class="badge">${esc(i.category)}</span><span class="badge">Priority ${i.priority_score}</span><span class="badge">${i.status}</span></div><h3>#${i.id} · ${esc(i.location)}</h3><p>${esc(i.description)}</p><small>${esc(i.reporter)} · ${i.people_affected} people affected · ${new Date(i.created_at).toLocaleString()}</small></div><div class="actions">${next?`<button data-id="${i.id}" data-next="${next}">Mark ${next}</button>`:'<span class="badge Low">Closed</span>'}</div></article>`;
}

async function changeStatus(id,status){
  await request(`/api/incidents/${id}/status`,{method:'PATCH',body:JSON.stringify({status})});
  load();
}

$('#reportForm').onsubmit = async e => {
  e.preventDefault(); $('#formMessage').textContent='';
  const f=new FormData(e.target);
  const payload={reporter:f.get('reporter'),phone:f.get('phone'),location:f.get('location'),description:f.get('description'),people_affected:Number(f.get('people_affected')||0)};
  try{await request('/api/incidents',{method:'POST',body:JSON.stringify(payload)});e.target.reset();dialog.close();load()}catch(err){$('#formMessage').textContent=err.message}
};
load();
