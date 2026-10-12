export const SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const COMMAND = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const EVENT = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
export const OTA_DATA = '6e400004-b5a3-f393-e0a9-e50e24dcca9e';
export const PROTOCOL_VERSION = 1;

export function errorText(error) {
  if (typeof error === 'string' && error.trim()) return error.trim();
  for (const key of ['message', 'description', 'reason', 'error']) {
    if (typeof error?.[key] === 'string' && error[key].trim()) return error[key].trim();
  }
  if (error?.code !== undefined) return `BLE-Fehlercode ${String(error.code)}`;
  return 'Der Browser hat den BLE-Vorgang ohne Fehlerbeschreibung abgebrochen.';
}

// One decoder per connection. BLE notifications may split any UTF-8 character.
export class JsonLines {
  constructor(onValue, onError = () => {}) {
    this.onValue = onValue; this.onError = onError; this.reset();
  }
  reset() { this.decoder = new TextDecoder(); this.buffer = ''; }
  push(value) {
    const bytes = value instanceof DataView
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : value;
    this.buffer += this.decoder.decode(bytes, { stream: true });
    let end;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      if (line.length > 4096) { this.onError(new Error('BLE-Nachricht zu groß.')); continue; }
      try { this.onValue(JSON.parse(line)); }
      catch (error) { this.onError(error); }
    }
    if (this.buffer.length > 4096) {
      this.reset(); this.onError(new Error('Unvollständige BLE-Nachricht zu groß.'));
    }
  }
}

export function encodeCommand(command, size = 20) {
  if (!Number.isInteger(size) || size < 1) throw new Error('Ungültige Paketgröße.');
  const data = new TextEncoder().encode(JSON.stringify(command) + '\n');
  if (data.length > 319) throw new Error('Befehl ist zu groß.');
  const chunks = [];
  for (let i = 0; i < data.length; i += size) chunks.push(data.slice(i, i + size));
  return chunks;
}

export function otaPacket(offset, payload) {
  const packet = new Uint8Array(payload.length + 4);
  new DataView(packet.buffer).setUint32(0, offset, true);
  packet.set(payload, 4); return packet;
}

export function validateImage(data, maxSize = 4 * 1024 * 1024) {
  if (data.length < 32 || data.length > maxSize) throw new Error('Ungültige Firmwaregröße.');
  if (data[0] !== 0xE9) throw new Error('Keine ESP32-Anwendungsfirmware. Bitte die OTA-Datei wählen.');
  if (new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(12, true) !== 0)
    throw new Error('Diese Datei ist nicht für den klassischen ESP32-Testchip.');
}

