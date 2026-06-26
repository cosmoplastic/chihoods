/* VendorFlow chicago-neighborhoods v1.0
   Tap-the-map quiz engine for Chicago's 77 community areas.
   State machine: start screen -> rounds -> end screen. No build step, no backend. */
(function () {
  "use strict";

  var DATA = window.CHICAGO_COMMUNITY_AREAS;
  if (!DATA) { alert("Neighborhood data failed to load."); return; }

  // ----- polygon styling (kept in JS so we can setStyle on Leaflet paths) -----
  var STYLE = {
    base:    { fillColor: "#2a211c", color: "#6b574a", weight: 1,   fillOpacity: 0.82 },
    correct: { fillColor: "#16a34a", color: "#22c55e", weight: 2,   fillOpacity: 0.9  },
    wrong:   { fillColor: "#b91c1c", color: "#ef4444", weight: 2,   fillOpacity: 0.9  },
    reveal:  { fillColor: "#f97316", color: "#fb923c", weight: 2.5, fillOpacity: 0.92 }
  };

  // ----- DOM -----
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    map: $("map"), hud: $("hud"), controls: $("controls"),
    target: $("target"), progress: $("progress"), score: $("score"), streak: $("streak"),
    toast: $("toast"), hintBtn: $("hint-btn"), skipBtn: $("skip-btn"),
    startScreen: $("start-screen"), endScreen: $("end-screen"),
    regionSelect: $("region-select"), lengthSeg: $("length-seg"),
    startBtn: $("start-btn"), againBtn: $("again-btn"), bestLine: $("best-line"),
    rScore: $("r-score"), rAcc: $("r-acc"), rStreak: $("r-streak"),
    missedWrap: $("missed-wrap"), missedList: $("missed-list")
  };

  // ----- map setup -----
  var map = L.map("map", {
    zoomControl: true, attributionControl: true,
    zoomSnap: 0.25, minZoom: 9, maxZoom: 15
  });
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution("Boundaries: City of Chicago open data");

  var layersByNum = {};
  var geoLayer = L.geoJSON(DATA, {
    style: function () { return STYLE.base; },
    onEachFeature: function (feature, layer) {
      var num = feature.properties.num;
      layersByNum[num] = layer;
      layer.on("click", function () { onGuess(num); });
      // desktop hover affordance
      layer.on("mouseover", function () {
        if (!state.locked && state.playing) layer.setStyle({ fillColor: "#3a2d25" });
      });
      layer.on("mouseout", function () {
        if (!state.locked && state.playing && num !== (state.current && state.current.num))
          layer.setStyle(STYLE.base);
      });
    }
  }).addTo(map);

  map.fitBounds(geoLayer.getBounds(), { padding: [16, 16] });
  var HOME = map.getBounds();

  // ----- state -----
  var state = {
    queue: [], current: null, total: 0, answered: 0,
    correct: 0, streak: 0, bestStreak: 0, missed: [],
    locked: false, playing: false
  };

  // ----- helpers -----
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function featuresFor(region) {
    return DATA.features.filter(function (f) {
      return region === "all" || f.properties.side === region;
    }).map(function (f) { return f.properties; });
  }
  function selectedLength() {
    var btn = el.lengthSeg.querySelector(".seg.active");
    return btn ? btn.dataset.len : "10";
  }
  function resetStyles() {
    for (var n in layersByNum) layersByNum[n].setStyle(STYLE.base);
  }

  var toastTimer = null;
  function toast(msg, sub, kind) {
    el.toast.innerHTML = msg + (sub ? '<span class="t-sub">' + sub + "</span>" : "");
    el.toast.className = "show " + (kind || "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.className = "hidden"; }, 1600);
  }

  // ----- region dropdown -----
  (function buildRegions() {
    var sides = {};
    DATA.features.forEach(function (f) { sides[f.properties.side] = (sides[f.properties.side] || 0) + 1; });
    var opts = ['<option value="all">All of Chicago · 77</option>'];
    Object.keys(sides).sort().forEach(function (s) {
      opts.push('<option value="' + s + '">' + s + " Side · " + sides[s] + "</option>");
    });
    el.regionSelect.innerHTML = opts.join("");
  })();

  // ----- best score (localStorage) -----
  var BEST_KEY = "chiHoods.best";
  function readBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY) || "{}"); } catch (e) { return {}; }
  }
  function showBest() {
    var b = readBest();
    el.bestLine.textContent = b.streak ? "Best streak: " + b.streak : "Tap a highlighted shape to guess.";
  }
  showBest();

  // ----- game flow -----
  function startGame() {
    var region = el.regionSelect.value;
    var pool = featuresFor(region);
    var len = selectedLength();
    var q = shuffle(pool);
    if (len !== "all") q = q.slice(0, Math.min(parseInt(len, 10), q.length));

    state.queue = q;
    state.total = q.length;
    state.answered = 0; state.correct = 0; state.streak = 0; state.bestStreak = 0;
    state.missed = []; state.playing = true;

    el.startScreen.classList.add("hidden");
    el.endScreen.classList.add("hidden");
    el.hud.classList.remove("hidden");
    el.controls.classList.remove("hidden");
    map.flyToBounds(HOME, { padding: [16, 16], duration: 0.5 });
    nextRound();
  }

  function nextRound() {
    resetStyles();
    state.locked = false;
    if (!state.queue.length) { return endGame(); }
    state.current = state.queue.shift();
    el.target.textContent = state.current.name;
    el.progress.textContent = (state.answered + 1) + " / " + state.total;
    el.score.textContent = state.correct + " correct";
    el.streak.textContent = "🔥 " + state.streak;
  }

  function onGuess(num) {
    if (state.locked || !state.playing || !state.current) return;
    state.locked = true;
    state.answered++;
    var target = state.current;
    var picked = byNum(num);

    if (num === target.num) {
      layersByNum[num].setStyle(STYLE.correct);
      state.correct++;
      state.streak++;
      if (state.streak > state.bestStreak) state.bestStreak = state.streak;
      toast("Correct!", target.name + " · " + target.side + " Side", "good");
      setTimeout(nextRound, 900);
    } else {
      layersByNum[num].setStyle(STYLE.wrong);
      layersByNum[target.num].setStyle(STYLE.reveal);
      state.streak = 0;
      state.missed.push(target.name);
      toast("That was " + picked.name, target.name + " is highlighted in orange", "bad");
      setTimeout(nextRound, 1900);
    }
    el.score.textContent = state.correct + " correct";
    el.streak.textContent = "🔥 " + state.streak;
  }

  function skip() {
    if (state.locked || !state.playing || !state.current) return;
    state.locked = true;
    state.answered++;
    state.streak = 0;
    state.missed.push(state.current.name);
    layersByNum[state.current.num].setStyle(STYLE.reveal);
    toast("This one", state.current.name, "bad");
    el.streak.textContent = "🔥 0";
    setTimeout(nextRound, 1600);
  }

  function hint() {
    if (!state.playing || !state.current) return;
    toast("Region", state.current.side + " Side", "");
  }

  function byNum(num) {
    for (var i = 0; i < DATA.features.length; i++)
      if (DATA.features[i].properties.num === num) return DATA.features[i].properties;
    return { name: "?", side: "?" };
  }

  function endGame() {
    state.playing = false;
    el.hud.classList.add("hidden");
    el.controls.classList.add("hidden");

    var acc = state.total ? Math.round((state.correct / state.total) * 100) : 0;
    el.rScore.textContent = state.correct + "/" + state.total;
    el.rAcc.textContent = acc + "%";
    el.rStreak.textContent = state.bestStreak;

    if (state.missed.length) {
      var uniq = state.missed.filter(function (v, i, a) { return a.indexOf(v) === i; });
      el.missedList.innerHTML = uniq.map(function (n) { return "<li>" + n + "</li>"; }).join("");
      el.missedWrap.classList.remove("hidden");
    } else {
      el.missedWrap.classList.add("hidden");
    }

    // persist best streak
    var b = readBest();
    if (state.bestStreak > (b.streak || 0)) {
      try { localStorage.setItem(BEST_KEY, JSON.stringify({ streak: state.bestStreak })); } catch (e) {}
    }
    el.endScreen.classList.remove("hidden");
  }

  // ----- wiring -----
  el.startBtn.addEventListener("click", startGame);
  el.againBtn.addEventListener("click", function () {
    el.endScreen.classList.add("hidden");
    showBest();
    el.startScreen.classList.remove("hidden");
  });
  el.skipBtn.addEventListener("click", skip);
  el.hintBtn.addEventListener("click", hint);
  el.lengthSeg.addEventListener("click", function (e) {
    var seg = e.target.closest(".seg");
    if (!seg) return;
    el.lengthSeg.querySelectorAll(".seg").forEach(function (s) {
      s.classList.toggle("active", s === seg);
      s.setAttribute("aria-checked", s === seg ? "true" : "false");
    });
  });
})();
