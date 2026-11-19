"use strict";
(function(){
var $ = function(id){ return document.getElementById(id); };
function code5(){
  var A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  var s = "";
  for (var i = 0; i < 5; i++) s += A.charAt(Math.floor(Math.random() * A.length));
  return s;
}
function pid(){ return "sportiverse-" + NET.code; }
function send(c, m){ try { c.send(m); } catch(e){} }
function describe(e){ return "Connection problem: " + (e && e.type ? e.type : "unknown"); }

var NET = {
  ok: false, peer: null, conns: {}, hostConn: null,
  isHost: false, inRoom: false, phase: "idle",
  me: 0, code: "", players: [], st: {}, fins: {}, nextId: 1,
  firstFinT: 0, timer: null, started: false,
  onRoster: function(){}, onResults: function(){}, onRoom: function(){}, onLost: function(){}
};
window.NET = NET;
SA.net = NET;
if (typeof Peer !== "undefined") NET.ok = true;

NET.host = function(name, ok, fail){
  NET.isHost = true;
  NET.code = code5();
  NET.nextId = 1;
  NET.me = 0;
  NET.players = [{ id: 0, name: name, color: "#2dd4a8", host: true }];
  NET.st = {};
  NET.fins = {};
  NET.firstFinT = 0;
  NET.started = false;
  NET.peer = new Peer(pid(), { debug: 0 });
  NET.peer.on("open", function(){
    NET.inRoom = true;
    NET.phase = "lobby";
    if (!NET.timer) NET.timer = setInterval(tick, 220);
    ok(NET.code);
  });
  NET.peer.on("error", function(e){
    if (!NET.inRoom) fail(e.type === "unavailable-id" ? "Room code taken, try again" : describe(e));
  });
  NET.peer.on("connection", function(c){
    c.on("data", function(d){ hostData(c, d); });
    c.on("close", function(){ hostDrop(c); });
    c.on("error", function(){ hostDrop(c); });
  });
};

NET.join = function(code, name, ok, fail){
  NET.isHost = false;
  NET.code = String(code || "").toUpperCase();
  NET.peer = new Peer({ debug: 0 });
  NET.peer.on("open", function(){
    var c = NET.peer.connect(pid(), { reliable: true });
    NET.hostConn = c;
    c.on("open", function(){
      NET.inRoom = true;
      send(c, { t: "hi", name: name });
      ok();
    });
    c.on("data", clientData);
    c.on("close", function(){ lost(); });
    c.on("error", function(){ lost(); });
  });
  NET.peer.on("error", function(e){
    if (e.type === "peer-unavailable") fail("Room " + NET.code + " not found. Check the code.");
    else if (!NET.inRoom) fail(describe(e));
  });
};

function lost(){
  if (!NET.inRoom) return;
  NET.inRoom = false;
  NET.phase = "idle";
  NET.onLost();
}

function rosterAll(){
  NET.players.forEach(function(p){
    var c = NET.conns[p.id];
    if (c) send(c, { t: "roster", players: NET.players, me: p.id });
  });
  NET.onRoster(NET.players, NET.me, NET.isHost);
}

function hostData(c, d){
  if (!d || typeof d !== "object") return;
  if (d.t === "hi"){
    if (NET.players.length >= 10){
      send(c, { t: "full" });
      return;
    }
    var id = NET.nextId++;
    c._pid = id;
    NET.conns[id] = c;
    NET.players.push({ id: id, name: String(d.name || "Player").slice(0, 12), color: SA_RCOLORS[NET.players.length % SA_RCOLORS.length] });
    NET.st[id] = null;
    rosterAll();
  } else if (d.t === "st"){
    if (c._pid === undefined) return;
    NET.st[c._pid] = d.d;
  } else if (d.t === "fin"){
    if (c._pid === undefined) return;
    NET.fins[c._pid] = { score: d.score, time: d.time };
    if (NET.st[c._pid]) NET.st[c._pid][4] = 1;
    if (!NET.firstFinT) NET.firstFinT = Date.now();
    checkResults();
  }
}

var SA_RCOLORS = ["#2dd4a8", "#ffb02e", "#ff5c5c", "#3aa0ff", "#b07cff", "#ffe14c", "#7cff9e", "#ff8ad8", "#9ad0ff", "#ffab4a"];

function hostDrop(c){
  if (c._pid === undefined) return;
  var id = c._pid;
  delete NET.conns[id];
  delete NET.st[id];
  delete NET.fins[id];
  for (var i = 0; i < NET.players.length; i++){
    if (NET.players[i].id === id){
      NET.players.splice(i, 1);
      break;
    }
  }
  if (NET.phase === "lobby") rosterAll();
}

function tick(){
  if (!NET.inRoom || NET.phase !== "play") return;
  var agg = {};
  for (var k in NET.st){
    if (NET.st[k]) agg[k] = NET.st[k];
  }
  var msg = { t: "s", st: agg };
  for (var k2 in NET.conns) send(NET.conns[k2], msg);
  if (NET.isHost) SA.applyStates(agg);
  if (NET.isHost && NET.firstFinT) checkResults();
}

function broadcast(m){
  for (var k in NET.conns) send(NET.conns[k], m);
}

function checkResults(){
  if (NET.phase !== "play") return;
  var allDone = NET.players.every(function(p){
    return NET.st[p.id] && NET.st[p.id][4];
  });
  var timeout = NET.firstFinT && Date.now() - NET.firstFinT > 45000;
  if (!allDone && !timeout) return;
  finishResults();
}

function finishResults(){
  var rows = NET.players.map(function(p){
    var s = NET.st[p.id];
    var f = NET.fins[p.id];
    return {
      name: p.name,
      color: p.color,
      me: p.id === NET.me,
      score: s ? s[3] : 0,
      time: f ? f.time : null
    };
  });
  rows.sort(function(a, b){
    if (a.time !== null && b.time !== null) return a.time - b.time;
    if (a.time !== null) return -1;
    if (b.time !== null) return 1;
    return b.score - a.score;
  });
  NET.phase = "results";
  broadcast({ t: "res", rows: rows });
  NET.onResults(rows);
}

NET.start = function(game, opts){
  var msg = { t: "start", game: game, opts: opts, seed: (Math.random() * 899999999 + 1e8) | 0, players: NET.players };
  NET.phase = "play";
  NET.st = {};
  NET.fins = {};
  NET.firstFinT = 0;
  broadcast(msg);
  SA.startRemote(msg);
};

NET.toRoom = function(){
  NET.phase = "lobby";
  broadcast({ t: "room" });
  NET.onRoom();
};

NET.pushState = function(d){
  if (!NET.inRoom || NET.phase !== "play") return;
  if (NET.isHost) NET.st[NET.me] = d;
  else if (NET.hostConn) send(NET.hostConn, { t: "st", d: d });
};

NET.finish = function(score, time){
  if (!NET.inRoom) return;
  if (NET.isHost){
    NET.st[NET.me] = [0, 0, 0, score, 1];
    NET.fins[NET.me] = { score: score, time: time };
    if (!NET.firstFinT) NET.firstFinT = Date.now();
    checkResults();
  } else if (NET.hostConn){
    send(NET.hostConn, { t: "fin", score: score, time: time });
  }
};

NET.leave = function(){
  if (NET.timer){ clearInterval(NET.timer); NET.timer = null; }
  if (NET.peer){ try { NET.peer.destroy(); } catch(e){} }
  NET.peer = null;
  NET.conns = {};
  NET.hostConn = null;
  NET.inRoom = false;
  NET.phase = "idle";
  NET.players = [];
};

function clientData(d){
  if (!d || typeof d !== "object") return;
  if (d.t === "roster"){
    NET.players = d.players;
    NET.me = d.me;
    NET.onRoster(d.players, d.me, false);
  } else if (d.t === "start"){
    NET.phase = "play";
    SA.startRemote(d);
  } else if (d.t === "s"){
    SA.applyStates(d.st);
  } else if (d.t === "res"){
    NET.phase = "results";
    NET.onResults(d.rows);
  } else if (d.t === "room"){
    NET.phase = "lobby";
    NET.onRoom();
  } else if (d.t === "full"){
    NET.leave();
    NET.onLost("Room is full (10 players max).");
  }
}

SA.startRemote = function(m){
  var mp = { players: m.players, me: NET.me, host: NET.isHost };
  SA.startGame(m.game, { opts: m.opts, seed: m.seed, mp: mp });
};
SA.applyStates = function(st){
  SA.E.mpStates = st || {};
};

// ---------- Room lobby UI ----------

function esc(s){
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function lobbyErr(s){ $("lbErr").textContent = s || ""; }

function openLobby(joinMode){
  lobbyErr("");
  $("lbStep1").style.display = "block";
  $("lbStep2").style.display = "none";
  $("lbCodeRow").style.display = joinMode ? "flex" : "none";
  try { $("lbName").value = localStorage.getItem("sa_name") || ""; } catch(e){}
  $("lbCodeIn").value = "";
  $("lobby").classList.remove("hidden");
}

function showRoom(){
  if (!NET.inRoom) return;
  $("overlay").classList.add("hidden");
  $("lbStep1").style.display = "none";
  $("lbStep2").style.display = "block";
  $("lbTitle").textContent = "Room " + NET.code;
  $("lbCode").textContent = NET.code;
  var rows = "";
  NET.players.forEach(function(p){
    rows += '<div class="prow"><span class="dot" style="background:' + p.color + '"></span><span>' + esc(p.name) + '</span>' +
      (p.id === 0 ? '<span class="htag">HOST</span>' : '') + '</div>';
  });
  $("lbPlayers").innerHTML = rows;
  $("lbHostTools").style.display = NET.isHost ? "block" : "none";
  $("lbWait").style.display = NET.isHost ? "none" : "block";
  if (NET.isHost){
    fillLbGames();
    fillLbOpts();
  }
  $("lobby").classList.remove("hidden");
}
SA.showRoom = showRoom;

function mpGames(){
  var out = [];
  for (var k in SA.games){ if (SA.games[k].mp) out.push(SA.games[k]); }
  return out;
}
function lbDef(){ return SA.games[$("lbGame").value]; }

function fillLbGames(){
  var sel = $("lbGame");
  if (sel.options.length) return;
  mpGames().forEach(function(g){
    var o = document.createElement("option");
    o.value = g.id;
    o.textContent = g.name;
    sel.appendChild(o);
  });
}
function optKey(k){ return k.replace(/[^a-z0-9]/gi, ""); }
function fillLbOpts(){
  var def = lbDef();
  if (!def){ $("lbOpts").innerHTML = ""; return; }
  var html = "";
  (def.opts || []).forEach(function(o){
    var cur = SA.getOpt(def.id, o.key, o.choices);
    html += '<div class="selrow"><label>' + esc(o.label) + '</label><select id="lbSel_' + optKey(o.key) + '" class="sel">';
    o.choices.forEach(function(c){
      html += '<option value="' + esc(c) + '"' + (c === cur ? " selected" : "") + '>' + esc(c) + '</option>';
    });
    html += '</select></div>';
  });
  $("lbOpts").innerHTML = html;
}
function readLbOpts(def){
  var o = {};
  (def.opts || []).forEach(function(opt){
    var s = $("lbSel_" + optKey(opt.key));
    var v = s ? s.value : SA.getOpt(def.id, opt.key, opt.choices);
    SA.setOpt(def.id, opt.key, v);
    o[opt.key] = v;
  });
  return o;
}

$("createBtn").addEventListener("click", function(){
  if (!NET.ok){ lobbyErr("Multiplayer library did not load. Refresh the page."); return; }
  openLobby(false);
});
$("joinBtn").addEventListener("click", function(){
  if (!NET.ok){ lobbyErr("Multiplayer library did not load. Refresh the page."); return; }
  openLobby(true);
});
$("lbCancel").addEventListener("click", function(){
  if (!NET.inRoom) NET.leave();
  $("lobby").classList.add("hidden");
  lobbyErr("");
});
$("lbGo").addEventListener("click", function(){
  lobbyErr("");
  var name = ($("lbName").value || "").trim().slice(0, 12) || "Player";
  try { localStorage.setItem("sa_name", name); } catch(e){}
  if ($("lbCodeRow").style.display !== "none"){
    var code = ($("lbCodeIn").value || "").trim().toUpperCase();
    if (code.length !== 5){ lobbyErr("Room codes have 5 characters."); return; }
    NET.join(code, name, showRoom, lobbyErr);
  } else {
    NET.host(name, showRoom, lobbyErr);
  }
});
$("lbGame").addEventListener("change", fillLbOpts);
$("lbStart").addEventListener("click", function(){
  var def = lbDef();
  if (!def) return;
  NET.start(def.id, readLbOpts(def));
});
$("lbLeave").addEventListener("click", function(){
  NET.leave();
  $("lobby").classList.add("hidden");
  window.scrollTo(0, 0);
  SA.renderHub();
});

NET.onRoster = function(){ showRoom(); };
NET.onRoom = function(){ showRoom(); };
NET.onResults = function(rows){
  $("ovTitle").textContent = "Results";
  $("ovText").textContent = "";
  $("ovKeys").innerHTML = "";
  $("ovOpts").innerHTML = "";
  $("ovBig").style.display = "none";
  var fmt = (SA.E && SA.E.def && SA.E.def.fmt) ? SA.E.def.fmt : function(v){ return String(v); };
  var html = "";
  rows.forEach(function(r, i){
    var v = (r.time !== null && r.time !== undefined) ? SA.fmtTime(r.time) : fmt(r.score);
    html += '<div class="prow"><span>' + (i + 1) + '.</span><span class="dot" style="background:' + r.color + '"></span><span>' + esc(r.name) + (r.me ? " (you)" : "") + '</span><span class="htag">' + esc(v) + '</span></div>';
  });
  $("ovBest").textContent = "";
  $("ovPlay").textContent = "Back to room";
  if (NET.isHost) SA.ovAction = function(){ NET.toRoom(); };
  else SA.ovAction = function(){ showRoom(); };
  $("overlay").classList.remove("hidden");
};
NET.onLost = function(msg){
  NET.leave();
  SA.dispose();
  $("overlay").classList.add("hidden");
  $("game").style.display = "none";
  $("hub").style.display = "block";
  window.scrollTo(0, 0);
  SA.renderHub();
  openLobby(false);
  lobbyErr(msg || "Disconnected from the room.");
};
})();
