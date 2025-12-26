/* Werewolf Manual 2.0 – offline host tool (GitHub Pages) */

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
  VILLAGER: "Dân làng",
};

let voteInterval = null;
let state = freshState();
renderAll();

/* ---------------- State ---------------- */
function freshState() {
  return {
    started: false,
    phase: "setup", // setup | night | day
    day: 0,
    night: 0,
    players: [], // {id,name,role,alive,trueRoleRevealed,princeSavedOnce}

    nightActions: {
      wolfTarget: null,
      guardProtect: null,
      witchHeal: null,
      witchPoison: null,
      sorcererMute: null,
      gamblerBet: null,
      seerCheck: null, // log ngay khi chọn
    },

    constraints: {
      lastGuardProtect: null,
      lastSorcererMute: null,
    },

    resources: {
      witchHealLeft: 1,
      witchPoisonLeft: 1,
    },

    dayVote: null,

    voteTimer: {
      running: false,
      endsAt: null,
      durationSec: 60,
    },

    log: [],
  };
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/* ---------------- Helpers ---------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[c]));
}

function alivePlayers() { return state.players.filter(p => p.alive); }
function findPlayer(id) { return state.players.find(p => p.id === id) || null; }
function wolves() { return state.players.filter(p => p.role === ROLES.WEREWOLF && p.alive); }
function isRoleAlive(role) { return alivePlayers().some(p => p.role === role); }

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

/* ---------------- Setup: Add player ---------------- */
$("btnAdd")?.addEventListener("click", () => {
  const name = $("inpName").value.trim();
  if (!name) return;

  const role = ($("selRole")?.value || ROLES.VILLAGER);

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

  // auto start game if first time
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

/* ---------------- Buttons: new/save/load/log ---------------- */
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
  if (!raw) {
    addLog("Không có dữ liệu để load.", "warn");
    return;
  }
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

/* ---------------- FLOW (ĐÃ ĐẢO) ----------------
   - Start Night = Resolve Night -> sang Day
   - Start Day   = Resolve Day   -> sang Night
*/
$("btnStartNight")?.addEventListener("click", () => {
  if (!state.started) return addLog("Hãy thêm người chơi trước.", "warn");
  if (state.phase !== "night") return addLog("Bạn chỉ Start Night khi đang ở Đêm.", "warn");

  // Resolve Night
  resolveNight();

  // Sang ngày
  state.day += 1;
  setPhase("day");
  state.dayVote = null;

  // stop vote timer nếu còn
  stopVoteTimer();

  addLog(`☀️ Bắt đầu <b>NGÀY ${state.day}</b>`, "ok");
  renderAll();
});

$("btnStartDay")?.addEventListener("click", () => {
  if (!state.started) return addLog("Hãy thêm người chơi trước.", "warn");
  if (state.phase !== "day") return addLog("Bạn chỉ Start Day khi đang ở Ngày.", "warn");

  // Resolve Day: nếu có timer đang chạy thì dừng
  stopVoteTimer();

  // Resolve vote nếu có chọn
  if (state.dayVote) {
    resolveVote();
  } else {
    addLog("🗳️ Không có vote được chọn → bỏ qua treo cổ.", "warn");
  }

  // Sang đêm
  state.night += 1;
  setPhase("night");
  resetNightActions();
  addLog(`🌙 Bắt đầu <b>ĐÊM ${state.night}</b>`, "warn");

  renderAll();
});

/* ---------------- UI builders ---------------- */
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

/* ---------------- Night panel ---------------- */
function renderNightPanel() {
  const panel = $("nightPanel");
  if (!state.started) {
    panel.innerHTML = `<div class="hint">Chưa bắt đầu. Hãy thêm người chơi.</div>`;
    return;
  }
  if (state.phase !== "night") {
    panel.innerHTML = `<div class="hint">Đang không phải pha Đêm.</div>`;
    return;
  }

  const alive = alivePlayers();
  const aliveOptions = alive.map(p => ({ value: p.id, label: p.name }));
  const wolfTargets = alive.filter(p => p.role !== ROLES.WEREWOLF).map(p => ({ value: p.id, label: p.name }));

  const canGamble = (state.night >= 2) && isRoleAlive(ROLES.GAMBLER);
  const wolfTarget = state.nightActions.wolfTarget ? findPlayer(state.nightActions.wolfTarget) : null;

  let html = "";

  // Wolves
  if (wolves().length > 0) {
    html += block("🐺 Sói chọn nạn nhân", dropdown("wolfTarget", wolfTargets, state.nightActions.wolfTarget, "Chọn người bị cắn..."));
  } else {
    html += block("🐺 Sói", `<div class="hint">Không còn Sói sống.</div>`);
  }

  // Guard
  if (isRoleAlive(ROLES.GUARD)) {
    const restricted = state.constraints.lastGuardProtect;
    const guardOptions = aliveOptions.filter(o => o.value !== restricted);
    const note = restricted ? `<div class="hint">Không bảo vệ trùng lặp liên tiếp: <b>${escapeHtml(findPlayer(restricted)?.name || "")}</b></div>` : "";
    html += block("🛡️ Bảo vệ chọn ai", dropdown("guardProtect", guardOptions, state.nightActions.guardProtect, "Chọn người được bảo vệ...") + note);
  }

  // Seer (ra kết quả liền)
  if (isRoleAlive(ROLES.SEER)) {
    html += block("🔮 Tiên tri soi ai (ra kết quả liền)", dropdown("seerCheck", aliveOptions, state.nightActions.seerCheck, "Chọn người để soi..."));
  }

  // Sorcerer
  if (isRoleAlive(ROLES.SORCERER)) {
    const restricted = state.constraints.lastSorcererMute;
    const muteOptions = aliveOptions.filter(o => o.value !== restricted);
    const note = restricted ? `<div class="hint">Không mute trùng lặp liên tiếp: <b>${escapeHtml(findPlayer(restricted)?.name || "")}</b></div>` : "";
    html += block("🤫 Pháp sư (mute) chọn ai", dropdown("sorcererMute", muteOptions, state.nightActions.sorcererMute, "Chọn người bị mute...") + note);
  }

  // Witch
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
        <div>
          <h3 style="margin:0 0 8px;font-size:12px;color:#cbd5e1">Bình Cứu</h3>
          ${healBlock}
        </div>
        <div>
          <h3 style="margin:0 0 8px;font-size:12px;color:#cbd5e1">Bình Giết</h3>
          ${poisonBlock}
        </div>
      </div>
      <div class="hint">Không chọn = không dùng bình.</div>`
    );
  }

  // Gambler
  if (canGamble) {
    html += block(
      "🎲 Con bạc (đêm 2+) cược ai",
      dropdown("gamblerBet", aliveOptions, state.nightActions.gamblerBet, "Chọn người để cược...")
      + `<div class="hint">Cược trúng Sói → người đó chết. Cược sai → Con bạc chết.</div>`
    );
  }

  panel.innerHTML = html;

  // bind dropdowns
  bindNightDropdown("wolfTarget", { rerender: true });
  bindNightDropdown("guardProtect");
  bindNightDropdown("sorcererMute");
  bindNightDropdown("witchHeal");
  bindNightDropdown("witchPoison");
  bindNightDropdown("gamblerBet");

  // Seer log ngay
  const seerEl = document.getElementById("dd_seerCheck");
  if (seerEl) {
    seerEl.addEventListener("change", () => {
      const id = seerEl.value || null;
      state.nightActions.seerCheck = id;
      if (!id) return;
      const t = findPlayer(id);
      if (!t) return;
      const res = (t.role === ROLES.WEREWOLF) ? "SÓI" : "KHÔNG PHẢI SÓI";
      addLog(`🔮 Tiên tri soi <b>${escapeHtml(t.name)}</b> → <span class="${t.role === ROLES.WEREWOLF ? "bad" : "ok"}">${res}</span>`, "info");
    });
  }
}

/* ---------------- Day panel + vote timer ---------------- */
function renderDayPanel() {
  const panel = $("dayPanel");
  if (!state.started) {
    panel.innerHTML = `<div class="hint">Chưa bắt đầu. Hãy thêm người chơi.</div>`;
    return;
  }
  if (state.phase !== "day") {
    panel.innerHTML = `<div class="hint">Đang không phải pha Ngày.</div>`;
    return;
  }

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

      <div class="hint">Kết thúc vote sẽ xử lý Hoàng tử (lộ role + thoát 1 lần).</div>
    </div>
  `;

  // vote selection
  const dd = document.getElementById("dd_dayVote");
  dd.addEventListener("change", () => state.dayVote = dd.value || null);

  // set duration
  const secInp = $("voteSeconds");
  secInp.addEventListener("change", () => {
    const s = Math.max(10, parseInt(secInp.value || "60", 10));
    state.voteTimer.durationSec = s;
  });

  // start timer
  $("btnStartVoteTimer").addEventListener("click", () => startVoteTimer());

  // end vote now
  $("btnEndVote").addEventListener("click", () => endVoteNow(false));

  // ensure ticking UI if running
  if (state.voteTimer.running && !voteInterval) {
    attachVoteInterval();
  }
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
  // do not stopVoteTimer() here because it would reset endsAt
  if (voteInterval) clearInterval(voteInterval);

  voteInterval = setInterval(() => {
    const remain = getVoteRemainingSec();
    const el = $("voteRemain");
    if (el) el.textContent = formatSec(remain);

    if (remain <= 0) {
      endVoteNow(true);
    }
  }, 250);
}

function endVoteNow(auto) {
  if (state.phase !== "day") return;
  stopVoteTimer();
  addLog(auto ? "⏱️ Hết giờ vote → kết thúc vote." : "🛑 Kết thúc vote.", "warn");

  if (state.dayVote) {
    resolveVote();
  } else {
    addLog("Không có người bị vote → bỏ qua.", "warn");
  }

  renderAll();
}

/* ---------------- Resolve logic ---------------- */
function killPlayer(id, reason) {
  const p = findPlayer(id);
  if (!p || !p.alive) return;
  p.alive = false;
  addLog(reason, "bad");
}

function resolveNight() {
  const a = state.nightActions;

  // constraints
  if (a.guardProtect && a.guardProtect === state.constraints.lastGuardProtect) {
    addLog("🛡️ Guard bảo vệ trùng lặp liên tiếp → bỏ chọn.", "warn");
    a.guardProtect = null;
  }
  if (a.sorcererMute && a.sorcererMute === state.constraints.lastSorcererMute) {
    addLog("🤫 Pháp sư mute trùng lặp liên tiếp → bỏ chọn.", "warn");
    a.sorcererMute = null;
  }

  // mute record
  if (a.sorcererMute) {
    const t = findPlayer(a.sorcererMute);
    if (t) {
      addLog(`🤫 Pháp sư mute <b>${escapeHtml(t.name)}</b> (câm trong ngày ${state.day + 1})`, "warn");
      state.constraints.lastSorcererMute = a.sorcererMute;
    }
  }

  // wolf victim
  let wolfVictim = a.wolfTarget ? findPlayer(a.wolfTarget) : null;
  if (wolfVictim && !wolfVictim.alive) wolfVictim = null;

  // guard protect
  const protectedId = a.guardProtect || null;
  if (protectedId) state.constraints.lastGuardProtect = protectedId;

  // witch heal
  let healed = false;
  if (a.witchHeal && wolfVictim && state.resources.witchHealLeft > 0 && a.witchHeal === wolfVictim.id) {
    healed = true;
    state.resources.witchHealLeft -= 1;
    addLog(`🧪 Phù thủy dùng bình CỨU cứu <b>${escapeHtml(wolfVictim.name)}</b>`, "ok");
  }

  // witch poison
  let poisonTarget = null;
  if (a.witchPoison && state.resources.witchPoisonLeft > 0) {
    poisonTarget = findPlayer(a.witchPoison);
    if (poisonTarget && poisonTarget.alive) {
      state.resources.witchPoisonLeft -= 1;
      addLog(`🧪 Phù thủy dùng bình GIẾT lên <b>${escapeHtml(poisonTarget.name)}</b>`, "bad");
    } else poisonTarget = null;
  }

  // gambler (night 2+)
  if (state.night >= 2 && a.gamblerBet) {
    const bet = findPlayer(a.gamblerBet);
    const gambler = alivePlayers().find(p => p.role === ROLES.GAMBLER);
    if (bet && bet.alive && gambler && gambler.alive) {
      if (bet.role === ROLES.WEREWOLF) {
        killPlayer(bet.id, `🎲 Con bạc cược TRÚNG Sói → <b>${escapeHtml(bet.name)}</b> chết`);
      } else {
        killPlayer(gambler.id, `🎲 Con bạc cược SAI → <b>${escapeHtml(gambler.name)}</b> chết`);
      }
    }
  }

  // apply wolf kill
  if (wolfVictim) {
    const isProtected = protectedId && wolfVictim.id === protectedId;
    if (isProtected) {
      addLog(`🛡️ Guard bảo vệ <b>${escapeHtml(wolfVictim.name)}</b> → không chết`, "ok");
    } else if (healed) {
      addLog(`✅ Nạn nhân được cứu → không chết`, "ok");
    } else {
      killPlayer(wolfVictim.id, `🐺 Sói cắn chết <b>${escapeHtml(wolfVictim.name)}</b>`);
    }
  } else {
    addLog("🐺 Sói không chọn nạn nhân (hoặc không còn Sói).", "warn");
  }

  // poison kill last
  if (poisonTarget && poisonTarget.alive) {
    killPlayer(poisonTarget.id, `🧪 Bình độc giết <b>${escapeHtml(poisonTarget.name)}</b>`);
  }

  checkWin();
}

function resolveVote() {
  const voteId = state.dayVote || null;
  if (!voteId) {
    addLog("Chưa chọn ai để vote.", "warn");
    return;
  }
  const t = findPlayer(voteId);
  if (!t || !t.alive) {
    addLog("Vote không hợp lệ.", "warn");
    return;
  }

  // Prince: reveal + survive once
  if (t.role === ROLES.PRINCE) {
    if (!t.princeSavedOnce) {
      t.princeSavedOnce = true;
      t.trueRoleRevealed = true;
      addLog(`👑 Vote trúng <b>${escapeHtml(t.name)}</b> → lộ role <b>HOÀNG TỬ</b> và thoát chết 1 lần!`, "warn");
      state.dayVote = null;
      checkWin();
      return;
    }
  }

  killPlayer(t.id, `🗳️ Bị treo cổ: <b>${escapeHtml(t.name)}</b>`);
  state.dayVote = null;
  checkWin();
}

function checkWin() {
  const aliveW = wolves().length;
  const aliveTotal = alivePlayers().length;
  const aliveV = aliveTotal - aliveW;

  if (!state.started) return;

  if (aliveW <= 0) {
    addLog(`🏁 <span class="ok">DÂN THẮNG!</span> (Không còn Sói sống)`, "ok");
    return;
  }
  if (aliveW >= aliveV) {
    addLog(`🏁 <span class="bad">SÓI THẮNG!</span> (Sói >= Dân)`, "bad");
    return;
  }
}

/* ---------------- Players rendering + dialog ---------------- */
const dlg = $("dlgRole");
$("dlgClose")?.addEventListener("click", () => dlg.close());

function openRoleDialog(p) {
  $("dlgTitle").textContent = `${p.name}`;
  $("dlgBody").innerHTML = `
    <div><b>Role:</b> ${escapeHtml(p.role)}</div>
    <div class="tiny muted" style="margin-top:8px">(Chỉ host thấy.)</div>
  `;
  dlg.showModal();
}

function renderPlayers() {
  const box = $("playersList");
  if (state.players.length === 0) {
    box.innerHTML = `<div class="hint">Chưa có người chơi.</div>`;
    return;
  }

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

/* ---------------- Render common ---------------- */
function renderPhasePill() {
  const map = {
    setup: "Chưa bắt đầu",
    night: `Đêm ${state.night}`,
    day: `Ngày ${state.day}`,
  };
  $("phasePill").textContent = map[state.phase] || state.phase;
}

function renderLog() {
  const box = $("logBox");
  if (state.log.length === 0) {
    box.innerHTML = `<div class="hint">Chưa có log.</div>`;
    return;
  }
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
