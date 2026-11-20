"use strict";
(function(){
var SA = window.SA = {};
var $ = function(id){ return document.getElementById(id); };

function fmtInt(v){ return String(Math.round(v)); }
function fmtTime(v){ return Number(v).toFixed(2) + "s"; }
function rand(a, b){ return a + Math.random() * (b - a); }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function rng(seed){
  var a = seed >>> 0;
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function getBest(id){
  try { var v = localStorage.getItem("sa_best_" + id); return v === null ? null : Number(v); } catch(e){ return null; }
}
function saveBest(id, v){
  try {
    var b = getBest(id);
    var better = E.lowerBetter ? (b === null || v < b) : (b === null || v > b);
    if (better) localStorage.setItem("sa_best_" + id, String(v));
  } catch(e){}
}
function getOpt(defId, key, choices){
  try {
    var v = localStorage.getItem("sa_opt_" + defId + "_" + key);
    if (v !== null && choices.indexOf(v) >= 0) return v;
  } catch(e){}
  return choices[0];
}
function setOpt(defId, key, v){
  try { localStorage.setItem("sa_opt_" + defId + "_" + key, v); } catch(e){}
}

var AC = null;
function sfx(freq, dur, type, vol, slide){
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    var t0 = AC.currentTime;
    var o = AC.createOscillator();
    var g = AC.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol || 0.12, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(AC.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  } catch(e){}
}

function mat(color, rough){
  return new THREE.MeshStandardMaterial({ color: color, roughness: rough === undefined ? 0.85 : rough, metalness: 0 });
}
function box(w, h, d, color, rough){
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, rough));
  m.castShadow = true;
  return m;
}
function ball(r, color, rough){
  var m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), mat(color, rough));
  m.castShadow = true;
  return m;
}
function cyl(rt, rb, h, color, rough){
  var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 14), mat(color, rough));
  m.castShadow = true;
  return m;
}
function newScene(sky, fogNear, fogFar){
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, fogNear, fogFar);
  var hemi = new THREE.HemisphereLight(0xffffff, 0x33415a, 0.85);
  scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(18, 36, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 130;
  scene.add(sun);
  scene.userData.sun = sun;
  return scene;
}
function ground(scene, size, color){
  var g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat(color, 1));
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  scene.add(g);
  return g;
}

var E = {
  scene: null, cam: null, game: null, id: null, def: null,
  running: false, score: 0, fmt: fmtInt, lowerBetter: false,
  keys: {}, stick: { x: 0, y: 0 }, stickOn: false,
  mp: null, mpStates: {}, seed: 0, rand: Math.random
};

var canvas = $("c");
var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;

function resize(){
  var w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  if (E.cam){
    E.cam.aspect = w / h;
    E.cam.updateProjectionMatrix();
  }
}
window.addEventListener("resize", resize);

E.setScore = function(v){
  E.score = v;
  $("hudScore").textContent = E.fmt(v);
};
E.addScore = function(d){ E.setScore(E.score + d); };
E.setInfo = function(t){ $("hudInfo").textContent = t || ""; };
E.message = function(t){
  var m = $("hudMsg");
  m.textContent = t;
  m.classList.remove("pop");
  void m.offsetWidth;
  m.classList.add("pop");
};
E.power = function(p){
  var w = $("powerWrap");
  if (p === null || p === undefined){ w.style.display = "none"; return; }
  w.style.display = "block";
  $("powerBar").style.width = Math.round(clamp(p, 0, 1) * 100) + "%";
};
E.gameOver = function(score){
  if (!E.running) return;
  E.running = false;
  E.power(null);
  saveBest(E.id, score);
  var b = getBest(E.id);
  sfx(score === b ? 880 : 200, 0.45, "square", 0.12, score === b ? 300 : -80);
  $("ovTitle").textContent = E.def.over || "Run over";
  $("ovText").textContent = "";
  $("ovKeys").innerHTML = "";
  $("ovOpts").innerHTML = "";
  $("ovBig").style.display = "block";
  $("ovBig").textContent = E.fmt(score);
  $("ovBest").textContent = score === b ? "New best score!" : "Best: " + E.fmt(b);
  $("ovPlay").textContent = "Play again";
  SA.ovAction = play;
  $("overlay").classList.remove("hidden");
};

function disposeScene(){
  if (!E.scene) return;
  E.scene.traverse(function(o){
    if (o.geometry) o.geometry.dispose();
    if (o.material){
      if (Array.isArray(o.material)) o.material.forEach(function(m){ m.dispose(); });
      else o.material.dispose();
    }
  });
  E.scene = null;
  E.cam = null;
  E.game = null;
}

