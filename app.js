import { CommanderBle, errorText } from './protocol.js';
const $ = id => document.getElementById(id);
const ble = new CommanderBle(), events = [];
const number = new Intl.NumberFormat('de-DE');
let mode = 'none', busy = false, cpBusy = false, demoTimer, demoStart = 0;
let demoCp = false, demoRx = 0, demoTx = 0, demoInterval = 1000, lastStatus;
let uploadController, waitingWorker, toastTimer;

// Preserve the original dashboard, but never send its legacy vehicle commands
// to the bench board. Only the following supported BLE operations are enabled.
for (const control of document.querySelectorAll('button,input,select')) control.disabled = true;
document.querySelectorAll('form').forEach(form => form.addEventListener('submit', e => e.preventDefault()));
const toastBox = document.createElement('div'); toastBox.className = 'toast'; toastBox.hidden = true;
toastBox.setAttribute('role', 'status'); document.body.append(toastBox);
function toast(text) { toastBox.textContent = text; toastBox.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastBox.hidden = true; }, 8000); }
function log(text) {
  events.unshift({ time: new Date().toISOString(), source: mode, text });
  if (events.length > 200) events.length = 200;
  $('eventLog').replaceChildren(...events.slice(0, 20).map(event => {
    const li = document.createElement('li'), time = document.createElement('time');
    time.textContent = new Date(event.time).toLocaleTimeString('de-DE');
    li.append(time, document.createTextNode(event.text)); return li;
  }));
}
function fail(error) { const text = errorText(error); log(text); toast(text); }
function pill(id, text, active = false) { $(id).className = `pill ${active ? 'on' : 'off'}`; $(id).textContent = text; }
function controls() {
  const active = mode === 'demo' || (mode === 'ble' && ble.ready);
  $('connectButton').disabled = busy;
  $('disconnectButton').disabled = busy || !ble.ready;
  $('demoButton').disabled = busy || mode === 'demo';
  $('stopDemo').disabled = busy || mode !== 'demo';
  $('swPerf').disabled = false;
  $('swCpTypeEU').disabled = !active || busy || cpBusy;
  $('markerButton').disabled = !active || busy;
  $('intervalSelect').disabled = !active || busy;
  $('exportLog').disabled = false;
  $('otaSelectBtn').disabled = busy || mode !== 'ble' || !ble.ready;
  $('otaFile').disabled = $('otaSelectBtn').disabled;
  $('cancelUpload').disabled = !uploadController;
  $('reloadApp').disabled = busy;
  $('controlsSummary').textContent = active ? `BLE-Test · CP Type ${$('swCpTypeEU').checked ? 'EU' : 'US'} · Simulation` : 'BLE-Test · nicht verbunden';
}
function render(status) {
  if (status.simulated !== true || !['demo', 'ble'].includes(mode)) return;
  lastStatus = status;
  $('bSoc').textContent = Number(status.battery).toFixed(0);
  $('socBar').style.strokeDashoffset = 326.73 * (1 - Math.max(0, Math.min(100, Number(status.battery))) / 100);
  $('rxCnt').textContent = number.format(status.rx); $('txCnt').textContent = number.format(status.tx);
  $('fps').textContent = Number(status.fps).toFixed(1);
  $('crcErr').textContent = '—'; $('crcSplit').textContent = 'Simulierte Zähler · keine CAN-Fehlerdaten';
  $('rxService').textContent = 'Kein physischer CAN-Empfang'; $('canTiming').textContent = '';
  $('swCpTypeEU').checked = Boolean(status.cp_eu); $('intervalSelect').value = String(status.interval_ms);
  pill('bmsSt', 'Simulation', true); pill('canVeh', 'Kein CAN');
  $('bmsFrames').textContent = 'BLE-Test · kein BMS-Empfang';
  $('pfPow').textContent = `${Number(status.power_kw).toFixed(1)} kW · simuliert`;
  $('uptime').textContent = `${Math.floor(status.uptime_ms / 1000)} s`;
  controls();
}
function reset() {
  lastStatus = null;
  for (const id of ['bSoc', 'bVolt', 'bCurr', 'bTemp', 'rxCnt', 'txCnt', 'fps', 'pfPow', 'uptime', 'fwBuild']) $(id).textContent = '—';
  $('socBar').style.strokeDashoffset = '326.73'; $('swCpTypeEU').checked = false;
  pill('bmsSt', 'Waiting Frames'); pill('canVeh', 'Kein CAN');
}
function showMode() {
  pill('connectionBadge', mode === 'ble' ? 'BLE verbunden' : mode === 'demo' ? 'Demo' : 'Nicht verbunden', mode !== 'none');
  $('dot').className = mode === 'none' ? 'cdot off' : 'cdot';
  $('deviceHost').textContent = mode === 'ble' ? ble.device.name : mode === 'demo' ? 'Browser-Demo' : 'BLE';
  $('deviceName').textContent = mode === 'ble' ? ble.device.name : mode === 'demo' ? 'Browser-Demo · kein Funkverkehr' : 'Commander-Lab · Testboard auswählen';
  $('fwBuild').textContent = mode === 'ble' ? ble.info.firmware : mode === 'demo' ? 'Browser-Demo 2.0.0' : '—';
  $('connErr').style.display = 'none'; controls();
}
function stopDemo() { clearInterval(demoTimer); if (mode === 'demo') { mode = 'none'; reset(); showMode(); } }
function demoTick() {
  demoRx += Math.round(1200 * demoInterval / 1000); if (demoCp) demoTx += Math.round(4 * demoInterval / 1000);
  render({ simulated: true, battery: 68, power_kw: 122, rx: demoRx, tx: demoTx, fps: 1200, cp_eu: demoCp, interval_ms: demoInterval, uptime_ms: Date.now() - demoStart });
}
$('demoButton').onclick = () => {
  ble.disconnect(); stopDemo(); mode = 'demo'; demoStart = Date.now(); demoRx = demoTx = 0; demoCp = true; demoInterval = 1000;
  showMode(); demoTick(); demoTimer = setInterval(demoTick, demoInterval); log('DEMO · sämtliche Fahrzeugdaten und Zähler sind simuliert.');
};
$('stopDemo').onclick = stopDemo;
$('connectButton').onclick = async () => {
  if (busy) return; stopDemo(); busy = true; controls();
  try { await ble.choose(); }
  catch (error) { if (error?.name !== 'NotFoundError') fail(error); }
  finally { busy = false; controls(); }
};
$('disconnectButton').onclick = () => ble.disconnect();
ble.addEventListener('state', ({ detail }) => {
  if (detail.state === 'connecting') { $('connectionBadge').textContent = detail.stage || 'Verbinden …'; log(`BLE: ${detail.stage || 'Verbindung wird aufgebaut'}`); }
  if (detail.state === 'connected') { mode = 'ble'; showMode(); log(`Verbunden mit ${detail.name} · Fahrzeugdaten simuliert.`); }
  if (detail.state === 'disconnected' && mode !== 'demo') { mode = 'none'; reset(); showMode(); }
});
ble.addEventListener('message', ({ detail }) => {
  if (detail.type === 'status') render(detail);
  if (detail.type === 'marker') log(`Board-MARKER ${detail.marker} · Laufzeit ${detail.uptime_ms} ms`);
  if (detail.type === 'ota_error') log(`BLE-Update: ${detail.error}`);
});
ble.addEventListener('protocolerror', ({ detail }) => fail(detail));
$('swCpTypeEU').onchange = async e => {
  const enabled = e.target.checked; cpBusy = true; controls();
  try {
    if (mode === 'demo') { demoCp = enabled; demoTick(); }
    else { const result = await ble.request('set_cp', { enabled }); $('swCpTypeEU').checked = result.enabled; }
    log(`CP-Simulation ${enabled ? 'EU / CCS' : 'US'}`);
  } catch (error) { $('swCpTypeEU').checked = Boolean(lastStatus?.cp_eu); fail(error); }
  finally { cpBusy = false; controls(); }
};
$('markerButton').onclick = async () => { try { mode === 'demo' ? log('DEMO-MARKER') : await ble.request('marker'); } catch (error) { fail(error); } };
$('intervalSelect').onchange = async e => {
  const interval = Number(e.target.value);
  try {
    if (mode === 'demo') { demoInterval = interval; clearInterval(demoTimer); demoTimer = setInterval(demoTick, interval); }
    else await ble.request('set_interval', { interval_ms: interval });
    log(`Statusintervall ${interval} ms`);
  } catch (error) { fail(error); if (lastStatus) $('intervalSelect').value = lastStatus.interval_ms; }
};
$('swPerf').onchange = e => {
  $('perfBody').style.display = e.target.checked ? '' : 'none'; $('perfOff').style.display = e.target.checked ? 'none' : '';
  try { localStorage.setItem('perfShow', e.target.checked ? '1' : '0'); } catch {}
};
try { $('swPerf').checked = localStorage.getItem('perfShow') === '1'; $('swPerf').onchange({ target: $('swPerf') }); } catch {}
$('exportLog').onclick = () => {
  const data = { app: 'Commander BLE Lab Web 2.0.0', simulated_vehicle_data: true, events };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `commander-ble-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('otaSelectBtn').onclick = () => $('otaFile').click();
$('otaFile').onchange = async e => {
  const file = e.target.files[0]; if (!file || busy || !ble.ready) return;
  busy = true; uploadController = new AbortController(); controls();
  $('otaProgress').style.display = 'block'; $('otaBar').style.width = '0%'; $('otaBanner').textContent = 'BLE FIRMWARE UPDATE'; $('otaBanner').style.display = 'block';
  $('otaStatus').textContent = 'Datei prüfen …'; log('BLE-OTA gestartet.');
  try {
    await ble.upload(file, p => { $('otaBar').style.width = `${Math.floor(p * 100)}%`; $('otaStatus').textContent = `${Math.floor(p * 100)} % · bestätigte Blöcke`; $('otaBytes').textContent = `${number.format(Math.floor(file.size * p))} / ${number.format(file.size)} Bytes`; }, uploadController.signal);
    $('otaStatus').textContent = 'SHA-256 bestätigt · Board startet neu.'; log('BLE-OTA bestätigt · danach erneut verbinden.');
  } catch (error) { $('otaStatus').textContent = errorText(error); fail(error); }
  finally { busy = false; uploadController = null; $('otaBanner').style.display = 'none'; e.target.value = ''; controls(); }
};
$('cancelUpload').onclick = () => uploadController?.abort();
$('reloadApp').onclick = () => { if (!busy) waitingWorker?.postMessage({ type: 'SKIP_WAITING' }); };
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').then(registration => {
  const offer = () => { if (registration.waiting && navigator.serviceWorker.controller) { waitingWorker = registration.waiting; $('updateNotice').hidden = false; controls(); } };
  offer(); registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', offer));
}).catch(() => log('Offline-Cache nicht verfügbar.'));
let refreshing = false;
navigator.serviceWorker?.addEventListener('controllerchange', () => { if (!refreshing && waitingWorker && !busy) { refreshing = true; location.reload(); } });
function network() { $('networkStatus').textContent = navigator.onLine ? 'Online · BLE-Daten bleiben lokal' : 'Offline · lokaler Cache'; }
window.addEventListener('online', network); window.addEventListener('offline', network);
if (!navigator.bluetooth || !window.isSecureContext) log('Web Bluetooth hier nicht verfügbar. Demo oder Bluefy / unterstützten Browser verwenden.');
pill('fsdSt', 'Kein Fahrzeug'); pill('hwVer', 'ESP32-Testboard'); pill('nagSt', 'Nicht verfügbar');
pill('capSt', 'Kein CAN'); pill('bbSt', 'Nicht verfügbar'); pill('httpLogSt', 'BLE Events');
$('wifiCl').textContent = 'WLAN aus'; $('btnMode').textContent = 'Activate';
reset(); showMode(); network(); log('WEB 2.0.0 · HTTP-Oberfläche mit BLE-Transport bereit.');
