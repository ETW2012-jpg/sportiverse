"use strict";
(function(){
var SA = window.SA;
var DIFFS = {
  Green: { cap: 26, base: 13, grade: 0.008, gap: 4.2, sMin: 26, sMax: 34, trees: 0.55, len: 1100 },
  Blue:  { cap: 33, base: 16, grade: 0.010, gap: 3.7, sMin: 24, sMax: 32, trees: 0.9, len: 1400 },
  Black: { cap: 40, base: 19, grade: 0.012, gap: 3.2, sMin: 22, sMax: 30, trees: 1.35, len: 1700 }
};
var MAPS = {
  "Sun Peaks":  { sky: 0xbfe0f5, fogN: 30, fogF: 210, snow: 0xf2f7fc, tree: 0x2f7d4f, rock: 0x9aa5b1, night: false, mountains: true },
  "Night Run":  { sky: 0x0b1026, fogN: 18, fogF: 120, snow: 0x9fb0d0, tree: 0x1d3b2f, rock: 0x4d5670, night: true, mountains: false },
  "Fog Forest": { sky: 0xc3ccd6, fogN: 10, fogF: 70, snow: 0xe6ecf2, tree: 0x25654a, rock: 0x8b95a3, night: false, mountains: false }
};

function buildSlide(E, cfg){
  var map = cfg.map, diff = cfg.diff;
  var scene = SA.newScene(map.sky, map.fogN, map.fogF);
  E.scene = scene;
  SA.ground(scene, 700, map.snow);
  if (map.night){
    scene.children[0].intensity = 0.45;
    scene.children[1].intensity = 0.55;
  }
  var mi;
  if (map.mountains){
    for (mi = 0; mi < 8; mi++){
      var mt = new THREE.Mesh(new THREE.ConeGeometry(SA.rand(14, 30), SA.rand(18, 42), 6), SA.mat(0xd7e6f2, 1));
      mt.position.set(SA.rand(-170, 170), 0, -160 - SA.rand(0, 60));
      scene.add(mt);
    }
  }

  var player = new THREE.Group();
  var skiL = SA.box(0.28, 0.08, 1.9, cfg.ski || 0xff5c5c, 0.6); skiL.position.set(-0.22, 0.05, 0);
  var skiR = SA.box(0.28, 0.08, 1.9, cfg.ski || 0xff5c5c, 0.6); skiR.position.set(0.22, 0.05, 0);
  var body = SA.cyl(0.24, 0.3, 1.0, cfg.body || 0x2dd4a8); body.position.y = 0.95;
  var head = SA.ball(0.22, 0x1c2440, 0.5); head.position.y = 1.72;
  player.add(skiL, skiR, body, head);
  scene.add(player);

  var N = 70;
  var sGeo = new THREE.BufferGeometry();
  var sPos = new Float32Array(N * 3);
  var sVel = new Float32Array(N * 3);
  sGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
  var spray = new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, opacity: 0.8 }));
  scene.add(spray);
  var sj;
  for (sj = 0; sj < N; sj++){ sPos[sj * 3 + 1] = -10; }

  var dist = 0, px = 0, vx = 0, y = 0, vy = 0, speed = diff.base;
  var air = false, airT = 0, spinTotal = 0, spinVel = 0, grabT = 0;
  var score = 0, misses = 0, done = false, waiting = false, elapsed = 0;
  var pushT = 0, infoT = 0;

  var events = [], evIdx = 0, live = [], gateIdx = 0;

  function pool(make){ return { make: make, free: [] }; }

  var gateP = pool(function(){
    var g = new THREE.Group();
    var p1 = SA.cyl(0.05, 0.05, 1.7, 0xff5c5c, 0.6); p1.position.set(-3.5, 0.85, 0);
    var p2 = SA.cyl(0.05, 0.05, 1.7, 0xff5c5c, 0.6); p2.position.set(3.5, 0.85, 0);
    var f1 = SA.box(0.9, 0.5, 0.03, 0xff5c5c, 0.6); f1.position.set(-3.1, 1.55, 0);
    var f2 = SA.box(0.9, 0.5, 0.03, 0xff5c5c, 0.6); f2.position.set(3.1, 1.55, 0);
    g.add(p1, p2, f1, f2);
    g.userData.parts = [p1, p2, f1, f2];
    return g;
  });
  var treeP = pool(function(){
    var g = new THREE.Group();
    var trunk = SA.cyl(0.12, 0.16, 0.7, 0x6b4a2f, 1); trunk.position.y = 0.35;
    var cone = new THREE.Mesh(new THREE.ConeGeometry(1.05, 2.6, 7), SA.mat(map.tree, 1));
    cone.position.y = 1.9;
    cone.castShadow = true;
    g.add(trunk, cone);
    return g;
  });
  var rockP = pool(function(){
    var g = new THREE.Group();
    var r = SA.ball(0.8, map.rock, 1);
    r.position.y = 0.4;
    g.add(r);
    return g;
  });
  var kickP = pool(function(){
    var g = new THREE.Group();
    var k = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.24, 3.4), SA.mat(0xffb02e, 0.5));
    k.rotation.x = -0.24;
    k.position.y = 0.22;
    k.castShadow = true;
    g.add(k);
    return g;
  });
  var lampP = pool(function(){
    var g = new THREE.Group();
    var p = SA.cyl(0.05, 0.05, 3.4, 0x2a3350, 0.5); p.position.y = 1.7;
    var gl = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    gl.position.y = 3.5;
    g.add(p, gl);
    return g;
  });

  function genCourse(){
    events = [];
    evIdx = 0;
    live = [];
    gateIdx = 0;
    var r = E.rand;
    var d = 60;
    var lastX = 0;
    while (d < diff.len){
      lastX = SA.clamp(lastX + (r() - 0.5) * 16, -11, 11);
      events.push({ t: "g", d: d, x: lastX, c: gateIdx % 2 === 0 ? 0xff5c5c : 0x3aa0ff });
      gateIdx++;
      var until = d + diff.sMin + r() * (diff.sMax - diff.sMin);
      if (r() < 0.3){
        var kx = SA.clamp(lastX + (r() - 0.5) * 12, -13, 13);
        if (Math.abs(kx - lastX) > 5.5) events.push({ t: "k", d: d + (until - d) * 0.4, x: kx });
      }
      var cl = Math.floor(diff.trees * 3 * r());
      for (var q = 0; q < cl; q++){
        var side = r() < 0.5 ? -1 : 1;
        var tx = side * (r() < 0.55 ? 8 + r() * 12 : 24 + r() * 26);
        var td = d + r() * (until - d);
        if (!(Math.abs(tx - lastX) < 6.5 && Math.abs(td - d) < 9)){
          events.push({ t: "t", d: td, x: tx, s: 0.8 + r() * 0.7, rock: r() < 0.3 });
        }
      }
      if (map.night){
        events.push({ t: "l", d: d + 6, x: -26 });
        events.push({ t: "l", d: d + 6, x: 26 });
      }
      d = until;
    }
  }

  function spawnUpTo(){
    while (evIdx < events.length && events[evIdx].d - dist < 175){
      var ev = events[evIdx++];
      var p2l = ev.t === "g" ? gateP : ev.t === "k" ? kickP : ev.t === "t" ? (ev.rock ? rockP : treeP) : lampP;
      var g = p2l.free.pop() || p2l.make();
      if (ev.t === "t") g.scale.setScalar(ev.s);
      if (ev.t === "g"){
        g.userData.parts.forEach(function(part){ part.material.color.setHex(ev.c); });
      }
      g.position.set(ev.x, 0, ev.d - dist);
      scene.add(g);
      live.push({ ev: ev, g: g, pool: p2l });
    }
  }

  function objectsFrame(){
    var i, it, z;
    for (i = live.length - 1; i >= 0; i--){
      it = live[i];
      it.g.position.z = it.ev.d - dist;
      z = it.g.position.z;
      if (it.ev.t === "g" && !it.ev.done && z < -0.5 && !done){
        it.ev.done = true;
        if (Math.abs(px - it.ev.x) < diff.gap){
          score += 10;
          SA.sfx(720, 0.09, "square", 0.1);
        } else {
          misses++;
          SA.sfx(180, 0.25, "sawtooth", 0.12, -60);
          if (misses < 3) E.message("Missed gate " + misses + " of 3");
          else { stopRun("Three gates missed"); return; }
        }
      }
      if (it.ev.t === "k" && !it.ev.done && Math.abs(z) < 1.5 && Math.abs(px - it.ev.x) < 1.3 && y <= 0.01){
        it.ev.done = true;
        vy = 8.4;
        spinVel = 0;
        air = true;
        airT = 0;
        SA.sfx(200, 0.2, "square", 0.12, 120);
      }
      if (it.ev.t === "t" && !done && Math.abs(z) < 1.1 && y < 1.0 && Math.abs(px - it.ev.x) < 0.8 * it.ev.s + 0.5){
        stopRun("Crash!");
        return;
      }
      if (z > 15){
        scene.remove(it.g);
        it.pool.free.push(it.g);
        live.splice(i, 1);
      }
    }
  }

  var ghosts = {};
  if (E.mp){
    E.mp.players.forEach(function(p){
      if (p.id === E.mp.me) return;
      var g = new THREE.Group();
      var c = parseInt(p.color.slice(1), 16) || 0xffffff;
      var b = SA.cyl(0.3, 0.3, 1.1, c, 0.6); b.position.y = 0.9;
      var h = SA.ball(0.2, 0x1c2440, 0.5); h.position.y = 1.7;
      g.add(b, h);
      g.position.set(0, 0, -900);
      scene.add(g);
      ghosts[p.id] = g;
    });
  }

  function ghostsUp(){
    if (!E.mp) return;
    var st = E.mpStates;
    for (var id in ghosts){
      if (!ghosts.hasOwnProperty(id)) continue;
      var s = st[id];
      if (s) ghosts[id].position.set(s[1], s[2], SA.clamp(dist - s[0], -150, 8));
    }
  }

  function stopRun(reason){
    if (done) return;
    done = true;
    E.message(reason);
    SA.sfx(120, 0.5, "sawtooth", 0.16, -60);
    SA.saveBest(E.id, score);
    if (E.mp){
      waiting = true;
      SA.net.pushState([Math.round(dist), Math.round(px * 10) / 10, 0, score, 1]);
    } else {
      setTimeout(function(){ E.gameOver(score); }, 900);
    }
  }

  function reset(){
    var i;
    for (i = 0; i < live.length; i++){
      scene.remove(live[i].g);
      live[i].pool.free.push(live[i].g);
    }
    live = [];
    dist = 0; px = 0; vx = 0; y = 0; vy = 0; speed = diff.base;
    air = false; airT = 0; spinTotal = 0; spinVel = 0; grabT = 0;
    score = 0; misses = 0; done = false; waiting = false; elapsed = 0;
    player.position.set(0, 0, 0);
    player.rotation.set(0, 0, 0);
    genCourse();
    for (sj = 0; sj < N; sj++){ sPos[sj * 3 + 1] = -10; }
    E.setInfo("");
  }
  reset();

  function update(dt){
    if (waiting){
      ghostsUp();
      return;
    }
    if (done) return;
    elapsed += dt;
    speed = Math.min(diff.cap, diff.base + dist * diff.grade);
    var ax = E.stick.x;
    if (Math.abs(ax) < 0.08) ax = 0;
    var onG = y <= 0.001;
    if (onG){
      vy = 0;
      vx += ax * 42 * dt;
      vx *= Math.max(0, 1 - 3.0 * dt);
      px = SA.clamp(px + vx * dt, -26, 26);
      spinVel = 0;
    } else {
      airT += dt;
      vx += ax * 7 * dt;
      if (Math.abs(ax) > 0.15) spinVel += ax * 11 * dt;
      spinVel *= Math.max(0, 1 - 0.4 * dt);
      spinTotal += spinVel * dt;
      if (E.stick.y < -0.45) grabT += dt;
      vy -= 20 * dt;
      y += vy * dt;
      if (y <= 0.001) y = 0;
    }
    if (y <= 0.001 && air){
      y = 0;
      vy = 0;
      var r = spinTotal % (2 * Math.PI);
      if (r > Math.PI) r -= 2 * Math.PI;
      if (r < -Math.PI) r += 2 * Math.PI;
      var half = Math.floor(Math.abs(spinTotal) / Math.PI + 1e-6);
      var pts = half * 60 + Math.floor(grabT / 0.33) * 30;
      if (Math.abs(r) < 1.15){
        if (pts > 0){
          E.message(half >= 2 ? "Trick! +" + pts : "Trick +" + pts);
          score += pts;
          SA.sfx(800, 0.15, "square", 0.12, 200);
        }
      } else {
        stopRun("Bad landing!");
        return;
      }
      air = false;
      spinTotal = 0;
      spinVel = 0;
      grabT = 0;
      player.rotation.y = 0;
    }
    dist += speed * dt;
    player.position.x = px;
    player.position.y = y;
    player.rotation.z = SA.clamp(-vx * 0.05, -0.5, 0.5);
    if (air) player.rotation.y = spinTotal;
    player.rotation.x = air ? (grabT > 0 ? 0.5 : 0.12) : 0;
    spawnUpTo();
    objectsFrame();
    if (done || waiting) return;
    var i, k;
    for (i = 0; i < N; i++){
      k = i * 3;
      sVel[k + 1] -= 9.8 * dt;
      sPos[k] += sVel[k] * dt;
      sPos[k + 1] += sVel[k + 1] * dt;
      sPos[k + 2] += sVel[k + 2] * dt;
      if (sPos[k + 1] < 0){
        sPos[k] = px + SA.rand(-0.4, 0.4);
        sPos[k + 1] = 0.05;
        sPos[k + 2] = 0.8;
        sVel[k] = SA.rand(-1.5, 1.5) - vx * 0.4;
        sVel[k + 1] = SA.rand(1.5, 3.5);
        sVel[k + 2] = SA.rand(2, 5);
      }
    }
    sGeo.attributes.position.needsUpdate = true;
    pushT -= dt;
    if (E.mp && pushT <= 0){
      pushT = 0.2;
      SA.net.pushState([Math.round(dist), Math.round(px * 10) / 10, Math.round(y * 10) / 10, score, 0]);
    }
    infoT -= dt;
    if (infoT <= 0){
      infoT = 0.4;
      var kmh = Math.round(speed * 3.6);
      if (E.mp){
        var pos = 1, n = 1;
        var st = E.mpStates;
        for (var id in st){
          if (!st.hasOwnProperty(id) || id === String(E.mp.me)) continue;
          n++;
          if (st[id][0] > dist) pos++;
        }
        E.setInfo("Pos " + pos + " of " + n + " - " + kmh + " km/h");
      } else {
        E.setInfo(Math.floor(dist) + "m of " + diff.len + " - " + kmh + " km/h");
      }
    }
    if (dist >= diff.len){
      done = true;
      score += 150;
      E.message("Finish!");
      SA.sfx(700, 0.3, "square", 0.14, 250);
      SA.saveBest(E.id, score);
      E.setScore(score);
      if (E.mp){
        waiting = true;
        SA.net.pushState([Math.round(dist), Math.round(px * 10) / 10, 0, score, 1]);
        SA.net.finish(score, elapsed);
      } else {
        setTimeout(function(){ E.gameOver(score); }, 700);
      }
      return;
    }
    E.cam.position.set(px * 0.55, 5.2, 10.5);
    E.cam.fov = 62 + speed * 0.35;
    E.cam.updateProjectionMatrix();
    E.cam.lookAt(px * 0.7, 0.8, -14);
    scene.userData.sun.position.set(px + 18, 36, 14);
    E.setScore(score);
    ghostsUp();
  }

  function onKey(code, down){
    if (code === "Space" && down && y <= 0.001 && !done && !waiting){
      vy = 5.6;
      air = true;
      airT = 0;
      spinVel = 0;
      SA.sfx(300, 0.1, "square", 0.08, 120);
    }
  }

  return { update: update, reset: reset, onKey: onKey };
}