export class CommanderBle extends EventTarget {
  constructor({ connectTimeout = 12000 } = {}) {
    super(); this.device = null; this.ready = false; this.pending = new Map();
    this.sequence = 0; this.queue = Promise.resolve(); this.uploading = false;
    this.connectTimeout = connectTimeout; this.connectAttempt = 0; this.activeConnectAttempt = 0;
    this.lines = new JsonLines(message => this.receive(message), error => this.emit('protocolerror', error));
    this.onDisconnect = () => this.lost();
    this.onNotification = event => this.lines.push(event.target.value);
  }
  emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail })); }
  async choose() {
    if (!navigator.bluetooth) throw new Error('Dieser Browser bietet kein Web Bluetooth. Der Demo-Modus ist verfügbar.');
    let device;
    this.emit('state', { state: 'connecting', stage: 'Geräteauswahl öffnen' });
    try { device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }], optionalServices: [SERVICE] }); }
    catch (error) {
      this.emit('state', { state: 'disconnected' });
      if (error?.name === 'NotFoundError') throw error;
      throw new Error(`Geräteauswahl: ${errorText(error)}`);
    }
    if (!device?.gatt) {
      this.emit('state', { state: 'disconnected' });
      throw new Error('Die Geräteauswahl hat kein BLE-Gerät mit GATT-Verbindung zurückgegeben.');
    }
    this.disconnect();
    if (this.device) this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
    this.device = device; device.addEventListener('gattserverdisconnected', this.onDisconnect);
    return this.connect();
  }
  async connect() {
    if (!this.device) throw new Error('Bitte zuerst ein Gerät auswählen.');
    const attempt = ++this.connectAttempt, device = this.device;
    this.activeConnectAttempt = attempt;
    const step = async (label, action) => {
      if (attempt !== this.connectAttempt) throw new Error('Verbindungsaufbau abgebrochen.');
      this.emit('state', { state: 'connecting', stage: label });
      let timer;
      try {
        const result = await Promise.race([
          Promise.resolve().then(action),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Zeitüberschreitung: ${label}. Bitte das Board neu starten und erneut verbinden.`)), this.connectTimeout); })
        ]);
        if (attempt !== this.connectAttempt) throw new Error('Verbindungsaufbau abgebrochen.');
        return result;
      } catch (error) { throw new Error(`${label}: ${errorText(error)}`); }
      finally { clearTimeout(timer); }
    };
    try {
      this.lines.reset();
      const server = await step('Bluetooth-Verbindung öffnen', async () => {
        const result = await device.gatt.connect();
        if (attempt !== this.connectAttempt && this.device === device && !this.ready && !this.activeConnectAttempt) device.gatt.disconnect();
        return result;
      });
      const service = await step('Commander-Dienst suchen', () => server.getPrimaryService(SERVICE));
      this.command = await step('Befehlskanal öffnen', () => service.getCharacteristic(COMMAND));
      this.event?.removeEventListener('characteristicvaluechanged', this.onNotification);
      this.event = await step('Statuskanal öffnen', () => service.getCharacteristic(EVENT));
      this.data = await step('Updatekanal öffnen', () => service.getCharacteristic(OTA_DATA));
      this.event.addEventListener('characteristicvaluechanged', this.onNotification);
      await step('Statusbenachrichtigungen aktivieren', () => this.event.startNotifications());
      const hello = await step('Firmware-Antwort abwarten', () => this.request('hello'));
      if (hello.protocol !== PROTOCOL_VERSION || hello.board !== 'esp32-devkitc-lab' || hello.simulated !== true)
        throw new Error('Das Gerät verwendet nicht die passende BLE-Lab-Testfirmware.');
      this.info = hello; this.ready = true;
      this.emit('state', { state: 'connected', info: hello, name: this.device.name });
      await this.request('get_status');
      return hello;
    } catch (error) { if (this.activeConnectAttempt === attempt) this.disconnect(); throw error; }
    finally { if (this.activeConnectAttempt === attempt) this.activeConnectAttempt = 0; }
  }
  lost() {
    this.connectAttempt++;
    this.ready = false; this.lines.reset();
    this.event?.removeEventListener('characteristicvaluechanged', this.onNotification);
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('BLE-Verbindung getrennt.')); }
    this.pending.clear();
    this.ack?.reject(new Error('BLE-Verbindung während der Übertragung getrennt.'));
    this.command = null; this.data = null;
    this.emit('state', { state: 'disconnected' });
  }
  disconnect() {
    if (this.device?.gatt.connected) this.device.gatt.disconnect();
    this.lost();
  }
  async write(characteristic, bytes) {
    // Older Web Bluetooth bridges expose only writeValue. Both firmware write
    // characteristics support WRITE, so the legacy API uses acknowledged writes.
    if (typeof characteristic?.writeValueWithResponse === 'function')
      return characteristic.writeValueWithResponse(bytes);
    if (typeof characteristic?.writeValue === 'function') return characteristic.writeValue(bytes);
    throw new Error('Der Browser bietet keinen unterstützten BLE-Schreibzugriff.');
  }
  receive(message) {
    if (!message || typeof message !== 'object') return;
    if (Number.isInteger(message.id) && this.pending.has(message.id)) {
      const item = this.pending.get(message.id);
      this.pending.delete(message.id); clearTimeout(item.timer);
      message.ok ? item.resolve(message.result) : item.reject(new Error(message.error || 'Befehl abgelehnt.'));
    }
    if (message.type === 'ota_ack' && this.ack) {
      if (message.offset === this.ack.offset) this.ack.resolve();
      else this.ack.reject(new Error('Firmware-Offset stimmt nicht überein.'));
    }
    if (message.type === 'ota_error') this.ack?.reject(new Error(message.error || 'Firmwareübertragung fehlgeschlagen.'));
    this.emit('message', message);
  }
  request(op, args = {}, timeout = 8000) {
    const run = async () => {
      if (!this.device?.gatt.connected || !this.command) throw new Error('Kein BLE-Gerät verbunden.');
      const id = ++this.sequence;
      let resolve, reject;
      const answer = new Promise((yes, no) => { resolve = yes; reject = no; });
      const timer = setTimeout(() => {
        this.pending.delete(id); reject(new Error(`Keine Bestätigung für ${op}.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      const write = (async () => {
        for (const chunk of encodeCommand({ id, op, ...args })) await this.write(this.command, chunk);
      })();
      try { const [, response] = await Promise.all([write, answer]); return response; }
      finally { clearTimeout(timer); this.pending.delete(id); }
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }
  waitAck(offset, signal) {
    return new Promise((resolve, reject) => {
      const done = (error) => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        this.ack = null; error ? reject(error) : resolve();
      };
      const abort = () => done(new DOMException('Update abgebrochen.', 'AbortError'));
      const timer = setTimeout(() => done(new Error('Keine Bestätigung für Firmwareblock.')), 10000);
      this.ack = { offset, resolve: () => done(), reject: done };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
  async upload(file, progress, signal) {
    if (!this.ready || this.uploading) throw new Error('Testboard zuerst verbinden.');
    this.uploading = true;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      validateImage(bytes, this.info.max_image);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      signal?.throwIfAborted();
      const result = await this.request('ota_begin', { size: bytes.length, sha256: hash }, 15000);
      const chunkSize = result.chunk;
      if (!Number.isInteger(chunkSize) || chunkSize < 16 || chunkSize > 180) throw new Error('Ungültige BLE-Blockgröße.');
      for (let offset = 0; offset < bytes.length;) {
        signal?.throwIfAborted();
        const next = Math.min(offset + chunkSize, bytes.length);
        const ack = this.waitAck(next, signal);
        const write = this.write(this.data, otaPacket(offset, bytes.subarray(offset, next)));
        try { await Promise.all([write, ack]); }
        catch (error) { this.ack?.reject(error); throw error; }
        offset = next; progress(offset / bytes.length);
      }
      signal?.throwIfAborted();
      await this.request('ota_end', {}, 15000);
    } catch (error) {
      if (this.device?.gatt.connected) await this.request('ota_abort', {}, 3000).catch(() => {});
      throw error;
    } finally { this.uploading = false; }
  }
}