function createNow(run){
  disposeScene();
  E.cam = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 600);
  E.game = E.def.create(E, run);
  resize();
}

SA.startGame = function(id, run){
  run = run || {};
  var g = SA.games[id];
  if (!g) return;
  E.id = id;
  E.def = g;
  E.fmt = g.fmt;
  E.lowerBetter = !!g.lowerBetter;
  E.running = false;
  E.score = 0;
  E.keys = {};
  E.stickOn = false;
  E.stick = { x: 0, y: 0 };
  E.mpStates = {};
  E.mp = run.mp || null;
  E.seed = run.seed === undefined ? (Math.random() * 899999999 + 1e8) | 0 : run.seed;
  E.rand = rng(E.seed);
  run.opts = run.opts || {};
  E.run = run;
  $("hub").style.display = "none";
  $("game").style.display = "block";
  $("hudName").textContent = g.name;
  $("hudScore").textContent = g.fmt(0);
  $("hudInfo").textContent = "";
  var b = getBest(id);
  $("hudBest").textContent = b === null ? "" : "Best: " + g.fmt(b);
  createNow(run);
  setupTouchUI(g);
  SA.ovAction = play;
  if (E.mp) playMp();
  else showStart();
};

function playMp(){
  if (E.game.reset) E.game.reset();
  E.setScore(0);
  $("overlay").classList.add("hidden");
  $("lobby").classList.add("hidden");
  E.running = true;
}

function optsHtml(def, dest){
  var html = "";
  (def.opts || []).forEach(function(o){
    var cur = getOpt(def.id, o.key, o.choices);
    html += '<div class="selrow"><label>' + o.label + '</label><select id="ovSel_' + o.key.replace(/[^a-z0-9]/gi, "") + '" class="sel">';
    o.choices.forEach(function(c){
      html += '<option value="' + c + '"' + (c === cur ? " selected" : "") + '>' + c + '</option>';
    });
    html += '</select></div>';
  });
  dest.innerHTML = html;
}
function readOpts(def){
  var o = {};
  (def.opts || []).forEach(function(opt){
    var sel = $("ovSel_" + opt.key.replace(/[^a-z0-9]/gi, ""));
    var v = sel ? sel.value : getOpt(def.id, opt.key, opt.choices);
    setOpt(def.id, opt.key, v);
    o[opt.key] = v;
  });
  return o;
}

function showStart(){
  var g = E.def;
  $("ovTitle").textContent = g.name;
  $("ovText").textContent = g.how || "";
  $("ovKeys").innerHTML = (g.keys || []).map(function(k){ return '<span class="kbd">' + k + '</span>'; }).join("");
  optsHtml(g, $("ovOpts"));
  $("ovBig").style.display = "none";
  var b = getBest(E.id);
  $("ovBest").textContent = b === null ? "No best score yet" : "Best: " + g.fmt(b);
  $("ovPlay").textContent = "Play";
  $("overlay").classList.remove("hidden");
}

function play(){
  if (!E.game || E.running) return;
  if (!E.mp){
    E.run.opts = readOpts(E.def);
    createNow(E.run);
  }
  $("overlay").classList.add("hidden");
  if (E.game.reset) E.game.reset();
  E.setScore(0);
  E.running = true;
  sfx(660, 0.12, "square", 0.1);
}
SA.play = play;

function backToMenu(){
  E.running = false;
  if (NET.inRoom){
    disposeScene();
    $("game").style.display = "none";
    $("hub").style.display = "block";
    window.scrollTo(0, 0);
    renderHub();
    if (SA.showRoom) SA.showRoom();
    return;
  }
  disposeScene();
  $("lobby").classList.add("hidden");
  $("game").style.display = "none";
  $("hub").style.display = "block";
  window.scrollTo(0, 0);
  renderHub();
}

