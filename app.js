const LS_KEY = "werewolf_manual_v2_state";
const $ = (id) => document.getElementById(id);

const ROLES = {
  WEREWOLF: "Sói",
  GUARD: "Bảo vệ",
  SEER: "Tiên tri",
  WITCH: "Phù thủy",
  SORCERER: "Pháp sư",
  GAMBLER: "Con bạc",
  PRINCE: "Hoàng tử",
  HYBRID: "Con Lai",
  BORED: "Kẻ chán đời",
  VILLAGER: "Dân làng",
};

let voteInterval = null;
let state = freshState();
renderAll();

/* ---------- State ---------- */
function freshState() {
  return {
    started: false,
    gameOver: false,
    winnerText: "",
    phase: "setup", // setup | day | night
    day: 0,
    night: 0,
    players: [],

    nightActions: {
      wolfTarget: null,
      guardProtect: null,
      witchHeal: null,
      witchPoison: null,
      sorcererMute: null,
      gamblerBet: null,
      seerCheck: null,
    },

    constraints: { lastGuardProtect: null, lastSorcererMute: null },

    resources: { witchHealLeft: 1, witchPoisonLeft: 1 },

    dayVote: null,

    voteTimer: { running: false, endsAt: null, durationSec: 60 },

    log: [],
  };
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[c]));
}

function alivePlayers() { return state.players.filter(p => p.alive); }
function findPlayer(id) { return state.players.find(p => p.id === id) || null; }
function wolves() { return state.players.filter(p => p.role === ROLES.WEREWOLF && p.alive); }
function isRoleAlive(role) { return alivePlayers().some(p => p.role === role); }

function isWolfForSeer(player) {
  if (!player) return false;
  return player.role === ROLES.WEREWOLF; // ✅ Con Lai chưa hóa => không phải Sói
}

function addLog(msg, kind = "info") {
  state.log.unshift({ t: new Date().toLocaleString(), msg, kind });
  renderLog();
}

function setPhase(phase) {
  state.phase = phase;
  renderPhasePill();
}

function resetNightActions() {
  state.nightActions = {
    wolfTarget: null,
    guardProtect: null,
    witchHeal: null,
    witchPoison: null,
    sorcererMute: null,
    gamblerBet: null,
    seerCheck: null,
  };
}

function stopVoteTimer() {
  if (voteInterval) clearInterval(voteInterval);
  voteInterval = null;
  state.voteTimer.running = false;
  state.voteTimer.endsAt = null;
}

function getVoteRemainingSec() {
  if (!state.voteTimer.running || !state.voteTimer.endsAt) return 0;
  const ms = state.voteTimer.endsAt - Date.now();
  return Math.max(0, Math.ceil(ms / 1000));
}

function formatSec(s) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function endGame(text, kind = "ok") {
  if (state.gameOver) return;
  state.gameOver = true;
  state.winnerText = text;
  stopVoteTimer();
  addLog(`🏁 <b>GAME OVER</b> — ${text}`, kind);
  renderAll();
}

/* ---------- Setup: add player ---------- */
$("btnAdd")?.addEventListener("click", () => {
  if (state.gameOver) return addLog("Game đã kết thúc. Bấm New Game để chơi lại.", "warn");

  const name = $("inpName")?.value.trim();
  if (!name) return;

  const role = $("selRole")?.value || ROLES.VILLAGER;

  state.players.push({
    id: uid(),
    name,
    role,
    alive: true,
    trueRoleRevealed: false,
    princeSavedOnce: false,
  });

  $("inpName").value = "";
  addLog(`Đã thêm: <b>${escapeHtml(name)}</b> (${escapeHtml(role)})`, "ok");

  if (!state.started) {
    state.started = true;
    state.day = 1;
    state.night = 0;
    setPhase("day");
    addLog(`☀️ Bắt đầu <b>NGÀY 1</b>`, "ok");
  }

  renderAll();
});

$("inpName")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btnAdd").click();
});

