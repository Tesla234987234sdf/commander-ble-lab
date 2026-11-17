
var ws,rt,busy=0,wifiOnce=false,restartAnchor=null;
var httpLogGeneration=0;
var httpLogAbort=null,httpLogReader=null,httpLogParts=[],httpLogBytes=0,httpLogStarted=0,httpLogRunning=false;
var httpLogSaveUrl='';
var HW=['Unknown','Legacy','HW3','HW4'];
var CIRC=326.73;
document.getElementById('deviceHost').textContent=location.host||location.hostname||'192.168.4.1';

function initWifi(d){
  if(wifiOnce)return;
  wifiOnce=true;
  document.getElementById('wifiSsid').value=d.wifi_ssid||'';
  document.getElementById('wifiPass').value=d.wifi_pass||'';
  document.getElementById('swWifiHid').checked=!!d.wifi_hidden;
  document.getElementById('wifiStaSsid').value=d.wifi_sta_ssid||'';
  document.getElementById('wifiStaPass').value=d.wifi_sta_pass||'';
}

function fmt(s){
  var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;
  return h+':'+(m<10?'0':'')+m+':'+(sc<10?'0':'')+sc;
}
function socCol(p){return p>60?'var(--accent)':p>30?'var(--yellow)':'var(--red)';}
// Performance card (read-only, opt-in). Shown state persists per browser.
var perfShow=false;
try{perfShow=localStorage.getItem('perfShow')==='1'}catch(e){}
function perfToggle(on){
  perfShow=!!on;
  try{localStorage.setItem('perfShow',perfShow?'1':'0')}catch(e){}
  var b=document.getElementById('perfBody'),o=document.getElementById('perfOff');
  if(b)b.style.display=perfShow?'':'none';
  if(o)o.style.display=perfShow?'none':'';
}
function perfInit(){
  var sw=document.getElementById('swPerf');
  if(sw)sw.checked=perfShow;
  perfToggle(perfShow);
}
function pfT(ms){return ms>0?(ms/1000).toFixed(2)+'s':'--';}
function setTxt(id,t){var e=document.getElementById(id);if(e)e.textContent=t;}
function renderPerf(d){
  if(!perfShow||!d.perf)return;
  var p=d.perf;
  setTxt('pfSpeed',(p.speed||0).toFixed(1)+' km/h');
  // Timers: locked result if present, else the live run time while armed.
  function cell(id,bid,t,best){
    var e=document.getElementById(id);
    if(t>0){e.textContent=pfT(t);e.style.color='var(--accent)';}
    else if(p.armed&&p.run_ms>0){e.textContent=pfT(p.run_ms);e.style.color='var(--yellow)';}
    else{e.textContent='--';e.style.color='';}
    setTxt(bid,'best '+pfT(best));
  }
  cell('pf050','pf050b',p.t50,p.best50);
  cell('pf060mph','pf060mphb',p.t60mph,p.best60mph);
  cell('pf0100','pf0100b',p.t100,p.best100);
  var e1=document.getElementById('pf1000');
  if(e1){
    if(p.t1000>0){e1.textContent=pfT(p.t1000);e1.style.color='var(--accent)';}
    else if(p.brake_armed){e1.textContent='braking';e1.style.color='var(--yellow)';}
    else{e1.textContent='--';e1.style.color='';}
  }
  setTxt('pf1000b','best '+pfT(p.best1000));
  // Estimated longitudinal G (no IMU).
  setTxt('pfG',(p.g>=0?'+':'')+(p.g||0).toFixed(2)+'g');
  setTxt('pfGpk','peak +'+(p.gpk||0).toFixed(2)+' / '+(p.gpkb||0).toFixed(2));
  // Wheel slip (0x175, Party CAN).
  var se=document.getElementById('pfSlip');
  if(se){
    if(p.slip_ok){se.textContent=(p.slip>=0?'+':'')+p.slip.toFixed(1)+'%';se.style.color=Math.abs(p.slip)>5?'var(--red)':'var(--accent)';}
    else if(!p.wheel_seen){se.textContent='n/a';se.style.color='var(--text3)';}
    else{se.textContent='--';se.style.color='';}
  }
  // Power + pack temp (BMS, Vehicle-CAN tap).
  if(d.bms&&d.bms.seen){
    setTxt('pfPow',(d.bms.voltage*d.bms.current/1000).toFixed(1)+' kW');
    var tmax=d.bms.temp_max,tmin=d.bms.temp_min;
    if(!Number.isFinite(tmax)||!Number.isFinite(tmin)){setTxt('pfTemp','--');setTxt('pfAdv','Temperatur unbekannt');return;}
    var te=document.getElementById('pfTemp');
    if(te){
      te.textContent=tmin+'~'+tmax+'°C';
      te.style.color=tmax>=45?'var(--red)':tmax>=35?'var(--yellow)':tmin<=5?'var(--yellow)':'var(--accent)';
    }
    setTxt('pfAdv',tmin<=5?'Cold pack — reduced regen and power until warmed':tmax>=45?'Hot pack — power may be limited':'Normal');
  }else{
    setTxt('pfPow','--');setTxt('pfTemp','--');setTxt('pfAdv','No BMS frames (needs Vehicle-CAN tap)');
  }
}
function pill(id,on,txt,warnClass){
  var e=document.getElementById(id);
  e.className='pill '+(warnClass||''+(on?'on':'off'));
  e.innerHTML='<span class="pd"></span>'+txt;
}
function dot(id,on){
  var e=document.getElementById(id);
  if(e)e.className='blinkdot'+(on?' hit':'');
}
function speedText(v,seen,source){
  if(!seen)return '--';
  var src=source?'<small> '+source+'</small>':'';
  return Math.round(v)+' km/h'+src;
}
function updateControlsSummary(d){
  var e=document.getElementById('controlsSummary');
  if(!e)return;
  var items=[];
  if(d.op_mode===1)items.push('Active');
  if(d.ignore_ota)items.push('Ignore OTA');
  if(d.fsd_unlock)items.push('FSD Unlock');
  if(d.hw3_speed_override)items.push('HW3 Speed Override');
  if(d.nag_killer)items.push('NAG Killer');
  if(d.continuous_ap)items.push('Continuous AP');
  if(d.ap_first)items.push('AP-First');
  if(d.bms_output)items.push('BMS');
  if(d.force_fsd)items.push('Force FSD');
  if(d.china_mode)items.push('China');
  if(d.isa_speed_enabled&&d.suppress_speed_chime)items.push('Chime');
  if(d.tlssc_restore)items.push('TLSSC');
  if(d.gtw_supercharging_access)items.push('SC Unlock');
  if(d.gtw_eu_region)items.push('EU Region');
  if(d.cp_type_eu_test)items.push('CP Type continuous');
  if(d.assist_tlssc_bit38)items.push('TLSSC bit38');
  if(d.accel_mode>0)items.push('Accel '+(['','Chill','Sport','Performance'][d.accel_mode]||'?'));
  if(d.display_enabled)items.push('Display');
  if(d.can_dump)items.push('CAN Dump');
  e.textContent=items.length?items.join(', '):'Expand to setup';
  e.title=e.textContent;
}
// ── Black-box incident recorder (#124) ──
var bbCaptures=-1,bbNew=false,bbNoteDismissed=false;
try{bbNoteDismissed=localStorage.getItem('bbNote')==='1'}catch(e){}
function bbEsc(s){return String(s==null?'':s).replace(/[<>&"]/g,function(c){return{'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]})}
function bbDismiss(){bbNoteDismissed=true;try{localStorage.setItem('bbNote','1')}catch(e){}var n=document.getElementById('bbNote');if(n)n.style.display='none';}
function bbSeen(){bbNew=false;var bd=document.getElementById('bbBadge');if(bd)bd.style.display='none';}
function bbSync(d){
  var b=d.blackbox;if(!b)return;
  var sw=document.getElementById('swBlackbox');if(sw&&sw!==document.activeElement)sw.checked=!!b.enabled;
  pill('bbSt',b.enabled,b.save_lowmem?'Speicherfehler':b.queued?'Ereignis vorgemerkt':b.armed?'Capturing':(b.enabled?'Armed':'Off'));
  var st=document.getElementById('bbStore');
  if(st)st.textContent=(b.backend||'?')+' · '+(b.psram?'PSRAM':'internal')+' · '+((b.cap||0).toLocaleString())+' frames · '+(b.events||0)+' saved · verworfene Trigger '+(b.missed||0)+(b.save_lowmem?' · Speichern wegen Speichermangel fehlgeschlagen':'');
  var vw=document.getElementById('bbVolatileWarn');if(vw)vw.style.display=b.volatile?'block':'none';
  var note=document.getElementById('bbNote');if(note)note.style.display=bbNoteDismissed?'none':'block';
  var da=document.getElementById('bbDelAll');if(da)da.style.display=(b.events>0)?'block':'none';
  if(bbCaptures<0){bbCaptures=b.captures;bbRefreshList();}
  else if(b.captures!==bbCaptures){bbCaptures=b.captures;bbNew=true;bbRefreshList();}
  var bd=document.getElementById('bbBadge');if(bd)bd.style.display=bbNew?'inline-block':'none';
}
function bbRefreshList(){
  fetch('/blackbox/list').then(function(r){return r.json()}).then(function(a){
    var el=document.getElementById('bbList');if(!el)return;
    if(!a||!a.length){el.innerHTML='<div style="font-size:.78em;color:var(--text3);padding:6px 0">No events recorded yet.</div>';return;}
    a.sort(function(x,y){return (y.name||'').localeCompare(x.name||'')});
    var h='';
    a.forEach(function(ev){
      var s=ev.summary||{},nm=encodeURIComponent(ev.name);
      h+='<div style="border-top:1px solid var(--border);padding:8px 0">';
      h+='<div style="font-size:.8em;color:var(--text);font-family:monospace">'+bbEsc(s.detail||s.trigger||'event')+'</div>';
      h+='<div style="font-size:.72em;color:var(--text3);margin:2px 0">'+bbEsc(s.hw||'')+' · '+(s.frames||0)+' frames · '+bbEsc((s.buses&&s.buses.dual_can)?'dual-CAN':'single')+'</div>';
      h+='<div style="display:flex;gap:6px;margin-top:4px">';
      h+='<a class="btn-main btn-blue" style="padding:4px 10px;font-size:.7em;flex:0" href="/blackbox/get?name='+nm+'&type=log" onclick="bbSeen()">.log</a>';
      h+='<a class="btn-main btn-blue" style="padding:4px 10px;font-size:.7em;flex:0" href="/blackbox/get?name='+nm+'&type=json" onclick="bbSeen()">.json</a>';
      h+='<button type="button" class="btn-main btn-stop" style="padding:4px 10px;font-size:.7em" onclick="bbDelete(\''+bbEsc(ev.name)+'\')">del</button>';
      h+='</div></div>';
    });
    el.innerHTML=h;
  }).catch(function(){});
}
function bbDelete(n){cmd('blackbox_delete',n);setTimeout(bbRefreshList,400);}
function bbDeleteAll(){if(confirm('Delete all recorded events from the device?')){cmd('blackbox_delete_all',true);bbSeen();setTimeout(bbRefreshList,400);}}
// ── Tap capability checker (#125) ──
var CAP_MSG={
  nag_killer:['0x370 + DAS state present — gates correctly',
              '0x370 here but no DAS state — dual-CAN recommended (read DAS on a second tap)',
              'no 0x370 on this tap — wrong bus for the nag killer'],
  ap_first:['DAS state readable',
            'dual-CAN',
            'no DAS state here (need 0x399/0x39B)'],
  fsd_activation:['AP control frame present (0x3FD/0x3EE)',
                  '',
                  'no AP control frame to modify here'],
  soft_engage:['0x129 steering angle present',
               '',
               'no 0x129 — degrades to AP-First-only'],
  body_control:['Vehicle/body bus reachable — mirror/window/lights frames present (RX only; not proof of actuation)',
                '',
                'not on this tap — needs the X179 A-pillar (Vehicle-bus) tap']};
function capRow(name,key,v){
  var col=v===0?'var(--accent)':v===1?'var(--yellow)':'var(--red)';
  var sym=v===0?'✓':v===1?'⚠':'✗';
  var msg=(CAP_MSG[key]||['','',''])[v]||'';
  return '<div style="display:flex;gap:8px;padding:5px 0;border-top:1px solid var(--border)">'
    +'<span style="color:'+col+';font-weight:700;flex:0 0 14px">'+sym+'</span>'
    +'<span style="flex:0 0 92px;font-size:.8em;color:var(--text)">'+name+'</span>'
    +'<span style="font-size:.73em;color:var(--text3);line-height:1.3">'+msg+'</span></div>';
}
function capSync(d){
  var c=d.capability;if(!c)return;
  pill('capSt',c.state===2,c.state===1?'Listening…':(c.state===2?'Done':'Idle'));
  var btn=document.getElementById('capBtn');if(btn)btn.disabled=(c.state===1);
  var el=document.getElementById('capBody');if(!el)return;
  if(c.state===0){el.innerHTML='<div style="font-size:.78em;color:var(--text3);padding:6px 0">Connect to run a check, or press Re-check.</div>';return;}
  if(c.state===1){el.innerHTML='<div style="font-size:.8em;color:var(--text2);padding:6px 0">Listening on the bus… '+Math.ceil((c.ms_left||0)/1000)+'s</div>';return;}
  var buses=c.buses||[];
  if(!buses.length){el.innerHTML='<div style="font-size:.8em;color:var(--yellow);padding:6px 0">No frames seen — check wiring / that the car is awake.</div>';return;}
  var dual=buses.length>1;
  var h='';
  buses.forEach(function(b){
    h+='<div style="margin-top:8px">';
    if(dual)h+='<div style="font-size:.78em;color:var(--text2);font-weight:600;margin-bottom:2px">'+bbEsc(b.bus)+' &middot; '+(b.frames||0)+' frames</div>';
    h+=capRow('Nag killer','nag_killer',b.nag_killer);
    h+=capRow('AP-First','ap_first',b.ap_first);
    h+=capRow('FSD activate','fsd_activation',b.fsd_activation);
    h+=capRow('Soft Engage','soft_engage',b.soft_engage);
    h+=capRow('Body/comfort bus','body_control',b.body_control);
    if(b.body_control===0){
      var seen=[];
      if(b.body_ui)seen.push('mirror/lock/horn');
      if(b.body_window)seen.push('windows');
      if(b.body_lights)seen.push('lights/turn');
      if(b.body_door)seen.push('mirror read-back');
      if(seen.length)h+='<div style="font-size:.7em;color:var(--text3);padding-top:3px">Reachable frames: '+seen.join(', ')+' (presence only — not proof injection actuates them).</div>';
    }
    var hint=b.hint?('Best guess: '+bbEsc(b.hint)+' — confirm in Service Mode → CAN Port'):'';
    if(hint)h+='<div style="font-size:.7em;color:var(--text3);padding-top:5px">'+hint+'</div>';
    if(b.hw_unconfirmed)h+='<div style="font-size:.7em;color:var(--yellow);padding-top:3px">HW unconfirmed — 0x399 reading assumed; verdict may change once HW is detected.</div>';
    h+='</div>';
  });
  el.innerHTML=h;
}
function ring(p){
  var b=document.getElementById('socBar');
  b.style.strokeDashoffset=CIRC-(CIRC*Math.min(p,100)/100);
  b.style.stroke=socCol(p);
}

function upd(d){
  updateSuspensionControls(d);
  updateOffsetTxStatus(d);
  if(d && Array.isArray(d.suspension_heights)){
    suspensionPreviewHeights=d.suspension_heights;
    suspensionPreviewAt=d.suspension_heights_fresh?Date.now():0;
    updateOffsetPreview();
  }
  var fwTag=document.getElementById('fwTag');
  if(d && fwTag){
    fwTag.textContent=d.fw_version||d.fw_build||'Version unbekannt';
    fwTag.title=d.fw_build||'';
  }
  if(!d || Date.now() < busy) return;
  // Status
  var apActive=!!d.ap_active;
  pill('fsdSt', apActive, apActive?'Active':'Waiting');
  pill('opMode', d.op_mode===1, d.op_mode===1?'Funktionen aktiv':'Funktionen aus');

  var hwEl=document.getElementById('hwVer');
  if(hwEl){
    hwEl.className='pill '+(d.hw_version>0?'on':'off');
    hwEl.innerHTML='<span class="pd"></span>'+(HW[d.hw_version]||'?');
  }

  // HW3 speed read-out (#209): car value -> value forwarded on 0x3FD; -1 = not seen
  var h3r=document.getElementById('rowHw3Spd');
  if(h3r){
    h3r.style.display=d.hw_version===2?'flex':'none';
    var h3v=function(c,o){return (c===undefined||c<0)?'--':c+'\u2192'+o;};
    var h3t=document.getElementById('hw3Spd');
    if(h3t)h3t.textContent='Profile '+h3v(d.hw3_car_profile,d.hw3_sent_profile)+' \u00b7 Offset '+h3v(d.hw3_car_offset,d.hw3_sent_offset)+' \u00b7 Follow '+((d.follow_distance===undefined||d.follow_distance<0)?'--':d.follow_distance);
  }

  pill('nagSt', d.nag_killer, d.nag_killer?'ON':'OFF');
  pill('canVeh', d.can_vehicle_detected, d.can_vehicle_detected?'Detected':'No CAN Traffic');
  pill('bmsSt', d.bms && d.bms.seen, (d.bms && d.bms.seen)?'Live':'Waiting Frames');
  var bF=document.getElementById('bmsFrames');
  if(bF) bF.textContent='HV:'+(d.bms_hv_seen||0)+' SOC:'+(d.bms_soc_seen||0)+' TH:'+(d.bms_thermal_seen||0);

  // OTA banner
  var otaB=document.getElementById('otaBanner');
  if(otaB){
    otaB.style.display=(d.ota||d.module_update_block)?'block':'none';
    if(d.module_update_block)otaB.textContent='Modulupdate: CAN-Senden gesperrt bis zum Neustart';
    if(d.ota&&!d.module_update_block) otaB.innerHTML=d.ignore_ota?'&#9888;&#xFE0F; OTA UPDATE IN PROGRESS &mdash; TX ALLOWED BY IGNORE OTA':'&#9888;&#xFE0F; OTA UPDATE IN PROGRESS &mdash; CAN TX SUSPENDED';
  }

  // Autopark banner (#180) — TX paused during an in-car Autopark episode
  var apB=document.getElementById('autoparkBanner');
  if(apB) apB.style.display=d.autopark_block?'block':'none';

  // Signal Map watchdog banner (#100)
  var smW=document.getElementById('sigmapWarn');
  if(smW) smW.style.display=d.signal_map_das_missing?'block':'none';

  // 14.x firmware warning banner
  var w14x=document.getElementById('warn14x');
  if(w14x) w14x.style.display=d.firmware_14x_warning?'block':'none';

  // Mode button
  var act=d.op_mode===1;
  var btn=document.getElementById('btnMode');
  if(btn){
    btn.textContent=act?'Deaktivieren':'Aktivieren';
    btn.className='btn-main '+(act?'btn-stop':'btn-act');
  }

  // Switches sync
  if(document.getElementById('swIgnoreOta')) document.getElementById('swIgnoreOta').checked=d.ignore_ota;
  // Manual HW selection (#110) — don't fight the user while the menu is open.
  var hwSel=document.getElementById('selHwOverride');
  if(hwSel && d.hw_override!==undefined && document.activeElement!==hwSel) hwSel.value=String(d.hw_override);
  if(document.getElementById('swFsdUnlock')) document.getElementById('swFsdUnlock').checked=d.fsd_unlock;
  if(document.getElementById('swHw3Spd')) document.getElementById('swHw3Spd').checked=d.hw3_speed_override;
  if(document.getElementById('swNag')) document.getElementById('swNag').checked=d.nag_killer;
  if(document.getElementById('swContinuousAp')) document.getElementById('swContinuousAp').checked=d.continuous_ap;
  if(document.getElementById('swApFirst')) document.getElementById('swApFirst').checked=d.ap_first;
  if(document.getElementById('swApFe')) document.getElementById('swApFe').checked=d.ap_first_edge;
  if(document.getElementById('swApMi')) document.getElementById('swApMi').checked=d.ap_first_minimal;
  if(document.getElementById('swNagF')) document.getElementById('swNagF').checked=d.nag_faithful;
  if(document.getElementById('swSoft')) document.getElementById('swSoft').checked=d.soft_engage;
  if(document.getElementById('swNagB')) document.getElementById('swNagB').checked=d.nag_burst;
  if(document.getElementById('swAbrt')) document.getElementById('swAbrt').checked=d.abort_guard;
  if(d.cfg_das_id!==undefined) setSig(d);
  if(document.getElementById('swBms')) document.getElementById('swBms').checked=d.bms_output;
  if(document.getElementById('swFsd')) document.getElementById('swFsd').checked=d.force_fsd;
  if(document.getElementById('swChina')) document.getElementById('swChina').checked=d.china_mode;
  if(document.getElementById('swChime')) document.getElementById('swChime').checked=d.suppress_speed_chime;
  if(document.getElementById('swPrecond')) document.getElementById('swPrecond').checked=d.precondition;
  if(document.getElementById('rowChime')) document.getElementById('rowChime').style.display=d.isa_speed_enabled?'flex':'none';
  if(document.getElementById('swTlssc')) document.getElementById('swTlssc').checked=d.tlssc_restore;
  var scSel=document.getElementById('selScAcc');
  if(scSel && d.gtw_supercharging_access!==undefined && document.activeElement!==scSel) scSel.value=String(d.gtw_supercharging_access);
  if(document.getElementById('swEuReg')) document.getElementById('swEuReg').checked=d.gtw_eu_region;
  if(document.getElementById('swCpTypeEU')) document.getElementById('swCpTypeEU').checked=!!d.cp_type_eu_test;
  var cpBusSel=document.getElementById('selCpTypeBus');
  if(d.cp_type_bus!==undefined)cpBusSel.value=String(d.cp_type_bus);
  if(d.cp_type_active_bus!==undefined)
    document.getElementById('cpBusDetected').textContent=d.cp_type_active_bus<0?'wartet auf Frames':'can'+d.cp_type_active_bus;
  if(document.getElementById('swSummon')) document.getElementById('swSummon').checked=d.summon_unlock;
  if(document.getElementById('swCog')) document.getElementById('swCog').checked=d.continue_on_green;
  if(document.getElementById('swTlssc38')) document.getElementById('swTlssc38').checked=d.assist_tlssc_bit38;
  if(document.getElementById('swRhd')) document.getElementById('swRhd').checked=d.assist_rhd_override;
  if(document.getElementById('swTelOff')) document.getElementById('swTelOff').checked=d.assist_telemetry_off;
  var apmv3Sel=document.getElementById('selApmv3');
  if(apmv3Sel && d.apmv3_branch!==undefined && document.activeElement!==apmv3Sel) apmv3Sel.value=String(d.apmv3_branch);
  // Acceleration Mode (#211): setting + car map -> map going out
  var acSel=document.getElementById('selAccel');
  if(acSel && d.accel_mode!==undefined && document.activeElement!==acSel) acSel.value=String(d.accel_mode);
  var acSt=document.getElementById('accelSt');
  if(acSt && d.accel_car_map!==undefined){
    var ACM=['CHILL','SPORT','PERFORMANCE'], at;
    if(d.accel_car_map<0) at=d.accel_bad>0?'0x334 not recognised ('+d.accel_bad+' rejected)':'no 0x334 on this bus yet';
    else if(d.accel_sent_map===d.accel_car_map) at='Car '+ACM[d.accel_car_map]+' \u00b7 pass-through';
    else at='Car '+ACM[d.accel_car_map]+' \u2192 sent '+ACM[d.accel_sent_map];
    if(d.accel_pending) at+=' \u00b7 waiting for standstill';
    else if(d.accel_mode>0 && !d.tx_allowed) at+=' \u00b7 TX off';
    acSt.textContent=at;
  }
  if(document.getElementById('swTrkMode')) document.getElementById('swTrkMode').checked=d.track_mode_inject;
  if(document.getElementById('trkRot')&&document.activeElement.id!=='trkRot'&&d.track_rotation_pct!==undefined){document.getElementById('trkRot').value=d.track_rotation_pct;var _tr=document.getElementById('trkRotV');if(_tr)_tr.textContent=d.track_rotation_pct;}
  if(document.getElementById('trkStab')&&document.activeElement.id!=='trkStab'&&d.track_stability_pct!==undefined){document.getElementById('trkStab').value=d.track_stability_pct;var _ts=document.getElementById('trkStabV');if(_ts)_ts.textContent=d.track_stability_pct;}
  if(document.getElementById('swTrkPC')) document.getElementById('swTrkPC').checked=d.track_post_cooling;
  if(document.getElementById('swTrkCO')) document.getElementById('swTrkCO').checked=d.track_cmp_overclock;
  var pwrSel=document.getElementById('selPwrBst');
  if(pwrSel && d.power_boost_pct!==undefined && document.activeElement!==pwrSel) pwrSel.value=String(d.power_boost_pct);
  if(document.getElementById('swDisp')) document.getElementById('swDisp').checked=!!d.display_enabled;
  if(document.activeElement.id!=='dispBr' && document.getElementById('dispBr'))
    document.getElementById('dispBr').value=d.display_brightness||50;
  if(document.activeElement.id!=='dispTo' && document.getElementById('dispTo'))
    document.getElementById('dispTo').value=d.display_timeout_s||60;
  if(document.getElementById('swDump')) document.getElementById('swDump').checked=!!d.can_dump;

  if(document.activeElement.id!=='numSleep' && document.getElementById('numSleep'))
    document.getElementById('numSleep').value=Math.floor((d.sleep_ms||0)/1000);

  updateControlsSummary(d);
  pill('dumpSt',d.can_dump,d.can_dump?'Recording':'Idle');

  // CAN stats
  if(document.getElementById('rxCnt')) document.getElementById('rxCnt').textContent=(d.rx_count||0).toLocaleString();
  if(document.getElementById('txCnt')) document.getElementById('txCnt').textContent=(d.tx_count||0).toLocaleString();
  if(document.getElementById('crcErr')) document.getElementById('crcErr').textContent=d.crc_errors||0;
  if(document.getElementById('crcSplit')) document.getElementById('crcSplit').textContent='RX\u00a0missed\u00a0'+(d.rx_missed_count||0)+' · bus\u00a0'+(d.bus_error_count||0)+' · TX\u00a0fail\u00a0'+(d.tx_failed_count||0);
  if(document.getElementById('rxService')) document.getElementById('rxService').textContent=(d.can_processing_task?'Independent CAN':(d.can_rx_task?'Independent RX / loop handlers':'Loop RX'))+' · CAN queue lost '+(d.can_rx_queue_dropped||0)+' · log queue lost '+(d.can_observer_dropped||0)+' · CP TX fail '+(d.can_cp_tx_failed||0)+' · MCP overflow events '+(d.can1_overflow_events||0)+' · recent '+Number(d.can1_overflow_per_s||0).toFixed(1)+'/s · RX filters '+(d.can0_filter_mode||'?')+'/'+(d.can1_filter_mode||'?');
  if(Array.isArray(d.can_buses))document.getElementById('perBusCounts').textContent=d.can_buses.map(function(b,i){return 'CAN'+i+' RX '+b.rx+' TX '+b.tx+' Miss '+b.missed+' Bus '+b.bus+' Fail '+b.failed;}).join(' · ');
  if(document.getElementById('canTiming')) document.getElementById('canTiming').textContent='CAN backlog '+(d.can_rx_buffered||0)+' · max age '+(d.can_rx_max_dispatch_age_ms||0)+' ms · MCP poll gap max '+(d.can_mcp_max_poll_gap_us||0)+' us · handler max '+(d.can_max_handler_us||0)+' us · timer gap max '+(d.can_max_tick_gap_ms||0)+' ms · Web loop max '+Number(d.loop_max_us||0)/1000+' ms · >25ms '+(d.loop_slow||0)+' · '+(d.loop_stage||'--');
  if(document.getElementById('fps')) document.getElementById('fps').textContent=(d.fps||0.0).toFixed(1);
  if(document.getElementById('httpLogBuf'))
    document.getElementById('httpLogBuf').textContent=((d.http_can_stream&&d.http_can_stream.buffered)||0)+' frames';
  if(document.getElementById('httpLogDrop'))
    document.getElementById('httpLogDrop').textContent=((d.http_can_stream&&d.http_can_stream.dropped)||0)+' frames / rx-missed '+((d.http_can_stream&&d.http_can_stream.rx_missed)||0);

  // Battery
  if(d.bms && d.bms.seen){
    var sn=document.getElementById('bSoc');
    if(sn){
      sn.textContent=d.bms.soc.toFixed(0)+'%';
      sn.style.color=socCol(d.bms.soc);
    }
    ring(d.bms.soc);
    if(document.getElementById('bVolt')) document.getElementById('bVolt').textContent=d.bms.voltage.toFixed(0)+'V';
    var ce=document.getElementById('bCurr');
    if(ce){
      ce.textContent=(d.bms.current>=0?'+':'')+d.bms.current.toFixed(1)+'A';
      ce.style.color=d.bms.current>=0?'var(--accent)':'var(--red)';
    }
    if(document.getElementById('bTemp')) document.getElementById('bTemp').textContent=(Number.isFinite(d.bms.temp_min)&&Number.isFinite(d.bms.temp_max)?d.bms.temp_min+'~'+d.bms.temp_max+'\u00b0C':'--');
  }

  // Performance (read-only, opt-in)
  renderPerf(d);

  // Device
  if(document.getElementById('fwBuild')) document.getElementById('fwBuild').textContent=d.fw_build;
  if(document.getElementById('uptime')) document.getElementById('uptime').textContent=fmt(d.uptime_s||0);
  if(document.getElementById('wifiCl')) document.getElementById('wifiCl').textContent=d.wifi_clients||0;
  var partEl=document.getElementById('otaPartInfo');
  if(partEl && d.ota_partition){
    var p=d.ota_partition;
    var stateStr=(p.state===0)?'New':(p.state===1)?'Pending':(p.state===2)?'Valid':(p.state===3)?'Invalid':'State '+p.state;
    partEl.textContent=p.running+' ('+stateStr+') - '+(p.has_ota?'OTA capable':'No OTA partition');
    var info=document.getElementById('otaRollbackInfo');
    if(info && !p.has_ota){
      info.innerHTML='<b style="color:var(--red)">No OTA Partition</b><br>This build appears to be running from a factory/single app partition. Use an OTA partition table before relying on Web updates.';
    }
  }
}

function selectFirmware(el){
  document.getElementById('otaFile').click();
}

function restartDevice(el){
  restartAnchor=el;
  showRestartConfirm(el);
}

function movePanelNear(panel,anchor){
  if(!panel || !anchor)return;
  var card=anchor.closest?anchor.closest('.card'):null;
  if(card && panel.parentNode!==card)card.appendChild(panel);
}

function showRestartConfirm(anchor){
  var p=document.getElementById('restartConfirmPanel');
  movePanelNear(p,anchor);
  if(p)p.className='confirm-panel show';
}

function cancelRestartConfirm(){
  var p=document.getElementById('restartConfirmPanel');
  if(p)p.className='confirm-panel';
}

function confirmRestart(){
  cancelRestartConfirm();
  requestRestart();
}

function requestRestart(){
  fetch('/restart',{method:'POST'}).then(function(r){
    if(!r.ok){alert('Restart request failed');return;}
    alert('Device restart triggered');
    setTimeout(function(){location.reload();},8000);
  }).catch(function(){setTimeout(function(){location.reload();},8000);});
}

function sdFormat(){
  if(!confirm('Format SD card? All data will be lost.'))return;
  var btn=document.getElementById('btnFmt');
  var out=document.getElementById('fmtOut');
  btn.disabled=true;btn.textContent='FORMATTING\u2026';
  fetch('/sdformat',{method:'POST'}).then(function(r){return r.json();}).then(function(d){
    out.style.display='block';
    out.style.color=d.ok?'var(--accent)':'var(--red)';
    out.textContent=d.msg+(d.ok?' \u2014 '+d.free_mb+' MB free':'');
  }).catch(function(){
    out.style.display='block';out.style.color='var(--red)';out.textContent='Request failed';
  }).then(function(){
    btn.disabled=false;btn.textContent='FORMAT SD CARD';
  });
}
function saveWifi(){
  var s=document.getElementById('wifiSsid').value;
  var p=document.getElementById('wifiPass').value;
  var h=document.getElementById('swWifiHid').checked;
  var ss=document.getElementById('wifiStaSsid').value;
  var sp=document.getElementById('wifiStaPass').value;
  if(s.length<1){alert('SSID required');return;}
  if(p!=='***' && p.length>0 && p.length<8){alert('Password must be empty or 8+ chars');return;}
  if(sp!=='***' && ss.length>0 && sp.length>0 && sp.length<8){alert('Network password must be empty or 8+ chars');return;}
  if(confirm('WiFi settings will be updated and the device will restart.')){
    var b=document.activeElement; if(b&&b.tagName==='BUTTON'){b.disabled=true;b.textContent='SAVING...';}
    cmd('wifi_cfg',{ssid:s,pass:p,hidden:h,sta_ssid:ss,sta_pass:sp});
  }
}
function cmd(c,v){
  if(ws&&ws.readyState===1) {
    ws.send(JSON.stringify({cmd:c,value:v}));
    busy = Date.now() + 3000;
  }
}
function requestSuspension(level){
  if(!ws||ws.readyState!==1)return;
  document.getElementById('suspVeryLow').disabled=true;
  document.getElementById('suspLow').disabled=true;
  document.getElementById('suspStatus').textContent='Requesting '+(level===1?'very low':'low')+'...';
  ws.send(JSON.stringify({cmd:'suspension_height',value:level}));
}
var suspensionPreviewHeights=[null,null,null,null],suspensionPreviewAt=0;
var stanceActive=false,suspensionControlsAt=0;
function updateSuspensionControls(d){
  if(!d)return;
  suspensionControlsAt=Date.now();
  document.getElementById('suspVeryLow').disabled=!d.suspension_ready||!!d.suspension_pending;
  document.getElementById('suspLow').disabled=!d.suspension_ready||!!d.suspension_pending;
  document.getElementById('suspStatus').textContent=(d.suspension_status||'Warten auf Fahrzeugdaten')+
    (d.suspension_ready?' · Manuell bereit':' · Manuelle Hoehenwahl: P, Stillstand und frische Daten erforderlich');
  var state=d.suspension_stance_state||0;
  stanceActive=typeof d.suspension_stance_enabled==='boolean'?d.suspension_stance_enabled:[1,2,3,4,6,7].includes(state);
  var button=document.getElementById('suspStance');
  button.disabled=!stanceActive&&!(d.suspension_stance_available===undefined?d.suspension_ready:d.suspension_stance_available);
  button.setAttribute('aria-pressed',String(stanceActive));
  button.querySelector('span').textContent=stanceActive?'Stance beenden':'Stance Mode';
  document.getElementById('stanceStatus').textContent=[
    'Stance-Automatik ist aus.',
    'P erkannt · warte auf Stillstand und freie CAN-Vorlage fuer Sehr tief.',
    'Stance aktiv · Sehr tief angefordert; D/R fordert Tief an.',
    'D/R erkannt · Tief wird angefordert.',
    'Tief gesendet · Automatik bleibt aktiv und wartet auf P.',
    stanceActive?'Stance-Anforderung fehlgeschlagen · Fahrzeughoehe pruefen; naechster Gangwechsel oder aus/ein.':'Stance durch Sperre beendet · Fahrzeughoehe pruefen.',
    'Stance aktiv · wartet auf P.',
    'Stance aktiv · wartet auf frische Gang-/Geschwindigkeitsdaten.'
  ][state]||'Stance-Status unbekannt.';
  var gearLabel={1:'P',2:'R',3:'N',4:'D'}[d.suspension_gear]||'--';
  var speedLabel=typeof d.suspension_speed_kph==='number'?d.suspension_speed_kph.toFixed(1)+' km/h':'Geschwindigkeit unbekannt';
  document.getElementById('stanceVehicle').textContent='Gang: '+gearLabel+' · '+speedLabel;

}
function toggleStance(){
  if(!ws||ws.readyState!==1)return;
  document.getElementById('suspStance').disabled=true;
  ws.send(JSON.stringify({cmd:'suspension_stance',value:stanceActive?0:1}));
}
var suspensionOffsetWheels=['FL','FR','RL','RR'];
function sendOffsetTest(){
  var values=readOffsetPreview(),notice=document.getElementById('offsetNotice');
  if(!values){notice.textContent='Nicht gesendet: nur 4-mm-Schritte von -40 bis +40 mm.';return;}
  if(!ws||ws.readyState!==1){notice.textContent='Nicht gesendet: keine Verbindung zum Modul.';return;}
  var packed=0x100000;
  values.forEach(function(v,i){packed|=(v/4+10)<<(i*5);});
  ws.send(JSON.stringify({cmd:'suspension_offsets',value:packed}));
  notice.textContent='Anforderung gesendet. Den bestätigten Modulstatus und die angewendeten Offsets darunter prüfen.';
}
function stopOffsetTest(){
  if(!ws||ws.readyState!==1){document.getElementById('offsetNotice').textContent='Stoppen nicht bestätigt: keine Verbindung zum Modul.';return false;}
  ws.send(JSON.stringify({cmd:'suspension_offsets',value:0}));
  return true;
}
function updateOffsetTxStatus(d){
  if(!d || typeof d.suspension_offset_enabled!=='boolean')return;
  var labels=['Aus','Wartet auf frische Originalnachricht','CAN-Kopie gesendet','Pausiert: keine frischen Höhendaten, TX gesperrt, Fahrwerksfunktion belegt oder Echopuffer voll','Höhenwert ungültig oder ausserhalb des darstellbaren Bereichs','Sendefehler; pausiert bis erneut „Offsets senden“ gedrückt wird'];
  var text=(d.suspension_offset_enabled?'Offset-Senden EIN · ':'Offset-Senden AUS · ')+(labels[d.suspension_offset_result]||'Unbekannt')+' · TX '+(d.suspension_offset_sent||0);
  if(Array.isArray(d.suspension_offset_values))text+=' · VL/VR/HL/HR: '+d.suspension_offset_values.join('/')+' mm';
  document.getElementById('offsetTxStatus').textContent=text;
}
function readOffsetPreview(){
  var values=suspensionOffsetWheels.map(function(w){var text=document.getElementById('offset'+w).value.trim();return text===''?NaN:Number(text);});
  return values.every(function(v){return Number.isInteger(v)&&v>=-40&&v<=40&&v%4===0;})?values:null;
}
function updateOffsetPreview(){
  var offsets=readOffsetPreview(),fresh=suspensionPreviewAt!==0&&Date.now()-suspensionPreviewAt<=2000;
  suspensionOffsetWheels.forEach(function(w,i){
    var out=document.getElementById('height'+w),height=suspensionPreviewHeights[i];
    document.getElementById('current'+w).innerHTML=(fresh&&Number.isFinite(height)?height:'—')+' <small>mm</small>';
    if(!offsets){out.textContent='Offset: -40 bis +40 mm in 4-mm-Schritten';return;}
    if(!fresh||!Number.isFinite(height)){out.textContent='Keine frischen Höhenwerte';return;}
    var value=height+offsets[i],wire=Math.round(value/4)*4;
    out.textContent='Ist '+height+' mm → Vorschau '+value+' mm'+
      (value< -128||value>120?' · ausserhalb 0x199-Bereich':wire!==value?' · in 0x199 darstellbar: '+wire+' mm':'');
  });
}
function saveOffsetPreview(){
  var values=readOffsetPreview(),notice=document.getElementById('offsetNotice');
  if(!values){notice.textContent='Nicht gespeichert: alle vier Offsets muessen zwischen -40 und +40 mm liegen und durch 4 teilbar sein.';return;}
  try{localStorage.setItem('suspensionOffsetPreviewV1',JSON.stringify(values));notice.textContent='Im Browser gespeichert. Zum Anwenden „Offsets senden“ drücken. Aktive CAN-Offsets stehen im Modulstatus.';}
  catch(e){notice.textContent='Browser-Speicher nicht verfuegbar. Vorschau gilt nur bis zum Neuladen.';}
}
function resetOffsetPreview(){
  if(!stopOffsetTest())return;
  suspensionOffsetWheels.forEach(function(w){document.getElementById('offset'+w).value=0;});
  updateOffsetPreview();saveOffsetPreview();
}
try{
  var restoredOffsets=JSON.parse(localStorage.getItem('suspensionOffsetPreviewV1')||'null');
  if(Array.isArray(restoredOffsets)&&restoredOffsets.length===4&&restoredOffsets.every(function(v){return Number.isInteger(v)&&v>=-40&&v<=40&&v%4===0;}))
    suspensionOffsetWheels.forEach(function(w,i){document.getElementById('offset'+w).value=restoredOffsets[i];});
}catch(e){}
setInterval(updateOffsetPreview,500);
setInterval(function(){
  if(!suspensionControlsAt||Date.now()-suspensionControlsAt>3000)
    ['suspVeryLow','suspLow','suspStance'].forEach(function(id){document.getElementById(id).disabled=true;});
},500);
function toggleMode(){ cmd('mode',null); }
function gv(id){ var e=document.getElementById(id); return (e&&e.value.trim()!=='')?e.value.trim():'0'; }
function saveSigCfg(){
  var csv=[gv('cgDid'),gv('cgApB'),gv('cgApS'),gv('cgApM'),
           gv('cgHoB'),gv('cgHoS'),gv('cgHoM'),
           gv('cgSid'),gv('cgSHi'),gv('cgSLo')].join(',');
  cmd('sig_cfg',csv);
}
function sv(id,val){ var e=document.getElementById(id); if(e&&e!==document.activeElement) e.value=val; }
function hx(n){ return n?('0x'+n.toString(16).toUpperCase()):'0'; }
// ── Built-in variant-profile auto-suggest (#126) ──
var PM_SUG=null;
function pmSync(d){
  var p=d.profile;var el=document.getElementById('pmSuggest');if(!el)return;
  if(p&&p.suggest){
    PM_SUG=p;
    var nm=document.getElementById('pmName');if(nm)nm.textContent=p.name||'?';
    el.style.display='block';
  } else {
    PM_SUG=null;el.style.display='none';
  }
}
function sf(id,val){ var e=document.getElementById(id); if(e) e.value=val; }
function pmApply(){
  var p=PM_SUG;if(!p)return;
  // One-tap confirm: fill the Signal Map fields from the suggested profile and
  // apply via the existing sig_cfg path. Steer mapping is left as-is (0 unless
  // the user already set it). Never applied without this tap.
  sf('cgDid',hx(p.das_id));
  sf('cgApB',p.apb); sf('cgApS',p.aps); sf('cgApM',hx(p.apm));
  sf('cgHoB',p.hob); sf('cgHoS',p.hos); sf('cgHoM',hx(p.hom));
  saveSigCfg();
}
function setSig(d){
  sv('cgDid',hx(d.cfg_das_id)); sv('cgApB',d.cfg_apb); sv('cgApS',d.cfg_aps); sv('cgApM',hx(d.cfg_apm));
  sv('cgHoB',d.cfg_hob); sv('cgHoS',d.cfg_hos); sv('cgHoM',hx(d.cfg_hom));
  sv('cgSid',hx(d.cfg_steer_id)); sv('cgSHi',d.cfg_shi); sv('cgSLo',d.cfg_slo);
}

function logInfo(text,color){
  var e=document.getElementById('httpLogInfo');
  if(!e)return;
  e.textContent=text;
  e.style.color=color||'var(--text2)';
}

function setHttpLogUi(running){
  var btn=document.getElementById('btnHttpLog');
  btn.textContent=running?'Stop Logging':'Start Logging';
  btn.className=running?'btn-main btn-stop':'btn-main btn-blue';
  pill('httpLogSt',running||!!httpLogSaveUrl,running?'Collecting':(httpLogSaveUrl?'Ready':'Idle'));
}

function formatBytes(n){
  if(n<1024)return n+' B';
  if(n<1048576)return (n/1024).toFixed(1)+' KB';
  return (n/1048576).toFixed(1)+' MB';
}

function logFileName(){
  var d=new Date();
  function p(n){return n<10?'0'+n:''+n;}
  return 'tesla_can_'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'_'
    +p(d.getHours())+p(d.getMinutes())+p(d.getSeconds())+'.dump';
}

function clearHttpLogBlob(){
  if(httpLogSaveUrl)URL.revokeObjectURL(httpLogSaveUrl);
  httpLogSaveUrl='';
  var link=document.getElementById('httpLogDownload');
  link.hidden=true;
  link.removeAttribute('href');
}

function stopHttpLog(reason){
  if(!httpLogRunning)return;
  httpLogRunning=false;
  ++httpLogGeneration;
  if(httpLogReader)httpLogReader.cancel().catch(function(){});
  if(httpLogAbort)httpLogAbort.abort();
  httpLogReader=null;
  httpLogAbort=null;
  if(httpLogBytes>0){
    httpLogSaveUrl=URL.createObjectURL(new Blob(httpLogParts,{type:'text/plain;charset=utf-8'}));
    var link=document.getElementById('httpLogDownload');
    link.href=httpLogSaveUrl;
    link.download=logFileName();
    link.textContent=link.download+' ('+formatBytes(httpLogBytes)+')';
    link.hidden=false;
    if(!reason)link.click();
  }
  httpLogParts=[];
  setHttpLogUi(false);
  logInfo(reason||(httpLogSaveUrl?'Download gestartet.':'Keine Logdaten empfangen.'),
    reason||!httpLogSaveUrl?'var(--yellow)':'var(--accent)');
}

function toggleHttpLog(){
  if(httpLogRunning)stopHttpLog();
  else startHttpLog();
}
var httpLogLastChunk=0,httpLogLastPaint=0;
setInterval(function(){
  if(httpLogRunning&&Date.now()-httpLogLastChunk>5000)
    logInfo('Seit mehr als 5 s keine neuen Logdaten. Aufnahme kann gestoppt werden.','var(--yellow)');
},1000);

// ── Aux status poll (#124) ──
// blackbox/capability/profile are served on demand from /api/aux, NOT in the
// hot 1 Hz WS state push. Poll them on a slower timer so the black-box card,
// Tap Check card and profile suggestion stay live without bloating each push.
var auxBusy=false;
function auxPoll(){
  if(auxBusy)return;
  auxBusy=true;
  fetch('/api/aux').then(function(r){return r.json()}).then(function(a){
    if(a){bbSync(a);capSync(a);pmSync(a);}
  }).catch(function(){}).then(function(){auxBusy=false;});
}
setInterval(auxPoll,2500);

perfInit();
/* BLE connects only after a user gesture. */