var isTouch = ("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0;
function setupTouchUI(g){
  var ui = $("touchUI");
  var want = isTouch && g.touch && (g.touch.stick || g.touch.act);
  ui.style.display = want ? "block" : "none";
  $("stickZone").style.display = want && g.touch.stick ? "block" : "none";
  $("actBtn").style.display = want && g.touch.act ? "block" : "none";
  if (want && g.touch.act) $("actBtn").textContent = g.touch.act;
}

var ICO = {
  ski: '<svg viewBox="0 0 24 24" fill="none" stroke="#2dd4a8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18l6-11 4 7 3-5 5 9"/><circle cx="18" cy="4" r="2" fill="#ffb02e" stroke="none"/></svg>',
  surf: '<svg viewBox="0 0 24 24" fill="none" stroke="#2dd4a8" stroke-width="2" stroke-linecap="round"><path d="M2 16c3-6 7-6 10 0s7 6 10 0"/><path d="M6 10c2-3 5-4 8-3"/></svg>',
  ball: '<svg viewBox="0 0 24 24" fill="none" stroke="#2dd4a8" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/><path d="M5.6 5.6c3.5 2 9.3 2 12.8 0M5.6 18.4c3.5-2 9.3-2 12.8 0"/></svg>',
  hoop: '<svg viewBox="0 0 24 24" fill="none" stroke="#2dd4a8" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M6 6l12 12M18 6L6 18"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="#2dd4a8" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  racket: '<svg viewBox="0 0 24 24" fill="none" stroke="#2dd4a8" stroke-width="2"><circle cx="10" cy="10" r="6"/><path d="M14.5 14.5L21 21"/><circle cx="19" cy="6" r="2.5" fill="#ffb02e" stroke="none"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="#2dd4a8" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="#ffb02e" stroke="none"/></svg>',
  wave: '<svg viewBox="0 0 24 24" fill="none" stroke="#2dd4a8" stroke-width="2" stroke-linecap="round"><path d="M2 16c3-6 7-6 10 0s7 6 10 0"/><path d="M6 10c2-3 5-4 8-3"/></svg>'
};

var SOON = ["Tennis: rally vs AI or a friend", "Archery: wind and moving rings", "Penalties 2: shoot and goalkeep turns", "Hurdles: top-down races and Crazy Race"];

function renderHub(){
  var live = $("liveGrid"), soon = $("soonGrid");
  live.innerHTML = "";
  soon.innerHTML = "";
  Object.keys(SA.games).forEach(function(id){
    var g = SA.games[id];
    if (g.comingSoon) return;
    var card = document.createElement("div");
    card.className = "card";
    var html = '<div class="icone">' + g.icon + '</div><h3>' + g.name + '</h3><p>' + g.tag + '</p>';
    var b = getBest(id);
    if (b !== null) html += '<div class="bestchip">Best: ' + g.fmt(b) + '</div>';
    if (g.mp) html += '<div class="bestchip" style="color:var(--accent2);background:rgba(255,176,46,0.1);border-color:rgba(255,176,46,0.3)">Online</div>';
    card.innerHTML = html;
    card.addEventListener("click", function(){ SA.startGame(id); });
    live.appendChild(card);
  });
  SOON.forEach(function(t){
    var card = document.createElement("div");
    card.className = "card locked";
    card.innerHTML = '<div class="icone">' + ICO.wave + '</div><h3>' + t.split(":")[0] + '</h3><p>' + (t.split(":")[1] || "") + '</p><div class="soon">Soon</div>';
    soon.appendChild(card);
  });
  var on = typeof Peer !== "undefined";
  $("createBtn").disabled = !on;
  $("joinBtn").disabled = !on;
}
SA.renderHub = renderHub;
SA.showStart = showStart;

window.addEventListener("keydown", function(e){
  if (!E.game) return;
  var c = e.code;
  if (c === "ArrowLeft" || c === "ArrowRight" || c === "ArrowUp" || c === "ArrowDown" || c === "Space") e.preventDefault();
  if (!$("overlay").classList.contains("hidden")){
    if ((c === "Space" || c === "Enter") && SA.ovAction === play) play();
    return;
  }
  if (!E.running) return;
  if (!E.keys[c]){
    E.keys[c] = true;
    if (!e.repeat && E.game.onKey) E.game.onKey(c, true);
  }
});
window.addEventListener("keyup", function(e){
  if (!E.game) return;
  E.keys[e.code] = false;
  if (E.running && E.game.onKey) E.game.onKey(e.code, false);
});

var stickZone = $("stickZone"), stickKnob = $("stickKnob");
var lastTouch = 0;
function stickPoint(e){
  var t = e.touches ? e.touches[0] : e;
  return [t.clientX, t.clientY];
}
function stickDown(x, y){
  lastTouch = Date.now();
  E.stickOn = true;
  stickMove(x, y);
}
function stickMove(x, y){
  lastTouch = Date.now();
  if (!E.stickOn) return;
  var r = stickZone.getBoundingClientRect();
  var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  var R = r.width / 2 - 6;
  var dx = x - cx, dy = y - cy;
  var d = Math.sqrt(dx * dx + dy * dy);
  if (d > R){ dx *= R / d; dy *= R / d; }
  stickKnob.style.transform = "translate(" + Math.round(dx) + "px," + Math.round(dy) + "px)";
  E.stick.x = dx / R;
  E.stick.y = -dy / R;
}
function stickUp(){
  E.stickOn = false;
  E.stick.x = 0;
  E.stick.y = 0;
  stickKnob.style.transform = "translate(0px,0px)";
}
stickZone.addEventListener("touchstart", function(e){ e.preventDefault(); stickDown.apply(null, stickPoint(e)); }, { passive: false });
stickZone.addEventListener("touchmove", function(e){ e.preventDefault(); stickMove.apply(null, stickPoint(e)); }, { passive: false });
stickZone.addEventListener("touchend", function(){ stickUp(); });
stickZone.addEventListener("touchcancel", function(){ stickUp(); });
stickZone.addEventListener("mousedown", function(e){ if (Date.now() - lastTouch > 800) stickDown(e.clientX, e.clientY); });
window.addEventListener("mousemove", function(e){ if (E.stickOn && Date.now() - lastTouch > 800) stickMove(e.clientX, e.clientY); });
window.addEventListener("mouseup", function(){ if (E.stickOn && Date.now() - lastTouch > 800) stickUp(); });

var actBtn = $("actBtn");
function actPress(down, ev){
  ev.preventDefault();
  lastTouch = Date.now();
  if (down && !E.keys.Space){
    E.keys.Space = true;
    if (E.running && E.game && E.game.onKey) E.game.onKey("Space", true);
  } else if (!down && E.keys.Space){
    E.keys.Space = false;
    if (E.running && E.game && E.game.onKey) E.game.onKey("Space", false);
  }
}
actBtn.addEventListener("touchstart", function(e){ actPress(true, e); }, { passive: false });
actBtn.addEventListener("touchend", function(e){ actPress(false, e); });
actBtn.addEventListener("touchcancel", function(e){ actPress(false, e); });
actBtn.addEventListener("mousedown", function(e){ if (Date.now() - lastTouch > 800) actPress(true, e); });
actBtn.addEventListener("mouseup", function(e){ if (Date.now() - lastTouch > 800) actPress(false, e); });

$("ovPlay").addEventListener("click", function(){
  if (typeof SA.ovAction === "function") SA.ovAction();
});
$("ovMenu").addEventListener("click", function(){
  backToMenu();
});

$("exitBtn").addEventListener("click", function(){
  if (NET.inRoom && E.running){
    E.running = false;
    NET.leave();
  }
  backToMenu();
});

var lastT = 0;
function loop(t){
  requestAnimationFrame(loop);
  var dt = Math.min((t - lastT) / 1000, 0.05);
  lastT = t;
  if (E.running && E.game){
    var jx = E.stickOn ? E.stick.x : 0, jy = E.stickOn ? E.stick.y : 0;
    var kx = (E.keys.ArrowLeft ? -1 : 0) + (E.keys.ArrowRight ? 1 : 0);
    var ky = (E.keys.ArrowDown ? -1 : 0) + (E.keys.ArrowUp ? 1 : 0);
    E.stick.x = clamp(jx + kx, -1, 1);
    E.stick.y = clamp(jy + ky, -1, 1);
    if (E.game.update){
      try { E.game.update(dt); } catch(e){ console.error("Update error:", e); }
    }
  }
  if (E.scene && E.cam) renderer.render(E.scene, E.cam);
}

SA.games = {};
SA.register = function(def){
  SA.games[def.id] = def;
  if (typeof renderHub === "function") renderHub();
};
SA.E = E;
SA.fmtInt = fmtInt;
SA.fmtTime = fmtTime;
SA.rand = rand;
SA.clamp = clamp;
SA.rng = rng;
SA.sfx = sfx;
SA.mat = mat;
SA.box = box;
SA.ball = ball;
SA.cyl = cyl;
SA.newScene = newScene;
SA.ground = ground;
SA.getBest = getBest;
SA.saveBest = saveBest;
SA.getOpt = getOpt;
SA.setOpt = setOpt;
SA.$ = $;
SA.dispose = disposeScene;
SA.overlay = {
  hide: function(){ $("overlay").classList.add("hidden"); },
  show: function(){ $("overlay").classList.remove("hidden"); }
};

if (typeof THREE === "undefined"){
  $("liveGrid").innerHTML = '<div class="card"><h3>3D library did not load</h3><p>Check the internet connection and refresh the page.</p></div>';
} else {
  renderHub();
  resize();
  requestAnimationFrame(loop);
}
})();