/* ---------- New/Save/Load ---------- */
$("btnNew")?.addEventListener("click", () => {
  if (!confirm("Tạo ván mới? (Sẽ xóa state hiện tại)")) return;
  stopVoteTimer();
  state = freshState();
  renderAll();
});

$("btnSave")?.addEventListener("click", () => {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  addLog("💾 Đã lưu vào localStorage.", "ok");
});

$("btnLoad")?.addEventListener("click", () => {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return addLog("Không có dữ liệu để load.", "warn");
  try {
    stopVoteTimer();
    state = JSON.parse(raw);
    addLog("📦 Đã load state.", "ok");
    renderAll();
  } catch {
    addLog("Load thất bại (state bị lỗi).", "bad");
  }
});

$("btnClearLog")?.addEventListener("click", () => {
  if (!confirm("Xóa log?")) return;
  state.log = [];
  renderLog();
});

/* =====================================================
   ✅ ĐÚNG FLOW (KHÔNG LỘN):
   - Start Night: chỉ bấm khi đang DAY -> chuyển sang NIGHT
   - Start Day  : chỉ bấm khi đang NIGHT -> resolveNight -> chuyển sang DAY
   ===================================================== */

/* Start Night */
$("btnStartNight")?.addEventListener("click", () => {
  if (!state.started) return addLog("Hãy thêm người chơi trước.", "warn");
  if (state.gameOver) return addLog("Game đã kết thúc. Bấm New Game để chơi lại.", "warn");
  if (state.phase !== "day") return addLog("Start Night chỉ dùng khi đang NGÀY.", "warn");

  stopVoteTimer();
  state.night += 1;
  setPhase("night");
  resetNightActions();
  addLog(`🌙 Bắt đầu <b>ĐÊM ${state.night}</b>`, "warn");
  renderAll();
});

/* Start Day */
$("btnStartDay")?.addEventListener("click", () => {
  if (!state.started) return addLog("Hãy thêm người chơi trước.", "warn");
  if (state.gameOver) return addLog("Game đã kết thúc. Bấm New Game để chơi lại.", "warn");
  if (state.phase !== "night") return addLog("Start Day chỉ dùng khi đang ĐÊM.", "warn");

  resolveNight();
  if (state.gameOver) return;

  state.day += 1;
  setPhase("day");
  state.dayVote = null;
  stopVoteTimer();
  addLog(`☀️ Bắt đầu <b>NGÀY ${state.day}</b>`, "ok");
  renderAll();
});

