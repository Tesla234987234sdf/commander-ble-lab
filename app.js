import { CommanderBle } from './protocol.js';
const $ = id => document.getElementById(id);
const ble = new CommanderBle();
const number = new Intl.NumberFormat('de-DE');
let mode = 'none', busy = false, cpBusy = false, sessionStart = 0, lastStatus = 0;
let demoTimer, demoStart = 0, demoCp = false, demoRx = 0, demoTx = 0, demoInterval = 1000;
let firmwareFile, uploadController, toastTimer, waitingWorker;
const events = [];
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
function log(text) {
  events.unshift({ time: new Date().toISOString(), source: mode, text });
  if (events.length > 200) events.length = 200;
  $('eventLog').replaceChildren(...events.slice(0, 15).map(event => {
    const li = document.createElement('li'), time = document.createElement('time'), span = document.createElement('span');
    time.dateTime = event.time; time.textContent = new Date(event.time).toLocaleTimeString('de-DE');
    span.textContent = event.text; li.append(time, span); return li;
  }));
}
function refreshControls() {
  const connected = mode === 'ble' && ble.ready, active = connected || mode === 'demo';
  for (const id of ['connectTop', 'connectMain', 'connectSettings', 'demoButton']) $(id).disabled = busy || ble.uploading;
  $('demoButton').textContent = mode === 'demo' ? 'Demo läuft ✓' : 'Demo ausprobieren →';
  $('demoButton').disabled ||= mode === 'demo';
  $('connectTop').textContent = connected ? 'Gerät wechseln ↗' : 'Verbinden ↗';
  $('connectMain').textContent = connected ? 'Verbindung aktiv ✓' : 'Mit Testboard verbinden ↗';
  $('connectMain').disabled ||= connected;
  $('disconnectButton').disabled = !connected || busy;
  $('reconnectButton').disabled = !ble.device || connected || busy;
  $('cpToggle').disabled = !active || busy || cpBusy;
  $('markerButton').disabled = !active || busy;
  $('intervalSelect').disabled = !active || busy;
  $('uploadButton').disabled = !connected || !firmwareFile || busy;
  $('firmwareFile').disabled = busy;
  $('cancelUpload').disabled = !uploadController;
  $('stopDemo').disabled = busy;
}
function renderStatus(status) {
  if (status.simulated !== true || !['ble', 'demo'].includes(mode)) return;
  lastStatus = Date.now();
  $('battery').replaceChildren(document.createTextNode(Number(status.battery).toFixed(0)), Object.assign(document.createElement('small'), { textContent: '%' }));
  $('batteryFill').style.width = `${Math.max(0, Math.min(100, Number(status.battery)))}%`;
  $('power').replaceChildren(document.createTextNode(Number(status.power_kw).toFixed(0)), Object.assign(document.createElement('small'), { textContent: 'kW' }));
  $('cpType').textContent = status.cp_eu ? 'EU / CCS' : 'US';
  $('cpType').style.fontSize = '24px';
  $('cpDetail').textContent = status.cp_eu ? '0x25D · Type 3 · simuliert' : '0x25D · Type 0 · simuliert';
  $('cpToggle').setAttribute('aria-checked', String(Boolean(status.cp_eu)));
  $('rxFrames').textContent = number.format(status.rx);
  $('txFrames').textContent = number.format(status.tx);
  $('fps').textContent = number.format(status.fps);
  $('intervalSelect').value = String(status.interval_ms);
}
function resetStatus() {
  for (const id of ['battery', 'power', 'cpType', 'rxFrames', 'txFrames', 'fps', 'fwVersion', 'transport']) $(id).textContent = '—';
  $('batteryFill').style.width = '0'; $('cpDetail').textContent = 'Wartet auf Status';
  $('cpToggle').setAttribute('aria-checked', 'false'); lastStatus = 0; sessionStart = 0;
}
function showMode() {
  const connected = mode === 'ble', demo = mode === 'demo';
  $('demoNotice').hidden = !demo;
  $('connectionBadge').className = `status-pill${connected ? ' connected' : demo ? ' demo' : ''}`;
  const badge = document.createElement('i');
  $('connectionBadge').replaceChildren(badge, document.createTextNode(connected ? 'BLE verbunden' : demo ? 'Demo-Modus' : 'Nicht verbunden'));
  $('sourceTag').textContent = demo ? 'Browser-Demo' : connected ? 'Testboard · Simulation' : 'Keine Daten';
  document.querySelector('.vehicle-title h2').textContent = connected ? 'Dein BLE-Testboard ist verbunden.' : demo ? 'So sieht dein Commander aus.' : 'Bereit für die Verbindung.';
  $('vehicleSubtitle').textContent = connected || demo ? 'Fahrzeugwerte sind simuliert. Kein CAN-Bus angeschlossen.' : 'Verbinde dein ESP32-Testboard oder starte die Demo.';
  $('deviceName').textContent = connected ? ble.device.name || 'Commander-Lab' : demo ? 'Virtueller Commander' : 'Dein Testboard';
  $('deviceSummary').textContent = connected ? 'AZDelivery ESP32 · USB-Testbetrieb' : demo ? 'Simulation direkt in deinem Browser.' : 'AZDelivery ESP32 Dev Kit C · Testfirmware benötigt.';
  $('transport').textContent = connected ? 'Bluetooth LE' : demo ? 'Lokale Simulation' : '—';
  $('fwVersion').textContent = connected ? ble.info.firmware : demo ? 'Browser-Demo 1.0.0' : '—';
  $('sessionDetail').textContent = connected ? 'Lokale Bluetooth-Verbindung' : demo ? 'Demo-Sitzung · kein Funkverkehr' : 'Wartet auf Verbindung';
  refreshControls();
}
function demoTick() {
  const elapsed = (Date.now() - demoStart) / 1000, fps = 1180 + Math.round(Math.sin(elapsed / 3) * 45);
  demoRx += Math.round(fps * demoInterval / 1000); demoTx += demoCp ? Math.round(4 * demoInterval / 1000) : 0;
  renderStatus({ simulated: true, battery: 68, power_kw: 122 + Math.sin(elapsed / 8) * 6, cp_eu: demoCp, rx: demoRx, tx: demoTx, fps, interval_ms: demoInterval });
}
function stopDemo() { clearInterval(demoTimer); if (mode === 'demo') { mode = 'none'; resetStatus(); showMode(); log('Browser-Demo beendet.'); } }
$('demoButton').onclick = () => {
  if (mode === 'demo') return;
  ble.disconnect(); mode = 'demo'; demoStart = sessionStart = Date.now(); demoRx = 0; demoTx = 0; demoCp = true;
  demoInterval = 1000; showMode(); demoTick(); demoTimer = setInterval(demoTick, demoInterval); log('Browser-Demo gestartet. Alle Fahrzeugdaten sind simuliert.');
};
$('stopDemo').onclick = stopDemo;
async function connect(reconnect = false) {
  if (busy) return;
  stopDemo(); busy = true; refreshControls();
  try { reconnect ? await ble.connect() : await ble.choose(); }
  catch (error) { if (error.name !== 'NotFoundError') { toast(error.message); log(`Verbindung: ${error.message}`); } }
  finally { busy = false; refreshControls(); }
}
for (const id of ['connectTop', 'connectMain', 'connectSettings']) $(id).onclick = () => connect();
$('reconnectButton').onclick = () => connect(true);
$('disconnectButton').onclick = () => ble.disconnect();
ble.addEventListener('state', ({ detail }) => {
  if (detail.state === 'connected') { mode = 'ble'; sessionStart = Date.now(); showMode(); log(`Verbunden mit ${detail.name}. Fahrzeugdaten sind simuliert.`); }
  if (detail.state === 'connecting') $('connectionBadge').textContent = 'Verbindung wird aufgebaut …';
  if (detail.state === 'disconnected' && mode === 'ble') { mode = 'none'; resetStatus(); showMode(); log('BLE-Verbindung getrennt. Wiederverbindung über „Verbindung“.'); }
});
ble.addEventListener('message', ({ detail }) => {
  if (detail.type === 'status') renderStatus(detail);
  if (detail.type === 'marker') log(`Board-MARKER ${detail.marker} · Laufzeit ${detail.uptime_ms} ms`);
  if (detail.type === 'ota_error') log(`BLE-Update: ${detail.error}`);
});
ble.addEventListener('protocolerror', () => { log('Ungültige BLE-Nachricht verworfen.'); });
$('cpToggle').onclick = async () => {
  const enabled = $('cpToggle').getAttribute('aria-checked') !== 'true'; cpBusy = true; refreshControls();
  try {
    if (mode === 'demo') { demoCp = enabled; demoTick(); }
    else { const result = await ble.request('set_cp', { enabled }); $('cpToggle').setAttribute('aria-checked', String(result.enabled)); }
    log(`CP-Simulation ${enabled ? 'EU / CCS aktiviert' : 'auf US zurückgesetzt'}.`);
  } catch (error) { toast(error.message); }
  finally { cpBusy = false; refreshControls(); }
};
$('markerButton').onclick = async () => {
  try { if (mode === 'demo') log(`DEMO-MARKER · Laufzeit ${Date.now() - demoStart} ms`); else await ble.request('marker'); }
  catch (error) { toast(error.message); }
};
$('intervalSelect').onchange = async event => {
  const interval = Number(event.target.value);
  try {
    if (mode === 'demo') { demoInterval = interval; clearInterval(demoTimer); demoTimer = setInterval(demoTick, interval); }
    else await ble.request('set_interval', { interval_ms: interval });
    log(`Statusintervall: ${interval} ms.`);
  } catch (error) { toast(error.message); await ble.request('get_status').catch(() => {}); }
};
$('exportLog').onclick = () => {
  const blob = new Blob([JSON.stringify({ app: 'Commander BLE Lab 1.0.0', exported_at: new Date().toISOString(), simulated_vehicle_data: true, events }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `commander-lab-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => {
  document.querySelectorAll('.view').forEach(view => view.hidden = view.id !== `view-${button.dataset.view}`);
  document.querySelectorAll('[data-view]').forEach(nav => { nav.classList.toggle('selected', nav === button); nav === button ? nav.setAttribute('aria-current', 'page') : nav.removeAttribute('aria-current'); });
  $('breadcrumb').textContent = `Workspace / ${button.textContent.trim().slice(1).trim()}`;
  document.querySelector('main').scrollIntoView({ block: 'start' });
});
$('firmwareFile').onchange = event => {
  firmwareFile = event.target.files[0]; $('fileLabel').textContent = firmwareFile ? `${firmwareFile.name} · ${number.format(firmwareFile.size)} Bytes` : 'Keine Datei gewählt';
  $('otaProgress').value = 0; $('otaPercent').textContent = '0 %'; refreshControls();
};
$('uploadButton').onclick = async () => {
  if (!firmwareFile || mode !== 'ble' || busy) return;
  busy = true; uploadController = new AbortController(); refreshControls();
  $('otaStatus').textContent = 'Datei prüfen und Übertragung vorbereiten …'; log('BLE-Firmwareupdate gestartet.');
  try {
    await ble.upload(firmwareFile, fraction => {
      const percent = Math.floor(fraction * 100); $('otaProgress').value = percent; $('otaPercent').textContent = `${percent} %`;
      $('otaStatus').textContent = percent === 100 ? 'SHA-256 prüfen und Update abschließen …' : 'Datenblöcke werden bestätigt …';
    }, uploadController.signal);
    $('otaStatus').textContent = 'Update bestätigt. Board startet neu – danach erneut verbinden.';
    toast('Firmware bestätigt. Das Testboard startet neu.'); log('Firmwareupdate bestätigt; Neustart angefordert.');
  } catch (error) { $('otaStatus').textContent = error.message; toast(error.message); log(`Update beendet: ${error.message}`); }
  finally { uploadController = null; busy = false; refreshControls(); }
};
$('cancelUpload').onclick = () => { uploadController?.abort(); $('otaStatus').textContent = 'Übertragung wird abgebrochen …'; };
function browserCheck() {
  const supported = Boolean(navigator.bluetooth) && window.isSecureContext;
  $('browserCheck').textContent = supported ? 'Web Bluetooth verfügbar' : 'Demo verfügbar · BLE eingeschränkt';
  $('browserExplanation').textContent = supported ? 'Der Browser stellt die benötigte Schnittstelle bereit. Die tatsächliche Verbindung wird mit deinem Testboard geprüft.' : 'Für BLE benötigst du HTTPS (oder localhost) und einen Browser mit Web-Bluetooth-Unterstützung, zum Beispiel Chrome auf Android oder einem unterstützten Desktop.';
  if (!supported) { $('compatibility').hidden = false; $('compatibility').textContent = 'Dieser Browser kann hier keine direkte BLE-Verbindung herstellen. Du kannst die gesamte Oberfläche im Demo-Modus ausprobieren. Hinweise findest du unter „Verbindung“.'; }
}
setInterval(() => {
  const seconds = sessionStart ? Math.floor((Date.now() - sessionStart) / 1000) : 0;
  $('sessionTime').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const age = lastStatus ? Math.floor((Date.now() - lastStatus) / 1000) : 0;
  $('lastSeen').textContent = lastStatus ? age < 2 ? 'Gerade eben' : `Vor ${age} s${age > 5 ? ' · veraltet' : ''}` : '—';
}, 1000);
function network() { $('networkStatus').textContent = navigator.onLine ? 'Online · Seite lokal ausgeführt' : 'Offline · Lokaler Cache'; }
window.addEventListener('online', network); window.addEventListener('offline', network);
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').then(registration => {
    const offer = () => { if (registration.waiting && navigator.serviceWorker.controller) { waitingWorker = registration.waiting; $('updateNotice').hidden = false; } };
    offer(); registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', offer));
  }).catch(() => log('Offline-Cache konnte nicht eingerichtet werden.'));
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (refreshing && !busy) location.reload(); });
  $('reloadApp').onclick = () => {
    if (busy || ble.uploading) return toast('Bitte das laufende Update zuerst abschließen.');
    refreshing = true; waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
  };
}
browserCheck(); network(); showMode(); log('BLE Lab bereit. Demo oder Testboard wählen.');
