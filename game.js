/* chicago-neighborhoods — tap-the-map quiz of Chicago's 77 community areas.
   Optional CTA 'L' rail-line overlay (non-interactive, toggleable).
   Tile colors are sourced from CSS custom properties (see style.css :root).
   State machine: start screen -> rounds -> end screen. No build step, no backend. */
(function () {
  "use strict";

  var DATA = window.CHICAGO_COMMUNITY_AREAS;
  if (!DATA) { alert("Neighborhood data failed to load."); return; }

  // Common-name aliases, keyed by community-area number. Many official areas are
  // better known by a neighborhood inside them; we quiz on the familiar name and
  // show the official area as a subtitle. Edit freely — purely presentational.
  var ALIASES = {
    6:  "Boystown",         // Lake View
    24: "Wicker Park",      // West Town
    28: "West Loop",        // Near West Side
    30: "Little Village",   // South Lawndale
    31: "Pilsen",           // Lower West Side
    33: "South Loop",       // Near South Side
    34: "Chinatown",        // Armour Square
    61: "Back of the Yards" // New City
  };
  function displayName(p) { return (p && (ALIASES[p.num] || p.name)) || "?"; }

  // ----- polygon styling (colors sourced from CSS so they live in one place) -----
  var rootStyle = getComputedStyle(document.documentElement);
  function cssVar(name) { return rootStyle.getPropertyValue(name).trim(); }
  var STYLE = {
    base:    { fillColor: cssVar("--tile-base"),    color: cssVar("--tile-base-line"),    weight: 1,   fillOpacity: 0.82 },
    hover:   { fillColor: cssVar("--tile-hover") },
    correct: { fillColor: cssVar("--tile-correct"), color: cssVar("--tile-correct-line"), weight: 2,   fillOpacity: 0.9  },
    wrong:   { fillColor: cssVar("--tile-wrong"),   color: cssVar("--tile-wrong-line"),   weight: 2,   fillOpacity: 0.9  },
    reveal:  { fillColor: cssVar("--tile-reveal"),  color: cssVar("--tile-reveal-line"),  weight: 2.5, fillOpacity: 0.92 },
    // "ask" — highlights the mystery area in multiple-choice mode (the question)
    ask:     { fillColor: cssVar("--tile-ask"),     color: cssVar("--tile-ask-line"),     weight: 3,   fillOpacity: 0.92 }
  };

  // ----- DOM -----
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    hud: $("hud"), controls: $("controls"),
    tapControls: $("tap-controls"), choiceControls: $("choice-controls"), choices: $("choices"),
    target: $("target"), targetSub: $("target-sub"), progress: $("progress"), score: $("score"), streak: $("streak"),
    toast: $("toast"), hintBtn: $("hint-btn"), skipBtn: $("skip-btn"), choiceSkipBtn: $("choice-skip-btn"),
    startScreen: $("start-screen"), endScreen: $("end-screen"), lToggle: $("l-toggle"),
    regionSelect: $("region-select"), lengthSeg: $("length-seg"), modeSeg: $("mode-seg"),
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
  var propsByNum = {};
  var geoLayer = L.geoJSON(DATA, {
    style: function () { return STYLE.base; },
    onEachFeature: function (feature, layer) {
      var num = feature.properties.num;
      layersByNum[num] = layer;
      propsByNum[num] = feature.properties;
      layer.on("click", function () { onGuess(num); });
      // desktop hover affordance (tap mode only — choice mode isn't map-clickable)
      layer.on("mouseover", function () {
        if (state.mode === "tap" && !state.locked && state.playing) layer.setStyle(STYLE.hover);
      });
      layer.on("mouseout", function () {
        if (state.mode === "tap" && !state.locked && state.playing && num !== (state.current && state.current.num))
          layer.setStyle(STYLE.base);
      });
    }
  }).addTo(map);

  // CTA 'L' overlay — orientation aid only. Non-interactive so taps fall through
  // to the neighborhood polygons beneath. Each route drawn in its official color.
  var lLayer = window.CTA_L_LINES ? L.geoJSON(window.CTA_L_LINES, {
    interactive: false,
    style: function (f) {
      return { color: f.properties.color, weight: 3, opacity: 0.95, lineCap: "round", lineJoin: "round" };
    }
  }) : null;
  var lVisible = true;
  if (lLayer) lLayer.addTo(map);

  function toggleL() {
    if (!lLayer) return;
    lVisible = !lVisible;
    if (lVisible) lLayer.addTo(map); else map.removeLayer(lLayer);
    el.lToggle.classList.toggle("active", lVisible);
    el.lToggle.setAttribute("aria-pressed", lVisible ? "true" : "false");
  }

  map.fitBounds(geoLayer.getBounds(), { padding: [16, 16] });
  var HOME = map.getBounds();

  // ----- state -----
  var state = {
    queue: [], pool: [], current: null, total: 0, answered: 0,
    correct: 0, streak: 0, bestStreak: 0, missed: [],
    locked: false, playing: false,
    region: "all", length: "10", mode: "tap"
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
  function selectedMode() {
    var btn = el.modeSeg.querySelector(".seg.active");
    return btn ? btn.dataset.mode : "tap";
  }
  function resetStyles() {
    for (var n in layersByNum) layersByNum[n].setStyle(STYLE.base);
  }

  var toastTimer = null;
  function toast(msg, sub, kind) {
    el.toast.textContent = msg;
    if (sub) {
      var span = document.createElement("span");
      span.className = "t-sub";
      span.textContent = sub;
      el.toast.appendChild(span);
    }
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

  // ----- score history (localStorage) -----
  var HISTORY_KEY = "chiHoods.history";
  var BEST_KEY = "chiHoods.best";

  function readHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch (e) { return []; }
  }

  function saveScore(score, total, streak, region, length) {
    var history = readHistory();
    history.push({
      timestamp: new Date().toISOString(),
      score: score,
      total: total,
      accuracy: total ? Math.round((score / total) * 100) : 0,
      streak: streak,
      region: region,
      length: length
    });
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) {}
  }

  function readBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY) || "{}"); } catch (e) { return {}; }
  }

  function exportScores() {
    var history = readHistory();
    var json = JSON.stringify(history, null, 2);
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "chicago-hoods-scores-" + new Date().toISOString().split("T")[0] + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    var mode = selectedMode();
    var q = shuffle(pool);
    if (len !== "all") q = q.slice(0, Math.min(parseInt(len, 10), q.length));

    state.queue = q;
    state.pool = pool;
    state.total = q.length;
    state.answered = 0; state.correct = 0; state.streak = 0; state.bestStreak = 0;
    state.missed = []; state.playing = true;
    state.region = region; state.length = len; state.mode = mode;

    // swap the bottom UI to match the mode
    var choice = mode === "choice";
    el.tapControls.classList.toggle("hidden", choice);
    el.choiceControls.classList.toggle("hidden", !choice);

    el.startScreen.classList.add("hidden");
    el.endScreen.classList.add("hidden");
    el.hud.classList.remove("hidden");
    el.controls.classList.remove("hidden");
    // tap mode views the whole city; choice mode zooms to each target in setup
    if (!choice) map.flyToBounds(HOME, { padding: [16, 16], duration: 0.5 });
    nextRound();
  }

  function updateChips() {
    el.progress.textContent = (state.answered + 1) + " / " + state.total;
    el.score.textContent = state.correct + " correct";
    el.streak.textContent = "🔥 " + state.streak;
  }

  function nextRound() {
    resetStyles();
    state.locked = false;
    if (!state.queue.length) { return endGame(); }
    state.current = state.queue.shift();
    updateChips();
    if (state.mode === "choice") setupChoiceRound();
    else setupTapRound();
  }

  // ----- tap mode: name shown, tap the map -----
  function setupTapRound() {
    el.target.textContent = displayName(state.current);
    el.targetSub.textContent = ALIASES[state.current.num] ? state.current.name : "";
  }

  function onGuess(num) {
    if (state.mode !== "tap" || state.locked || !state.playing || !state.current) return;
    state.locked = true;
    state.answered++;
    var target = state.current;

    if (num === target.num) {
      layersByNum[num].setStyle(STYLE.correct);
      scoreCorrect();
      var goodSub = ALIASES[target.num]
        ? displayName(target) + " · " + target.name
        : target.name + " · " + target.side + " Side";
      toast("Correct!", goodSub, "good");
      setTimeout(nextRound, 900);
    } else {
      layersByNum[num].setStyle(STYLE.wrong);
      layersByNum[target.num].setStyle(STYLE.reveal);
      scoreMiss(target);
      toast("That was " + displayName(byNum(num)), displayName(target) + " is highlighted", "bad");
      setTimeout(nextRound, 1900);
    }
    el.score.textContent = state.correct + " correct";
    el.streak.textContent = "🔥 " + state.streak;
  }

  // ----- choice mode: area highlighted, pick its name from four options -----
  function setupChoiceRound() {
    var target = state.current;
    layersByNum[target.num].setStyle(STYLE.ask);
    // ease toward the highlighted area, but keep plenty of city context so you can
    // tell where it sits (lakeshore, neighbors). Small areas hit the maxZoom cap;
    // at a fixed zoom a wide desktop viewport shows more geography (area looks tiny)
    // than a phone, so the cap is responsive: looser on mobile, tighter on desktop.
    var vw = window.innerWidth || document.documentElement.clientWidth || 1024;
    var maxZoom = vw >= 720 ? 12.5 : 11;
    // fitBounds (not flyToBounds): the fly trajectory math throws "Invalid LatLng
    // (NaN, NaN)" for some center/zoom combos; fitBounds animates without it.
    map.fitBounds(layersByNum[target.num].getBounds(), {
      padding: [60, 60], maxZoom: maxZoom, animate: true, duration: 0.6
    });

    // correct answer + up to three distractors from the same pool
    var others = shuffle(state.pool.filter(function (p) { return p.num !== target.num; })).slice(0, 3);
    var options = shuffle([target].concat(others));

    el.choices.innerHTML = "";
    options.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
      btn.textContent = displayName(opt);
      btn.dataset.num = opt.num;
      btn.addEventListener("click", function () { onChoice(opt.num); });
      el.choices.appendChild(btn);
    });
  }

  function onChoice(num) {
    if (state.mode !== "choice" || state.locked || !state.playing || !state.current) return;
    state.locked = true;
    state.answered++;
    var target = state.current;

    // mark the option buttons and disable further taps
    var btns = el.choices.querySelectorAll(".choice-btn");
    btns.forEach(function (b) {
      b.disabled = true;
      var bn = parseInt(b.dataset.num, 10);
      if (bn === target.num) b.classList.add("correct");
      else if (bn === num) b.classList.add("wrong");
    });

    if (num === target.num) {
      layersByNum[target.num].setStyle(STYLE.correct); // green only when right
      scoreCorrect();
      toast("Correct!", displayName(target), "good");
      setTimeout(nextRound, 950);
    } else {
      layersByNum[target.num].setStyle(STYLE.reveal);  // neutral "here's the answer"
      scoreMiss(target);
      toast("That's " + displayName(target), "You picked " + displayName(byNum(num)), "bad");
      setTimeout(nextRound, 1900);
    }
    el.score.textContent = state.correct + " correct";
    el.streak.textContent = "🔥 " + state.streak;
  }

  // shared scoring side-effects
  function scoreCorrect() {
    state.correct++;
    state.streak++;
    if (state.streak > state.bestStreak) state.bestStreak = state.streak;
  }
  function scoreMiss(target) {
    state.streak = 0;
    state.missed.push(displayName(target));
  }

  function skip() {
    if (state.locked || !state.playing || !state.current) return;
    state.locked = true;
    state.answered++;
    var target = state.current;
    scoreMiss(target);
    if (state.mode === "choice") {
      layersByNum[target.num].setStyle(STYLE.reveal);
      el.choices.querySelectorAll(".choice-btn").forEach(function (b) {
        b.disabled = true;
        if (parseInt(b.dataset.num, 10) === target.num) b.classList.add("correct");
      });
    } else {
      layersByNum[target.num].setStyle(STYLE.reveal);
    }
    toast("This one", displayName(target), "bad");
    el.streak.textContent = "🔥 0";
    setTimeout(nextRound, 1600);
  }

  function hint() {
    if (!state.playing || !state.current) return;
    toast("Region", state.current.side + " Side", "");
  }

  function byNum(num) {
    return propsByNum[num] || { name: "?", side: "?" };
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

    // save score to history
    saveScore(state.correct, state.total, state.bestStreak, state.region, state.length);

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
  el.choiceSkipBtn.addEventListener("click", skip);
  el.hintBtn.addEventListener("click", hint);
  el.lToggle.addEventListener("click", toggleL);
  document.getElementById("export-btn").addEventListener("click", exportScores);

  // single-select segmented controls (Length, Mode)
  function wireSegmented(container) {
    container.addEventListener("click", function (e) {
      var seg = e.target.closest(".seg");
      if (!seg) return;
      container.querySelectorAll(".seg").forEach(function (s) {
        s.classList.toggle("active", s === seg);
        s.setAttribute("aria-checked", s === seg ? "true" : "false");
      });
    });
  }
  wireSegmented(el.lengthSeg);
  wireSegmented(el.modeSeg);
})();