function createSki(E, run){
  var opts = run.opts || {};
  var mapName = MAPS[opts.map] ? opts.map : "Sun Peaks";
  var diff = DIFFS[opts.slope] || DIFFS.Green;
  return buildSlide(E, { map: MAPS[mapName], diff: diff, ski: 0xff5c5c, body: 0x2dd4a8 });
}

SA.slide = buildSlide;
SA.register({
  id: "ski",
  name: "Alpine Ski",
  tag: "Pick your mountain and slope, race friends, spin and grab in the air.",
  how: "Joystick to steer. JUMP for air, then flick the joystick for spins and pull it back for grabs - land straight or you crash. Pass gates for +10. Miss 3 gates, crash, or land badly and the run ends. Reach the finish line for +150.",
  keys: ["Joystick steer", "JUMP button"],
  touch: { stick: true, act: "JUMP" },
  fmt: SA.fmtInt,
  over: "Run over",
  mp: true,
  opts: [
    { key: "map", label: "Map", choices: ["Sun Peaks", "Night Run", "Fog Forest"] },
    { key: "slope", label: "Slope", choices: ["Green", "Blue", "Black"] }
  ],
  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="#2dd4a8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18l6-11 4 7 3-5 5 9"/><circle cx="18" cy="4" r="2" fill="#ffb02e" stroke="none"/></svg>',
  create: createSki
});
})();