/* ---------- UI builders ---------- */
function block(title, inner) {
  return `<div class="block"><h3>${title}</h3>${inner}</div>`;
}
function dropdown(key, options, selected, placeholder) {
  const opts = [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(options.map(o => `<option value="${o.value}" ${selected === o.value ? "selected" : ""}>${escapeHtml(o.label)}</option>`));
  return `<select id="dd_${key}">${opts.join("")}</select>`;
}
function bindNightDropdown(key, opt = {}) {
  const el = document.getElementById(`dd_${key}`);
  if (!el) return;
  el.addEventListener("change", () => {
    state.nightActions[key] = el.value || null;
    if (opt.rerender) renderNightPanel();
  });
}

/* ---------- Night panel ---------- */
function renderNightPanel() {
  const panel = $("nightPanel");
  if (!state.started) return panel.innerHTML = `<div class="hint">Chưa bắt đầu. Hãy thêm người chơi.</div>`;
  if (state.phase !== "night") return panel.innerHTML = `<div class="hint">Đang không phải pha Đêm.</div>`;
  if (state.gameOver) return panel.innerHTML = `<div class="hint">Game Over: ${escapeHtml(state.winnerText)}</div>`;

  const alive = alivePlayers();
  const aliveOptions = alive.map(p => ({ value: p.id, label: p.name }));
  const wolfTargets = alive.filter(p => p.role !== ROLES.WEREWOLF).map(p => ({ value: p.id, label: p.name }));
  const canGamble = (state.night >= 2) && isRoleAlive(ROLES.GAMBLER);
  const wolfTarget = state.nightActions.wolfTarget ? findPlayer(state.nightActions.wolfTarget) : null;

  let html = "";

  html += wolves().length > 0
    ? block("🐺 Sói chọn nạn nhân", dropdown("wolfTarget", wolfTargets, state.nightActions.wolfTarget, "Chọn người bị cắn..."))
    : block("🐺 Sói", `<div class="hint">Không còn Sói sống.</div>`);

  if (isRoleAlive(ROLES.GUARD)) {
    const restricted = state.constraints.lastGuardProtect;
    const guardOptions = aliveOptions.filter(o => o.value !== restricted);
    const note = restricted ? `<div class="hint">Không bảo vệ trùng lặp liên tiếp: <b>${escapeHtml(findPlayer(restricted)?.name || "")}</b></div>` : "";
    html += block("🛡️ Bảo vệ chọn ai", dropdown("guardProtect", guardOptions, state.nightActions.guardProtect, "Chọn người được bảo vệ...") + note);
  }

  if (isRoleAlive(ROLES.SEER)) {
    html += block("🔮 Tiên tri soi ai (ra kết quả liền)", dropdown("seerCheck", aliveOptions, state.nightActions.seerCheck, "Chọn người để soi..."));
  }

  if (isRoleAlive(ROLES.SORCERER)) {
    const restricted = state.constraints.lastSorcererMute;
    const muteOptions = aliveOptions.filter(o => o.value !== restricted);
    const note = restricted ? `<div class="hint">Không mute trùng lặp liên tiếp: <b>${escapeHtml(findPlayer(restricted)?.name || "")}</b></div>` : "";
    html += block("🤫 Pháp sư (mute) chọn ai", dropdown("sorcererMute", muteOptions, state.nightActions.sorcererMute, "Chọn người bị mute...") + note);
  }

  if (isRoleAlive(ROLES.WITCH)) {
    const healLeft = state.resources.witchHealLeft;
    const poisonLeft = state.resources.witchPoisonLeft;

    const healBlock = (wolfTarget && healLeft > 0)
      ? dropdown("witchHeal", [{ value: wolfTarget.id, label: wolfTarget.name }], state.nightActions.witchHeal, "Chọn để CỨU (chỉ nạn nhân)...")
      : `<div class="hint">${!wolfTarget ? "Sói chưa chọn nạn nhân." : (healLeft <= 0 ? "Hết bình CỨU." : "")}</div>`;

    const poisonBlock = (poisonLeft > 0)
      ? dropdown("witchPoison", aliveOptions, state.nightActions.witchPoison, "Chọn để GIẾT (bình độc)...")
      : `<div class="hint">Hết bình GIẾT.</div>`;

    html += block(
      `🧪 Phù thủy (Cứu: <b>${healLeft}</b> | Giết: <b>${poisonLeft}</b>)`,
      `<div class="grid2">
        <div><h3 style="margin:0 0 8px;font-size:12px;color:#cbd5e1">Bình Cứu</h3>${healBlock}</div>
        <div><h3 style="margin:0 0 8px;font-size:12px;color:#cbd5e1">Bình Giết</h3>${poisonBlock}</div>
      </div><div class="hint">Không chọn = không dùng bình.</div>`
    );
  }

  if (canGamble) {
    html += block(
      "🎲 Con bạc (đêm 2+) cược ai",
      dropdown("gamblerBet", aliveOptions, state.nightActions.gamblerBet, "Chọn người để cược...") +
      `<div class="hint">Cược trúng Sói → người đó chết. Cược sai → Con bạc chết.</div>`
    );
  }

  panel.innerHTML = html;

  bindNightDropdown("wolfTarget", { rerender: true });
  bindNightDropdown("guardProtect");
  bindNightDropdown("sorcererMute");
  bindNightDropdown("witchHeal");
  bindNightDropdown("witchPoison");
  bindNightDropdown("gamblerBet");

  const seerEl = document.getElementById("dd_seerCheck");
  if (seerEl) {
    seerEl.addEventListener("change", () => {
      const id = seerEl.value || null;
      state.nightActions.seerCheck = id;
      if (!id) return;
      const t = findPlayer(id);
      if (!t) return;

      const wolfish = isWolfForSeer(t);
      addLog(`🔮 Tiên tri soi <b>${escapeHtml(t.name)}</b> → <span class="${wolfish ? "bad" : "ok"}">${wolfish ? "SÓI" : "KHÔNG PHẢI SÓI"}</span>`, "info");
    });
  }
}

/* ---------- Day panel ---------- */
function renderDayPanel() {
  const panel = $("dayPanel");
  if (!state.started) return panel.innerHTML = `<div class="hint">Chưa bắt đầu. Hãy thêm người chơi.</div>`;
  if (state.phase !== "day") return panel.innerHTML = `<div class="hint">Đang không phải pha Ngày.</div>`;
  if (state.gameOver) return panel.innerHTML = `<div class="hint">Game Over: ${escapeHtml(state.winnerText)}</div>`;

  const alive = alivePlayers();
  const aliveOptions = alive.map(p => ({ value: p.id, label: p.name }));
  const remaining = getVoteRemainingSec();

  panel.innerHTML = `
    <div class="block">
      <h3>🗳️ Vote treo cổ</h3>
      ${dropdown("dayVote", aliveOptions, state.dayVote, "Chọn người bị vote...")}

      <div class="grid2" style="margin-top:10px">
        <div>
          <label>Thời gian vote (giây)</label>
          <input id="voteSeconds" type="number" min="10" value="${state.voteTimer.durationSec || 60}" />
        </div>
        <div>
          <label>Countdown</label>
          <div style="padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(0,0,0,.12)">
            <b id="voteRemain">${formatSec(remaining)}</b>
            <div class="tiny muted">${state.voteTimer.running ? "Đang chạy..." : "Chưa chạy"}</div>
          </div>
        </div>
      </div>

      <div class="inline" style="margin-top:10px">
        <button id="btnStartVoteTimer" class="btn">Start countdown</button>
        <button id="btnEndVote" class="btn danger">Kết thúc vote (resolve)</button>
      </div>
    </div>
  `;

  document.getElementById("dd_dayVote").addEventListener("change", (e) => {
    state.dayVote = e.target.value || null;
  });

  $("voteSeconds").addEventListener("change", (e) => {
    state.voteTimer.durationSec = Math.max(10, parseInt(e.target.value || "60", 10));
  });

  $("btnStartVoteTimer").addEventListener("click", startVoteTimer);
  $("btnEndVote").addEventListener("click", () => endVoteNow(false));

  if (state.voteTimer.running && !voteInterval) attachVoteInterval();
}

function startVoteTimer() {
  stopVoteTimer();
  const dur = Math.max(10, parseInt(state.voteTimer.durationSec || 60, 10));
  state.voteTimer.running = true;
  state.voteTimer.endsAt = Date.now() + dur * 1000;
  addLog(`⏱️ Bắt đầu countdown vote: <b>${dur}s</b>`, "warn");
  attachVoteInterval();
  renderDayPanel();
}

function attachVoteInterval() {
  if (voteInterval) clearInterval(voteInterval);
  voteInterval = setInterval(() => {
    const remain = getVoteRemainingSec();
    const el = $("voteRemain");
    if (el) el.textContent = formatSec(remain);
    if (remain <= 0) endVoteNow(true);
  }, 250);
}

function endVoteNow(auto) {
  if (state.phase !== "day") return;
  stopVoteTimer();
  addLog(auto ? "⏱️ Hết giờ vote → kết thúc vote." : "🛑 Kết thúc vote.", "warn");
  if (state.dayVote) resolveVote();
  else addLog("Không có người bị vote → bỏ qua.", "warn");
  renderAll();
}

/* ---------- Resolve ---------- */
function killPlayer(id, reason) {
  const p = findPlayer(id);
  if (!p || !p.alive) return;
  p.alive = false;
  addLog(reason, "bad");
}

function resolveNight() {
  const a = state.nightActions;

  if (a.guardProtect && a.guardProtect === state.constraints.lastGuardProtect) {
    addLog("🛡️ Bảo vệ trùng liên tiếp → bỏ chọn.", "warn");
    a.guardProtect = null;
  }
  if (a.sorcererMute && a.sorcererMute === state.constraints.lastSorcererMute) {
    addLog("🤫 Mute trùng liên tiếp → bỏ chọn.", "warn");
    a.sorcererMute = null;
  }

  if (a.sorcererMute) {
    const t = findPlayer(a.sorcererMute);
    if (t) {
      addLog(`🤫 Pháp sư mute <b>${escapeHtml(t.name)}</b>`, "warn");
      state.constraints.lastSorcererMute = a.sorcererMute;
    }
  }

  let wolfVictim = a.wolfTarget ? findPlayer(a.wolfTarget) : null;
  if (wolfVictim && !wolfVictim.alive) wolfVictim = null;

  const protectedId = a.guardProtect || null;
  if (protectedId) state.constraints.lastGuardProtect = protectedId;

  let healed = false;
  if (a.witchHeal && wolfVictim && state.resources.witchHealLeft > 0 && a.witchHeal === wolfVictim.id) {
    healed = true;
    state.resources.witchHealLeft -= 1;
    addLog(`🧪 Phù thủy CỨU <b>${escapeHtml(wolfVictim.name)}</b>`, "ok");
  }

  let poisonTarget = null;
  if (a.witchPoison && state.resources.witchPoisonLeft > 0) {
    poisonTarget = findPlayer(a.witchPoison);
    if (poisonTarget && poisonTarget.alive) {
      state.resources.witchPoisonLeft -= 1;
      addLog(`🧪 Phù thủy GIẾT <b>${escapeHtml(poisonTarget.name)}</b>`, "bad");
    } else poisonTarget = null;
  }

  if (state.night >= 2 && a.gamblerBet) {
    const bet = findPlayer(a.gamblerBet);
    const gambler = alivePlayers().find(p => p.role === ROLES.GAMBLER);
    if (bet && bet.alive && gambler && gambler.alive) {
      if (bet.role === ROLES.WEREWOLF) killPlayer(bet.id, `🎲 Con bạc cược TRÚNG Sói → <b>${escapeHtml(bet.name)}</b> chết`);
      else killPlayer(gambler.id, `🎲 Con bạc cược SAI → <b>${escapeHtml(gambler.name)}</b> chết`);
    }
  }

  if (wolfVictim) {
    const isProtected = protectedId && wolfVictim.id === protectedId;

    if (isProtected) addLog(`🛡️ Bảo vệ <b>${escapeHtml(wolfVictim.name)}</b> → không chết`, "ok");
    else if (healed) addLog(`✅ Được cứu → không chết`, "ok");
    else {
      if (wolfVictim.role === ROLES.HYBRID) {
        wolfVictim.role = ROLES.WEREWOLF;
        addLog(`🧬 <b>${escapeHtml(wolfVictim.name)}</b> là Con Lai bị cắn → <span class="bad">HÓA SÓI</span>!`, "bad");
      } else {
        killPlayer(wolfVictim.id, `🐺 Sói cắn chết <b>${escapeHtml(wolfVictim.name)}</b>`);
      }
    }
  } else addLog("🐺 Sói không chọn nạn nhân.", "warn");

  if (poisonTarget && poisonTarget.alive) killPlayer(poisonTarget.id, `🧪 Bình độc giết <b>${escapeHtml(poisonTarget.name)}</b>`);

  checkWin();
}

function resolveVote() {
  const id = state.dayVote || null;
  if (!id) return;

  const t = findPlayer(id);
  if (!t || !t.alive) return addLog("Vote không hợp lệ.", "warn");

  if (t.role === ROLES.BORED) {
    killPlayer(t.id, `🗳️ Bị treo cổ: <b>${escapeHtml(t.name)}</b>`);
    state.dayVote = null;
    return endGame(`😵 <b>${escapeHtml(t.name)}</b> là <b>Kẻ chán đời</b> → THẮNG vì bị treo cổ!`, "ok");
  }

  if (t.role === ROLES.PRINCE && !t.princeSavedOnce) {
    t.princeSavedOnce = true;
    t.trueRoleRevealed = true;
    addLog(`👑 Vote trúng <b>${escapeHtml(t.name)}</b> → lộ HOÀNG TỬ và thoát chết 1 lần!`, "warn");
    state.dayVote = null;
    return checkWin();
  }

  killPlayer(t.id, `🗳️ Bị treo cổ: <b>${escapeHtml(t.name)}</b>`);
  state.dayVote = null;
  checkWin();
}

function checkWin() {
  if (state.gameOver) return;
  const w = wolves().length;
  const total = alivePlayers().length;
  const v = total - w;

  if (!state.started) return;
  if (w <= 0) return endGame(`<span class="ok">DÂN THẮNG!</span>`, "ok");
  if (w >= v) return endGame(`<span class="bad">SÓI THẮNG!</span>`, "bad");
}

/* ---------- Players + dialog ---------- */
const dlg = $("dlgRole");
$("dlgClose")?.addEventListener("click", () => dlg.close());

function openRoleDialog(p) {
  $("dlgTitle").textContent = p.name;
  $("dlgBody").innerHTML = `<div><b>Role:</b> ${escapeHtml(p.role)}</div><div class="tiny muted" style="margin-top:8px">(Chỉ host thấy.)</div>`;
  dlg.showModal();
}

function renderPlayers() {
  const box = $("playersList");
  if (state.players.length === 0) return box.innerHTML = `<div class="hint">Chưa có người chơi.</div>`;

  box.innerHTML = state.players.map(p => {
    const tags = [
      `<span class="tag ${p.alive ? "alive" : "dead"}">${p.alive ? "Alive" : "Dead"}</span>`,
      `<span class="tag role">${escapeHtml(p.role)}</span>`,
      p.trueRoleRevealed ? `<span class="tag reveal">Revealed</span>` : "",
      (p.role === ROLES.PRINCE && p.princeSavedOnce) ? `<span class="tag reveal">Prince saved</span>` : "",
    ].filter(Boolean).join(" ");

    return `
      <div class="pitem" data-id="${p.id}">
        <div>
          <div class="pname">${escapeHtml(p.name)}</div>
          <div class="tiny muted">Click để xem role</div>
        </div>
        <div class="ptags">${tags}</div>
      </div>
    `;
  }).join("");

  box.querySelectorAll(".pitem").forEach(el => {
    el.addEventListener("click", () => {
      const p = findPlayer(el.dataset.id);
      if (p) openRoleDialog(p);
    });
  });
}

/* ---------- Render ---------- */
function renderPhasePill() {
  const map = { setup: "Chưa bắt đầu", night: `Đêm ${state.night}`, day: `Ngày ${state.day}` };
  $("phasePill").textContent = state.gameOver ? "GAME OVER" : (map[state.phase] || state.phase);
}

function renderLog() {
  const box = $("logBox");
  if (state.log.length === 0) return box.innerHTML = `<div class="hint">Chưa có log.</div>`;
  box.innerHTML = state.log.map(x => {
    const cls = x.kind === "ok" ? "ok" : x.kind === "bad" ? "bad" : x.kind === "warn" ? "warn" : "";
    return `<div class="logline"><span class="tiny muted">${escapeHtml(x.t)}</span> — <span class="${cls}">${x.msg}</span></div>`;
  }).join("");
}

function renderKPIs() {
  $("kDay").textContent = state.day;
  $("kNight").textContent = state.night;
  $("kAlive").textContent = alivePlayers().length;
}

function renderAll() {
  renderPhasePill();
  renderPlayers();
  renderNightPanel();
  renderDayPanel();
  renderLog();
  renderKPIs();
}
