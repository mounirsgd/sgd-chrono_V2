import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase, ref, set, get, onValue, remove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAqsZ2CB7iHaAvmaUGNVhkXPYo4sZeREMM",
  authDomain: "sgd-chrono-v2.firebaseapp.com",
  databaseURL: "https://sgd-chrono-v2-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "sgd-chrono-v2",
  storageBucket: "sgd-chrono-v2.firebasestorage.app",
  messagingSenderId: "1078531383655",
  appId: "1:1078531383655:web:9f4d7d5e5ee3b85aa74fc2"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);

const TASK_COLORS = [
  "#3b82f6","#8b5cf6","#06b6d4","#22c55e","#f97316",
  "#ec4899","#14b8a6","#a855f7","#0ea5e9","#84cc16",
  "#6366f1","#10b981","#eab308","#64748b","#d946ef"
];

const TASKS_BOUT_CHAUD = [
  {id:"ron_1", machine:"Nettoyage de machine", qui:"Production"},
  {id:"ron_2", machine:"Changement rondelle (cuvette)", qui:"Feederman"},
  {id:"ron_3", machine:"Cote Finisseur", qui:"Atelier IS"},
  {id:"ron_4", machine:"Cote Ebaucheur", qui:"Atelier IS"},
  {id:"ron_5", machine:"Entonnoir sous verre", qui:"Feederman"},
  {id:"ron_6", machine:"Distributeur sous verre", qui:"Feederman"},
  {id:"ron_7", machine:"Demarrage section sans flacon", qui:"Chef de section"},
  {id:"ron_8", machine:"Debut section avec flacon", qui:"Chef de section"},
  {id:"ron_9", machine:"Machine complete avec flacon", qui:"Chef de section"},
  {id:"ron_10", machine:"Mise a l arche", qui:"Chef de section"}
];

const TASKS_BOUT_FROID = [
  {id:"bf_1", machine:"T0 : Duree nettoyage", qui:"Production", color:"#f1c40f", labelDebut:"Aligneur vide", labelFin:"Heur valid. vide de ligne"},
  {id:"bf_2", machine:"T1 : Duree pre-reglage", qui:"Automation", color:"#64748b", labelDebut:"Debut reglage automation", labelFin:"Fin reglage de base machine"},
  {id:"bf_3", machine:"T2 : Monte en regime", qui:"Automation", color:"#795548", labelDebut:"Top qualite", labelFin:"Val. 2 lots commercialisable"},
  {id:"bf_4", machine:"T1\u2019 : Arrivee 2 section controlable", qui:"Automation", color:"#2e86ab", labelDebut:"Arrivee deux sections", labelFin:"Arrivee toutes sections"}
];

const BOUT_FROID_COLOR = "#2e86ab";
const MAX_SLOTS = 4;
const HISTORY_PAGE_SIZE = 5;

let allSessions = {};
let ganttData = {
  targets:{grand_t1:{},petit_t1:{},rondelle:{}},
  tasks:{}, tasks2:{}, extraTasks:[], extraTasks2:[],
  bc2Active: false
};
let selectedIds = [];
let allTasks = {};
let historyPage = 0;
let ganttQuiOverrides = {};
let justifications = [];
let appReady = false;
let bc2Active = false;

// ── AUTH ──────────────────────────────────────────────────────────────────────

document.getElementById("login-btn").addEventListener("click", async function() {
  var email = document.getElementById("login-email").value.trim();
  var password = document.getElementById("login-pass").value.trim();
  if (!email || !password) { showLoginError("Veuillez remplir les deux champs."); return; }
  var btn = document.getElementById("login-btn");
  btn.textContent = "Connexion..."; btn.disabled = true;
  try {
    var result = await signInWithEmailAndPassword(auth, email, password);
    afficherApp(result.user);
  } catch (err) {
    btn.textContent = "Se connecter"; btn.disabled = false;
    showLoginError(translateAuthError(err.code));
  }
});

["login-email","login-pass"].forEach(function(id) {
  document.getElementById(id).addEventListener("keydown", function(e) {
    if (e.key === "Enter") document.getElementById("login-btn").click();
  });
});

document.getElementById("logout-btn").addEventListener("click", function() {
  signOut(auth); appReady = false;
  document.getElementById("app").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
  var btn = document.getElementById("login-btn");
  btn.textContent = "Se connecter"; btn.disabled = false;
  document.getElementById("login-error").style.display = "none";
});

onAuthStateChanged(auth, function(user) {
  if (user && document.getElementById("app").style.display !== "block") afficherApp(user);
  else if (!user) {
    document.getElementById("login-screen").style.display = "flex";
    document.getElementById("app").style.display = "none";
  }
});

function afficherApp(user) {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("user-label").textContent = user.email;
  if (!appReady) { appReady = true; initApp(); }
}

function showLoginError(msg) {
  var el = document.getElementById("login-error");
  el.textContent = msg; el.style.display = "block";
}

function translateAuthError(code) {
  var m = {
    "auth/invalid-email": "Identifiant invalide.",
    "auth/user-not-found": "Identifiant introuvable.",
    "auth/wrong-password": "Mot de passe incorrect.",
    "auth/invalid-credential": "Identifiant ou mot de passe incorrect.",
    "auth/too-many-requests": "Trop de tentatives.",
    "auth/network-request-failed": "Erreur reseau."
  };
  return m[code] || "Erreur : " + code;
}

// ── INIT ──────────────────────────────────────────────────────────────────────

function initApp() {
  ganttData = { targets:{grand_t1:{},petit_t1:{},rondelle:{}}, tasks:{}, tasks2:{}, extraTasks:[], extraTasks2:[], bc2Active:false };
  selectedIds = []; ganttQuiOverrides = {}; justifications = []; bc2Active = false;

  var dateField = document.getElementById("f-date");
  if (dateField && !dateField.value) dateField.value = new Date().toISOString().slice(0,10);
  setInterval(function() {
    var d = document.getElementById("f-date");
    if (d && !d.value) d.value = new Date().toISOString().slice(0,10);
  }, 60000);

  document.getElementById("f-machine-name").value = "";
  document.getElementById("gantt-container").innerHTML = '<div class="empty-gantt">Remplissez le formulaire et enregistrez pour afficher le Gantt</div>';

  buildForm();

  onValue(ref(db, "sessions"), function(snap) {
    allSessions = snap.val() || {};
    renderHistory(allSessions);
    document.getElementById("sync-status").textContent = "Connecte";
    var gs = document.getElementById("gantt-section");
    if (gs && gs.style.display !== "none") {
      var arr = Object.values(allSessions).sort(function(a,b){ return (b.savedAt||0)-(a.savedAt||0); });
      if (arr.length > 0 && arr[0] && arr[0].ganttData) {
        renderGantt(arr[0].date, arr[0].machine, arr[0].ganttData);
      }
    }
  });

  document.getElementById("save-btn").addEventListener("click", saveSession);
  document.getElementById("new-session-btn").addEventListener("click", newSession);
  document.getElementById("del-all-btn").addEventListener("click", deleteAllHistory);
  document.getElementById("do-compare-btn").addEventListener("click", doCompare);
  document.getElementById("close-compare-btn").addEventListener("click", closeCompare);
  document.getElementById("do-justif-btn").addEventListener("click", openJustifDialog);
  document.getElementById("toggle-bc2-btn").addEventListener("click", toggleBC2);
  initExportButtons();

  var TT = document.getElementById("tooltip");
  document.addEventListener("mousemove", function(e) {
    if (!TT.classList.contains("visible")) return;
    var x = e.clientX+16, y = e.clientY+16;
    if (x+310 > window.innerWidth) x = e.clientX-310;
    if (y+230 > window.innerHeight) y = e.clientY-230;
    TT.style.left = x+"px"; TT.style.top = y+"px";
  });
}

// ── TOGGLE BOUT CHAUD 2 ───────────────────────────────────────────────────────

function toggleBC2() {
  bc2Active = !bc2Active;
  var btn = document.getElementById("toggle-bc2-btn");
  var sec = document.getElementById("bc2-section");
  if (bc2Active) {
    btn.textContent = "Desactiver Bout Chaud 2";
    btn.style.background = "#e74c3c";
    sec.style.display = "block";
  } else {
    btn.textContent = "+ Activer Bout Chaud 2";
    btn.style.background = "#27ae60";
    sec.style.display = "none";
  }
}

// ── SYSTEME DE CRENEAUX ───────────────────────────────────────────────────────

function buildSlotSystem(holder, container, savedSlots, labelDebut, labelFin) {
  holder._slots = [];
  var slotsWrap = document.createElement("div");
  slotsWrap.className = "task-row-times";

  var addBtn = document.createElement("button");
  addBtn.className = "btn-add-slot"; addBtn.textContent = "+";

  var removeBtn = document.createElement("button");
  removeBtn.className = "btn-add-slot"; removeBtn.textContent = "-";
  removeBtn.style.background = "#e74c3c";
  removeBtn.style.display = "none";

  function refreshBtns() {
    var n = holder._slots.length;
    addBtn.style.display = n >= MAX_SLOTS ? "none" : "";
    removeBtn.style.display = n <= 1 ? "none" : "";
  }

  function addSlot(sh, sm, eh, em, comment) {
    var n = holder._slots.length;
    if (n > 0) {
      var sep = document.createElement("span");
      sep.className = "slot-sep";
      sep.style.cssText = "font-size:11px;color:#6c6c70;margin:0 4px;";
      sep.textContent = "puis";
      slotsWrap.insertBefore(sep, addBtn);
    }
    var slotEl = makeSlotRow(sh||"", sm||"", eh||"", em||"", n===0?labelDebut:null, n===0?labelFin:null);
    slotsWrap.insertBefore(slotEl, addBtn);

    var cmtTA = makeTextarea("Commentaire creneau "+(n+1)+"...", comment||"");
    var cmtWrap = document.createElement("div"); cmtWrap.className = "task-comment-wrap";
    cmtWrap.appendChild(cmtTA);
    container.appendChild(cmtWrap);

    holder._slots.push({slotEl:slotEl, cmtTA:cmtTA, cmtWrap:cmtWrap});
    refreshBtns();
  }

  function removeLastSlot() {
    if (holder._slots.length <= 1) return;
    var last = holder._slots.pop();
    last.slotEl.remove(); last.cmtWrap.remove();
    var seps = slotsWrap.querySelectorAll("span.slot-sep");
    if (seps.length > 0) seps[seps.length-1].remove();
    refreshBtns();
  }

  addBtn.addEventListener("click", function() { addSlot("","","",""); });
  removeBtn.addEventListener("click", removeLastSlot);
  slotsWrap.appendChild(addBtn);
  slotsWrap.appendChild(removeBtn);

  if (savedSlots && savedSlots.length > 0) {
    savedSlots.forEach(function(s) { addSlot(s.sh, s.sm, s.eh, s.em, s.comment); });
  } else {
    addSlot("","","","");
  }

  return slotsWrap;
}

function readSlots(holder) {
  var d = {};
  if (!holder._slots) return d;
  var keys = [
    ["sh","sm","eh","em","comment"],
    ["sh2","sm2","eh2","em2","comment2"],
    ["sh3","sm3","eh3","em3","comment3"],
    ["sh4","sm4","eh4","em4","comment4"]
  ];
  holder._slots.forEach(function(s, i) {
    if (i >= keys.length) return;
    var k = keys[i];
    d[k[0]] = s.slotEl._sF._getH();
    d[k[1]] = s.slotEl._sF._getM();
    d[k[2]] = s.slotEl._eF._getH();
    d[k[3]] = s.slotEl._eF._getM();
    d[k[4]] = s.cmtTA.value;
  });
  return d;
}

function getSavedSlots(obj) {
  var slots = [{sh:obj.sh, sm:obj.sm, eh:obj.eh, em:obj.em, comment:obj.comment||""}];
  if (obj.sh2||obj.eh2) slots.push({sh:obj.sh2, sm:obj.sm2, eh:obj.eh2, em:obj.em2, comment:obj.comment2||""});
  if (obj.sh3||obj.eh3) slots.push({sh:obj.sh3, sm:obj.sm3, eh:obj.eh3, em:obj.em3, comment:obj.comment3||""});
  if (obj.sh4||obj.eh4) slots.push({sh:obj.sh4, sm:obj.sm4, eh:obj.eh4, em:obj.em4, comment:obj.comment4||""});
  return slots;
}

// ── FORMULAIRE ────────────────────────────────────────────────────────────────

function buildForm() {
  var container = document.getElementById("form-sections");
  container.innerHTML = "";

  // TARGETS
  var targetsGroup = document.createElement("div");
  targetsGroup.style.cssText = "background:#f0f2f5;border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px;margin-bottom:4px;";
  targetsGroup.appendChild(buildTargetSection("grand_t1","TARGET (Grand T1)","#c0392b",ganttData.targets.grand_t1||{}));
  targetsGroup.appendChild(buildTargetSection("petit_t1","TARGET (Petit t1)","#e07b54",ganttData.targets.petit_t1||{}));
  targetsGroup.appendChild(buildTargetSection("rondelle","TARGET (Rondelle)","#7d3c98",ganttData.targets.rondelle||{}));
  container.appendChild(targetsGroup);

  // BOUT CHAUD 1
  var bc1Sec = document.createElement("div");
  bc1Sec.className = "tasks-sec"; bc1Sec.style.borderColor = "#1a3a6b";
  var bc1Hd = document.createElement("div");
  bc1Hd.className = "tasks-sec-hd"; bc1Hd.style.background = "#1a3a6b";
  bc1Hd.textContent = "BOUT CHAUD 1";
  bc1Sec.appendChild(bc1Hd);
  bc1Sec._taskFields = {}; bc1Sec._extraFields = [];
  TASKS_BOUT_CHAUD.forEach(function(task, idx) {
    var tv = ganttData.tasks[task.id] || {};
    appendTaskRow(bc1Sec, task.id, task.machine, task.qui, tv, TASK_COLORS[idx % TASK_COLORS.length]);
  });
  appendExtraTasksSection(bc1Sec, ganttData.extraTasks||[], "bc1");
  container.appendChild(bc1Sec);
  container._bc1Sec = bc1Sec;

  // TOGGLE BOUT CHAUD 2 - deja dans le HTML, juste mise a jour de l'etat
  var bc2Sec = document.getElementById("bc2-section");
  if (bc2Sec) {
    bc2Sec.innerHTML = "";
    var bc2Inner = document.createElement("div");
    bc2Inner.className = "tasks-sec"; bc2Inner.style.borderColor = "#c0392b";
    var bc2Hd = document.createElement("div");
    bc2Hd.className = "tasks-sec-hd"; bc2Hd.style.background = "#c0392b";
    bc2Hd.textContent = "BOUT CHAUD 2";
    bc2Inner.appendChild(bc2Hd);
    bc2Inner._taskFields = {}; bc2Inner._extraFields = [];
    TASKS_BOUT_CHAUD.forEach(function(task, idx) {
      var tv = ganttData.tasks2 ? (ganttData.tasks2[task.id] || {}) : {};
      appendTaskRow(bc2Inner, task.id, task.machine, task.qui, tv, TASK_COLORS[idx % TASK_COLORS.length]);
    });
    appendExtraTasksSection(bc2Inner, ganttData.extraTasks2||[], "bc2");
    bc2Sec.appendChild(bc2Inner);
    container._bc2Sec = bc2Inner;
  }

  // BOUT FROID
  var bfSec = document.createElement("div");
  bfSec.className = "tasks-sec"; bfSec.style.borderColor = BOUT_FROID_COLOR;
  var bfHd = document.createElement("div");
  bfHd.className = "tasks-sec-hd"; bfHd.style.background = BOUT_FROID_COLOR;
  bfHd.textContent = "BOUT FROID";
  bfSec.appendChild(bfHd);
  bfSec._taskFields = {}; bfSec._extraFields = [];
  TASKS_BOUT_FROID.forEach(function(task) {
    var tv = ganttData.tasks[task.id] || {};
    tv._labelDebut = task.labelDebut; tv._labelFin = task.labelFin;
    appendTaskRow(bfSec, task.id, task.machine, task.qui, tv, task.color);
  });
  container.appendChild(bfSec);
  container._bfSec = bfSec;
  container._tasksSec = bc1Sec;
}

function appendExtraTasksSection(sec, savedExtras, prefix) {
  savedExtras.forEach(function(et) {
    var color = et.color || TASK_COLORS[Math.floor(Math.random()*TASK_COLORS.length)];
    appendExtraTaskRow(sec, et, color, prefix);
  });

  var addBtn = document.createElement("button");
  addBtn.className = "btn-add-task"; addBtn.textContent = "+ Ajouter une tache";
  addBtn.addEventListener("click", function() {
    var existing = document.getElementById("add-task-popup-"+prefix);
    if (existing) { existing.remove(); return; }
    var popup = document.createElement("div");
    popup.id = "add-task-popup-"+prefix;
    popup.style.cssText = "background:#fff;border:1.5px solid #1a3a6b;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.15);padding:10px;margin:6px 0;display:flex;gap:10px;";
    var btnBC = document.createElement("button");
    btnBC.textContent = "Bout Chaud";
    btnBC.style.cssText = "flex:1;padding:10px;background:#f97316;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:Arial,sans-serif;";
    btnBC.addEventListener("click", function() {
      var idx = sec._extraFields.length;
      var color = TASK_COLORS[(TASKS_BOUT_CHAUD.length + idx) % TASK_COLORS.length];
      appendExtraTaskRow(sec, {group:"boutchaud"}, color, prefix);
      popup.remove();
    });
    var btnBF = document.createElement("button");
    btnBF.textContent = "Bout Froid";
    btnBF.style.cssText = "flex:1;padding:10px;background:"+BOUT_FROID_COLOR+";color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:Arial,sans-serif;";
    btnBF.addEventListener("click", function() {
      var bfColors = ["#f1c40f","#64748b","#795548","#2e86ab"];
      var idx = sec._extraFields.filter(function(f){return f.group==="boutfroid";}).length;
      appendExtraTaskRow(sec, {group:"boutfroid"}, bfColors[idx%4], prefix);
      popup.remove();
    });
    popup.appendChild(btnBC); popup.appendChild(btnBF);
    sec.insertBefore(popup, addBtn);
  });
  sec.appendChild(addBtn);
}

function buildTargetSection(key, label, color, saved) {
  var sec = document.createElement("div"); sec.className = "tasks-sec"; sec.style.borderColor = color;
  var hd = document.createElement("div"); hd.className = "tasks-sec-hd"; hd.style.background = color;
  hd.textContent = label; sec.appendChild(hd);
  var cmtContainer = document.createElement("div");
  var slotsWrap = buildSlotSystem(sec, cmtContainer, getSavedSlots(saved));
  slotsWrap.style.padding = "10px 12px";
  sec.appendChild(slotsWrap); sec.appendChild(cmtContainer);
  sec.dataset.targetKey = key;
  return sec;
}

function appendTaskRow(sec, taskId, machineName, quiDefault, tv, color) {
  var row = document.createElement("div"); row.className = "task-row";
  var top = document.createElement("div"); top.className = "task-row-top";
  var colorBar = document.createElement("div"); colorBar.className = "task-color-bar"; colorBar.style.background = color;
  var lbl = document.createElement("span"); lbl.className = "task-row-label"; lbl.textContent = machineName;
  var who = document.createElement("span"); who.className = "task-row-who"; who.textContent = quiDefault;
  top.appendChild(colorBar); top.appendChild(lbl); top.appendChild(who);
  row.appendChild(top);
  var cmtContainer = document.createElement("div");
  var slotsWrap = buildSlotSystem(row, cmtContainer, getSavedSlots(tv), tv._labelDebut, tv._labelFin);
  row.appendChild(slotsWrap); row.appendChild(cmtContainer);
  sec._taskFields[taskId] = {color:color, row:row};
  sec.appendChild(row);
}

function appendExtraTaskRow(sec, et, color, prefix) {
  var row = document.createElement("div"); row.className = "task-row";
  var top = document.createElement("div"); top.className = "task-row-top";
  var colorBar = document.createElement("div"); colorBar.className = "task-color-bar"; colorBar.style.background = color;
  var nameInp = document.createElement("input"); nameInp.type = "text"; nameInp.value = et.machine||"";
  nameInp.placeholder = "Nom de la tache";
  nameInp.style.cssText = "flex:1;border:none;background:transparent;font-size:13px;font-weight:700;color:#1c1c1e;font-family:Arial,sans-serif;outline:none;";
  var whoInp = document.createElement("input"); whoInp.type = "text"; whoInp.value = et.qui||"";
  whoInp.placeholder = "Qui";
  whoInp.style.cssText = "font-size:11px;color:#6c6c70;background:#f7f7f8;padding:2px 8px;border-radius:6px;border:1px solid #e0e0e5;width:100px;outline:none;font-family:Arial,sans-serif;";
  var delBtn = document.createElement("button"); delBtn.className = "btn-del-task"; delBtn.textContent = "Supprimer";
  delBtn.addEventListener("click", function() {
    row.remove();
    sec._extraFields = sec._extraFields.filter(function(f) { return f.row !== row; });
    autoSaveExtras(sec, prefix);
  });
  top.appendChild(colorBar); top.appendChild(nameInp); top.appendChild(whoInp); top.appendChild(delBtn);
  row.appendChild(top);
  var cmtContainer = document.createElement("div");
  var slotsWrap = buildSlotSystem(row, cmtContainer, getSavedSlots(et));
  row.appendChild(slotsWrap); row.appendChild(cmtContainer);
  row._nameInp = nameInp; row._whoInp = whoInp;
  var etGroup = et.group || "boutchaud";
  sec._extraFields.push({color:color, row:row, group:etGroup});
  sec.appendChild(row);
}

// ── CHAMPS TEMPS ──────────────────────────────────────────────────────────────

function makeSlotRow(sh, sm, eh, em, labelDebut, labelFin) {
  var wrap = document.createElement("div"); wrap.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;";
  var sGrp = document.createElement("div"); sGrp.className = "time-group";
  var sLbl = document.createElement("label"); sLbl.textContent = labelDebut||"Debut";
  var sF = makeTimeField(sh, sm);
  sGrp.appendChild(sLbl); sGrp.appendChild(sF);
  var eGrp = document.createElement("div"); eGrp.className = "time-group";
  var eLbl = document.createElement("label"); eLbl.textContent = labelFin||"Fin";
  var eF = makeTimeField(eh, em);
  eGrp.appendChild(eLbl); eGrp.appendChild(eF);
  var prev = document.createElement("span"); prev.className = "time-preview";
  function updPrev() {
    var s=getTV(sF._getH(),sF._getM()), e=getTV(eF._getH(),eF._getM());
    prev.textContent = s&&e ? s+" -> "+e : s ? s+" -> ?" : "";
  }
  sF.addEventListener("input",updPrev); eF.addEventListener("input",updPrev); updPrev();
  wrap.appendChild(sGrp); wrap.appendChild(eGrp); wrap.appendChild(prev);
  wrap._sF = sF; wrap._eF = eF;
  return wrap;
}

function makeTimeField(hVal, mVal) {
  var wrap = document.createElement("div"); wrap.className = "time-field";
  var hInp = document.createElement("input"); hInp.className = "h-inp"; hInp.inputMode = "numeric"; hInp.maxLength = 2; hInp.placeholder = "H"; hInp.value = hVal||"";
  var sep = document.createElement("span"); sep.className = "time-field-sep"; sep.textContent = ":";
  var mInp = document.createElement("input"); mInp.className = "m-inp"; mInp.inputMode = "numeric"; mInp.maxLength = 2; mInp.placeholder = "mm"; mInp.value = mVal||"";
  hInp.addEventListener("input", function() {
    this.value = this.value.replace(/\D/g,"").slice(0,2);
    if (this.value.length===2) { if(parseInt(this.value)>23) this.value="23"; mInp.focus(); }
  });
  hInp.addEventListener("blur", function() {
    if (this.value !== "") { var v=parseInt(this.value); if(v>23)this.value="23"; if(v<0)this.value="0"; }
  });
  mInp.addEventListener("input", function() {
    this.value = this.value.replace(/\D/g,"").slice(0,2);
    if (this.value.length===2 && parseInt(this.value)>59) this.value="59";
  });
  mInp.addEventListener("blur", function() {
    if (this.value !== "") { var v=parseInt(this.value); if(v>59)this.value="59"; if(v<0)this.value="0"; }
  });
  wrap.appendChild(hInp); wrap.appendChild(sep); wrap.appendChild(mInp);
  wrap._getH = function() { return hInp.value; };
  wrap._getM = function() { return mInp.value; };
  return wrap;
}

function makeTextarea(placeholder, value) {
  var ta = document.createElement("textarea");
  ta.placeholder = placeholder; ta.value = value||""; ta.rows = 1;
  function resize() { ta.style.height="auto"; ta.style.height=ta.scrollHeight+"px"; }
  ta.addEventListener("input", resize); setTimeout(resize, 0);
  return ta;
}

function getTV(h, m) {
  if (!h) return "";
  var hv=parseInt(h), mv=parseInt(m)||0;
  if (isNaN(hv)||hv<0||hv>23||mv<0||mv>59) return "";
  return hv+":"+(mv<10?"0"+mv:mv);
}

function toMin(s) { if(!s||!s.includes(":")) return null; var p=s.split(":").map(Number); return p[0]*60+(p[1]||0); }
function fmtDur(s,e) { var d=e-s; if(d<=0) return "--"; var h=Math.floor(d/60),m=d%60; return h&&m?h+"h "+m+"min":h?h+"h":m+"min"; }
function encCmt(str) { if(!str) return ""; return str.replace(/\\/g,"\\\\").replace(/'/g,"&#39;").replace(/"/g,"&quot;").replace(/\n/g,"\\n"); }

// ── COLLECTE ──────────────────────────────────────────────────────────────────

function collectData() {
  var container = document.getElementById("form-sections");
  var out = { targets:{}, tasks:{}, tasks2:{}, extraTasks:[], extraTasks2:[], bc2Active:bc2Active };

  ["grand_t1","petit_t1","rondelle"].forEach(function(key) {
    var sec = container.querySelector('[data-target-key="'+key+'"]');
    if (!sec) return;
    out.targets[key] = readSlots(sec);
  });

  var bc1Sec = container._bc1Sec;
  if (bc1Sec) {
    TASKS_BOUT_CHAUD.forEach(function(task) {
      var f = bc1Sec._taskFields[task.id]; if (!f) return;
      out.tasks[task.id] = readSlots(f.row);
    });
    TASKS_BOUT_FROID.forEach(function(task) {
      var f = container._bfSec ? container._bfSec._taskFields[task.id] : null; if (!f) return;
      out.tasks[task.id] = readSlots(f.row);
    });
    bc1Sec._extraFields.forEach(function(et) {
      var name = et.row._nameInp ? et.row._nameInp.value.trim() : "";
      if (!name) return;
      var d = readSlots(et.row);
      d.machine = name; d.qui = et.row._whoInp ? et.row._whoInp.value.trim() : "";
      d.group = et.group || "boutchaud"; d.color = et.color || "";
      out.extraTasks.push(d);
    });
  }

  if (bc2Active && container._bc2Sec) {
    TASKS_BOUT_CHAUD.forEach(function(task) {
      var f = container._bc2Sec._taskFields[task.id]; if (!f) return;
      out.tasks2[task.id] = readSlots(f.row);
    });
    container._bc2Sec._extraFields.forEach(function(et) {
      var name = et.row._nameInp ? et.row._nameInp.value.trim() : "";
      if (!name) return;
      var d = readSlots(et.row);
      d.machine = name; d.qui = et.row._whoInp ? et.row._whoInp.value.trim() : "";
      d.group = et.group || "boutchaud"; d.color = et.color || "";
      out.extraTasks2.push(d);
    });
  }

  return out;
}

// ── SAUVEGARDE ────────────────────────────────────────────────────────────────

async function saveSession() {
  var data = collectData();
  var date = document.getElementById("f-date").value;
  var machine = document.getElementById("f-machine-name").value.trim();
  if (!date || !machine) { alert("Veuillez remplir la date et la machine."); return; }

  var dl = new Date(date+"T00:00:00").toLocaleDateString("fr-FR",{weekday:"short",day:"2-digit",month:"short",year:"numeric"});
  var existingId = window._editingSessionId;
  if (!existingId) {
    var existing = Object.entries(allSessions).find(function(e) { return e[1].date===date && e[1].machine===machine; });
    if (existing) existingId = existing[0];
  }
  var sessId = existingId || "sess_"+Date.now();
  await set(ref(db,"sessions/"+sessId), { date:date, machine:machine, ganttData:data, title:machine+" - "+dl, savedAt:Date.now() });
  window._editingSessionId = sessId;

  showToast("Seance enregistree !", "#34c759");
  renderGantt(date, machine, data);
  setTimeout(function() { document.getElementById("gantt-section").scrollIntoView({behavior:"smooth"}); }, 100);
  document.getElementById("f-machine-name").value = machine;
  document.getElementById("f-date").value = date;
}

async function autoSaveExtras(sec, prefix) {
  var date = document.getElementById("f-date").value;
  var machine = document.getElementById("f-machine-name").value.trim();
  if (!date || !machine) return;
  var existing = Object.entries(allSessions).find(function(e) { return e[1].date===date && e[1].machine===machine; });
  if (!existing) return;
  var data = collectData();
  await set(ref(db,"sessions/"+existing[0]+"/ganttData"), data);
  showToast("Tache supprimee !", "#e74c3c");
}

async function newSession() {
  if (!confirm("Repartir a zero ?")) return;
  justifications = []; window._editingSessionId = null; bc2Active = false;
  document.getElementById("f-date").value = new Date().toISOString().slice(0,10);
  document.getElementById("f-machine-name").value = "";
  ganttData = { targets:{grand_t1:{},petit_t1:{},rondelle:{}}, tasks:{}, tasks2:{}, extraTasks:[], extraTasks2:[], bc2Active:false };
  var btn = document.getElementById("toggle-bc2-btn");
  btn.textContent = "+ Activer Bout Chaud 2"; btn.style.background = "#27ae60";
  document.getElementById("bc2-section").style.display = "none";
  buildForm();
  document.getElementById("gantt-container").innerHTML = '<div class="empty-gantt">Remplissez le formulaire et enregistrez pour afficher le Gantt</div>';
  document.getElementById("gantt-section").style.display = "none";
}

// ── HISTORIQUE ────────────────────────────────────────────────────────────────

function renderHistory(sessions) {
  var list = document.getElementById("history-list");
  var arr = Object.entries(sessions).sort(function(a,b) {
    var da=a[1].date||"", db2=b[1].date||"";
    if (db2!==da) return db2>da?1:-1;
    return (b[1].savedAt||0)-(a[1].savedAt||0);
  });
  document.getElementById("history-count").textContent = arr.length ? arr.length+" seance(s)" : "";
  if (!arr.length) { list.innerHTML = '<div class="history-empty">Aucune seance enregistree</div>'; return; }

  var totalPages = Math.ceil(arr.length/HISTORY_PAGE_SIZE);
  if (historyPage >= totalPages) historyPage = totalPages-1;
  if (historyPage < 0) historyPage = 0;
  var pageArr = arr.slice(historyPage*HISTORY_PAGE_SIZE, (historyPage+1)*HISTORY_PAGE_SIZE);

  var html = pageArr.map(function(entry) {
    var id=entry[0], s=entry[1];
    var dl = s.date ? new Date(s.date+"T00:00:00").toLocaleDateString("fr-FR",{weekday:"short",day:"2-digit",month:"short",year:"numeric"}) : "";
    var bc2Badge = s.ganttData && s.ganttData.bc2Active ? '<span style="background:#c0392b;color:#fff;font-size:10px;padding:1px 6px;border-radius:4px;margin-left:6px;">BC2</span>' : '';
    return '<div class="history-item">'+
      '<div class="history-item-left">'+
      '<div class="history-item-title">'+(s.machine||"Seance")+bc2Badge+'</div>'+
      '<div class="history-item-sub">'+dl+'</div>'+
      '</div>'+
      '<div class="history-item-actions">'+
      '<span class="history-load-btn" data-load="'+id+'">Charger</span>'+
      '<span class="history-edit-btn" data-edit="'+id+'">Modifier</span>'+
      '<span class="history-del-btn" data-del="'+id+'">Supprimer</span>'+
      '</div></div>';
  }).join("");

  if (totalPages > 1) {
    html += '<div class="history-pagination">'+
      '<button class="history-page-btn" id="hist-prev" '+(historyPage===0?'disabled':'')+'>Precedent</button>'+
      '<span class="history-page-info">'+(historyPage+1)+' / '+totalPages+'</span>'+
      '<button class="history-page-btn" id="hist-next" '+(historyPage>=totalPages-1?'disabled':'')+'>Suivant</button>'+
      '</div>';
  }
  list.innerHTML = html;

  list.querySelectorAll("[data-load]").forEach(function(el) { el.addEventListener("click", function() { loadHistorySession(el.dataset.load); }); });
  list.querySelectorAll("[data-edit]").forEach(function(el) { el.addEventListener("click", function() { editHistorySession(el.dataset.edit); }); });
  list.querySelectorAll("[data-del]").forEach(function(el) { el.addEventListener("click", function() { deleteSession(el.dataset.del); }); });
  var pb=document.getElementById("hist-prev"), nb=document.getElementById("hist-next");
  if (pb) pb.addEventListener("click", function() { historyPage--; renderHistory(allSessions); });
  if (nb) nb.addEventListener("click", function() { historyPage++; renderHistory(allSessions); });
}

async function loadHistorySession(id) {
  var snap = await get(ref(db,"sessions/"+id));
  var d = snap.val(); if (!d) return;
  document.getElementById("f-date").value = d.date||"";
  document.getElementById("f-machine-name").value = d.machine||"";
  ganttData = d.ganttData || { targets:{grand_t1:{},petit_t1:{},rondelle:{}}, tasks:{}, tasks2:{}, extraTasks:[], extraTasks2:[], bc2Active:false };
  bc2Active = ganttData.bc2Active || false;
  window._editingSessionId = id;
  var btn = document.getElementById("toggle-bc2-btn");
  if (bc2Active) {
    btn.textContent = "Desactiver Bout Chaud 2"; btn.style.background = "#e74c3c";
    document.getElementById("bc2-section").style.display = "block";
  } else {
    btn.textContent = "+ Activer Bout Chaud 2"; btn.style.background = "#27ae60";
    document.getElementById("bc2-section").style.display = "none";
  }
  buildForm();
  renderGantt(d.date, d.machine, d.ganttData||{});
  setTimeout(function() { document.getElementById("gantt-section").scrollIntoView({behavior:"smooth"}); }, 200);
}

async function editHistorySession(id) {
  var snap = await get(ref(db,"sessions/"+id));
  var d = snap.val(); if (!d) return;
  document.getElementById("f-date").value = d.date||"";
  document.getElementById("f-machine-name").value = d.machine||"";
  ganttData = d.ganttData || { targets:{grand_t1:{},petit_t1:{},rondelle:{}}, tasks:{}, tasks2:{}, extraTasks:[], extraTasks2:[], bc2Active:false };
  bc2Active = ganttData.bc2Active || false;
  buildForm();
  window._editingSessionId = id;
  document.querySelector(".info-sec").scrollIntoView({behavior:"smooth"});
  showToast("Seance chargee - modifiez puis enregistrez", "#1a3a6b");
}

async function deleteSession(id) { if (!confirm("Supprimer cette seance ?")) return; await remove(ref(db,"sessions/"+id)); }
async function deleteAllHistory() { if (!confirm("Supprimer tout l historique ?")) return; await remove(ref(db,"sessions")); }

// ── GANTT ─────────────────────────────────────────────────────────────────────

function fmtCmtCell(cmts, color) {
  var valid = cmts.filter(function(c){return c&&c.trim();});
  if (!valid.length) return '<td class="info cmt-col"></td>';
  var html = '<td class="info cmt-col" style="border-left:3px solid '+color+';">';
  valid.forEach(function(c, i) {
    if (i > 0) html += '<div class="cmt-col-sep"></div>';
    html += '<div class="cmt-col-text">'+c.replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\\n/g,"<br>")+'</div>';
  });
  html += '</td>';
  return html;
}

function renderGantt(date, machine, data) {
  var container = document.getElementById("gantt-container");
  var targets = data.targets || {};
  var tasks = data.tasks || {};
  var tasks2 = data.tasks2 || {};
  var hasBc2 = data.bc2Active || false;

  var extras = (data.extraTasks||[]).slice();
  var extras2 = (data.extraTasks2||[]).slice();
  var extrasBoutChaud = extras.filter(function(et){ return (et.group||"boutchaud")==="boutchaud"; });
  var extrasBoutFroid = extras.filter(function(et){ return et.group==="boutfroid"; });
  var extrasBoutChaud2 = extras2.filter(function(et){ return (et.group||"boutchaud")==="boutchaud"; });

  allTasks = {};
  var minT=Infinity, maxT=-Infinity;

  function regT(sh, sm, eh, em) {
    var s=toMin(getTV(sh||"",sm||"")), e=toMin(getTV(eh||"",em||""));
    if(s!==null&&s>0) minT=Math.min(minT,s);
    if(e!==null&&e>0) maxT=Math.max(maxT,e);
  }

  function regObj(obj) {
    regT(obj.sh,obj.sm,obj.eh,obj.em);
    if(obj.sh2||obj.eh2) regT(obj.sh2,obj.sm2,obj.eh2,obj.em2);
    if(obj.sh3||obj.eh3) regT(obj.sh3,obj.sm3,obj.eh3,obj.em3);
    if(obj.sh4||obj.eh4) regT(obj.sh4,obj.sm4,obj.eh4,obj.em4);
  }

  ["grand_t1","petit_t1","rondelle"].forEach(function(k){ regObj(targets[k]||{}); });
  TASKS_BOUT_CHAUD.forEach(function(t){ regObj(tasks[t.id]||{}); });
  if (hasBc2) TASKS_BOUT_CHAUD.forEach(function(t){ regObj(tasks2[t.id]||{}); });
  TASKS_BOUT_FROID.forEach(function(t){ regObj(tasks[t.id]||{}); });
  extras.forEach(function(et){ regObj(et); });
  if (hasBc2) extras2.forEach(function(et){ regObj(et); });

  if (!isFinite(minT)) minT=360; if (!isFinite(maxT)) maxT=minT+120;
  minT=Math.max(280,minT-10); maxT=maxT+10;
  minT=Math.floor(minT/60)*60; maxT=Math.ceil(maxT/60)*60;

  var total=maxT-minT, slotMin=10, slots=total/slotMin;
  var slotW=Math.max(35,Math.min(90,900/slots));

  var dateStr=date?new Date(date+"T00:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"}):"";
  document.getElementById("gantt-machine-title").textContent = machine||"Changement - Temp/Machine";
  document.getElementById("gantt-subtitle").textContent = "SGD Pharma - Sucy-en-Brie"+(dateStr?" - "+dateStr:"");

  var targetDefs=[
    {key:"grand_t1",label:"TARGET (Grand T1)",color:"#c0392b"},
    {key:"petit_t1",label:"TARGET (Petit t1)",color:"#e07b54"},
    {key:"rondelle",label:"TARGET (Rondelle)",color:"#7d3c98"}
  ];

  var h='<table class="gantt"><tr><th colspan="5"></th>';
  for(var m=minT;m<maxT;m+=60) h+='<th colspan="'+(60/slotMin)+'" style="background:#1a3a6b;color:#fff">60 min</th>';
  h+='<th style="width:250px;background:#e8edf5;color:#1a3a6b;font-weight:700;font-size:11px;" rowspan="2">COMMENTAIRE</th>';
  h+='</tr><tr><th class="chk-cell"></th><th style="width:150px;text-align:left;padding-left:8px">MACHINE / SECTEUR<br><span style="font-weight:400;color:#1a5fa8;font-size:10px;">'+machine+'</span></th><th style="width:80px">WHO</th><th style="width:52px">START</th><th style="width:48px">FINAL</th>';
  for(var m=minT;m<maxT;m+=slotMin){
    var hh=Math.floor(m/60).toString().padStart(2,"0"),mm2=(m%60).toString().padStart(2,"0");
    h+='<th style="width:'+slotW+'px;font-size:10px;color:#555;font-weight:400">'+(mm2==="00"?hh+"h":mm2)+'</th>';
  }
  h+='</tr>';
  h+='<tr><td colspan="'+(5+slots+1)+'" style="background:#1a3a6b;color:#fff;font-weight:700;font-size:13px;padding:7px 10px;text-align:center;">'+machine+(dateStr?" - "+dateStr:"")+'</td></tr>';

  // TARGET
  targetDefs.forEach(function(td) {
    var t=targets[td.key]||{};
    var start=getTV(t.sh||"",t.sm||""), end=getTV(t.eh||"",t.em||"");
    var uid="target_"+td.key;
    allTasks[uid]={machine:td.label,qui:"--",start:start,end:end,color:td.color};
    var bar="";
    var s=toMin(start), e=toMin(end);
    if(s!==null&&e!==null&&e>s){
      var lp=((s-minT)/total)*100, wp=((e-s)/total)*100;
      bar='<div class="gantt-bar" style="left:'+lp+'%;width:'+wp+'%;background:'+td.color+'" data-uid="'+uid+'" data-label="'+td.label+'" data-qui="--" data-start="'+start+'" data-end="'+end+'" data-color="'+td.color+'" data-cmt="'+encCmt(t.comment||"")+'">'+td.label.replace("TARGET ","")+'</div>';
    }
    [[t.sh2,t.sm2,t.eh2,t.em2,t.comment2,"_2"],[t.sh3,t.sm3,t.eh3,t.em3,t.comment3,"_3"],[t.sh4,t.sm4,t.eh4,t.em4,t.comment4,"_4"]].forEach(function(sl){
      if(sl[0]||sl[2]){
        var sx=toMin(getTV(sl[0]||"",sl[1]||"")), ex=toMin(getTV(sl[2]||"",sl[3]||""));
        if(sx!==null&&ex!==null&&ex>sx){
          var lpx=((sx-minT)/total)*100, wpx=((ex-sx)/total)*100;
          bar+='<div class="gantt-bar" style="left:'+lpx+'%;width:'+wpx+'%;background:#fa8072;opacity:.8;" data-uid="'+uid+sl[5]+'" data-label="'+td.label+' ('+sl[5].replace("_",""+')" data-qui="--" data-start="'+getTV(sl[0]||"",sl[1]||"")+'" data-end="'+getTV(sl[2]||"",sl[3]||"")+'" data-color="#fa8072" data-cmt="'+encCmt(sl[4]||"")+'"></div>');
        }
      }
    });
    var isSelA=selectedIds[0]===uid, isSelB=selectedIds[1]===uid;
    h+='<tr class="target-section'+(isSelA?" sel-a":isSelB?" sel-b":"")+'" data-uid="'+uid+'" style="background:'+td.color+'22;">'+
      '<td class="chk-cell info"><input type="checkbox" '+(selectedIds.includes(uid)?"checked":"")+' data-uid="'+uid+'"></td>'+
      '<td class="info machine-name" style="color:'+td.color+';font-weight:700;">'+td.label+'</td>'+
      '<td class="info who-cell">--</td>'+
      '<td class="info time-cell">'+(start||"--")+'</td>'+
      '<td class="info time-cell">'+(end||"--")+'</td>'+
      '<td colspan="'+slots+'" class="bar-cell"><div class="bar-inner">'+bar+'</div></td>'+
      fmtCmtCell([t.comment,t.comment2,t.comment3,t.comment4],td.color)+
      '</tr>';
  });
  h+='<tr><td colspan="'+(5+slots+1)+'" style="background:#e8edf5;height:4px;"></td></tr>';

  function renderTaskRow(task, t, idx, uid, color, quiDisplay, rowIdx, isBF) {
    var start=getTV(t.sh||"",t.sm||""), end=getTV(t.eh||"",t.em||"");
    allTasks[uid]={machine:task.machine,qui:quiDisplay,start:start,end:end,color:color};
    var bar="";
    var s=toMin(start), e=toMin(end);
    if(s!==null&&e!==null&&e>s){
      var lp=((s-minT)/total)*100, wp=((e-s)/total)*100;
      bar='<div class="gantt-bar" style="left:'+lp+'%;width:'+wp+'%;background:'+color+'" data-uid="'+uid+'" data-label="'+task.machine+'" data-qui="'+quiDisplay+'" data-start="'+start+'" data-end="'+end+'" data-color="'+color+'" data-cmt="'+encCmt(t.comment||"")+'"></div>';
    }
    [[t.sh2,t.sm2,t.eh2,t.em2,t.comment2,"_2",.75],[t.sh3,t.sm3,t.eh3,t.em3,t.comment3,"_3",.6],[t.sh4,t.sm4,t.eh4,t.em4,t.comment4,"_4",.5]].forEach(function(sl){
      if(sl[0]||sl[2]){
        var sx=toMin(getTV(sl[0]||"",sl[1]||"")), ex=toMin(getTV(sl[2]||"",sl[3]||""));
        if(sx!==null&&ex!==null&&ex>sx){
          var lpx=((sx-minT)/total)*100, wpx=((ex-sx)/total)*100;
          bar+='<div class="gantt-bar" style="left:'+lpx+'%;width:'+wpx+'%;background:'+color+';opacity:'+sl[6]+';" data-uid="'+uid+sl[5]+'" data-label="'+task.machine+'" data-qui="'+quiDisplay+'" data-start="'+getTV(sl[0]||"",sl[1]||"")+'" data-end="'+getTV(sl[2]||"",sl[3]||"")+'" data-color="'+color+'" data-cmt="'+encCmt(sl[4]||"")+'"></div>';
        }
      }
    });
    var isSelA=selectedIds[0]===uid, isSelB=selectedIds[1]===uid;
    var rowCls=isSelA?"sel-a":isSelB?"sel-b":rowIdx%2===0?"odd":"even";
    if(isBF) rowCls+=" boutfroid-row";
    var machineName = task.machine;
    if (isBF && task.labelDebut) {
      machineName += '<div style="font-size:10px;color:#6c6c70;font-weight:400;margin-top:2px;">'+task.labelDebut+' — '+task.labelFin+'</div>';
    }
    h+='<tr class="'+rowCls+'" data-uid="'+uid+'">'+
      '<td class="chk-cell info"><input type="checkbox" '+(selectedIds.includes(uid)?"checked":"")+' data-uid="'+uid+'"></td>'+
      '<td class="info machine-name"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+color+';margin-right:5px;vertical-align:middle"></span>'+machineName+'</td>'+
      '<td class="info who-cell who-editable" data-uid="'+uid+'" title="Modifier">'+quiDisplay+' [mod]</td>'+
      '<td class="info time-cell">'+(start||"--")+'</td>'+
      '<td class="info time-cell">'+(end||"--")+'</td>'+
      '<td colspan="'+slots+'" class="bar-cell"><div class="bar-inner">'+bar+'</div></td>'+
      fmtCmtCell([t.comment,t.comment2,t.comment3,t.comment4],color)+
      '</tr>';
  }

  function renderExtraRow(et, idx, uid, color, rowIdx, isBF) {
    var start=getTV(et.sh||"",et.sm||""), end=getTV(et.eh||"",et.em||"");
    allTasks[uid]={machine:et.machine||"Extra",qui:et.qui||"",start:start,end:end,color:color};
    var bar="";
    var s=toMin(start), e=toMin(end);
    if(s!==null&&e!==null&&e>s){
      var lp=((s-minT)/total)*100, wp=((e-s)/total)*100;
      bar='<div class="gantt-bar" style="left:'+lp+'%;width:'+wp+'%;background:'+color+'" data-uid="'+uid+'" data-label="'+(et.machine||"Extra")+'" data-qui="'+(et.qui||"")+'" data-start="'+start+'" data-end="'+end+'" data-color="'+color+'" data-cmt="'+encCmt(et.comment||"")+'"></div>';
    }
    [[et.sh2,et.sm2,et.eh2,et.em2,et.comment2,"_2",.75],[et.sh3,et.sm3,et.eh3,et.em3,et.comment3,"_3",.6],[et.sh4,et.sm4,et.eh4,et.em4,et.comment4,"_4",.5]].forEach(function(sl){
      if(sl[0]||sl[2]){
        var sx=toMin(getTV(sl[0]||"",sl[1]||"")), ex=toMin(getTV(sl[2]||"",sl[3]||""));
        if(sx!==null&&ex!==null&&ex>sx){
          var lpx=((sx-minT)/total)*100, wpx=((ex-sx)/total)*100;
          bar+='<div class="gantt-bar" style="left:'+lpx+'%;width:'+wpx+'%;background:'+color+';opacity:'+sl[6]+';" data-uid="'+uid+sl[5]+'" data-label="'+(et.machine||"Extra")+'" data-qui="'+(et.qui||"")+'" data-start="'+getTV(sl[0]||"",sl[1]||"")+'" data-end="'+getTV(sl[2]||"",sl[3]||"")+'" data-color="'+color+'" data-cmt="'+encCmt(sl[4]||"")+'"></div>';
        }
      }
    });
    var isSelA=selectedIds[0]===uid, isSelB=selectedIds[1]===uid;
    var rowCls=isSelA?"sel-a":isSelB?"sel-b":rowIdx%2===0?"odd":"even";
    if(isBF) rowCls+=" boutfroid-row";
    h+='<tr class="'+rowCls+'" data-uid="'+uid+'">'+
      '<td class="chk-cell info"><input type="checkbox" '+(selectedIds.includes(uid)?"checked":"")+' data-uid="'+uid+'"></td>'+
      '<td class="info machine-name"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+color+';margin-right:5px;vertical-align:middle"></span>'+(et.machine||"Extra")+'</td>'+
      '<td class="info who-cell">'+(et.qui||"")+'</td>'+
      '<td class="info time-cell">'+(start||"--")+'</td>'+
      '<td class="info time-cell">'+(end||"--")+'</td>'+
      '<td colspan="'+slots+'" class="bar-cell"><div class="bar-inner">'+bar+'</div></td>'+
      fmtCmtCell([et.comment,et.comment2,et.comment3,et.comment4],color)+
      '</tr>';
  }

  // BOUT CHAUD 1
  h+='<tr><td colspan="'+(5+slots+1)+'" style="background:#1a3a6b;color:#fff;font-weight:700;font-size:12px;padding:7px 12px;">BOUT CHAUD 1</td></tr>';
  var bc1Rows=[];
  TASKS_BOUT_CHAUD.forEach(function(task,idx){
    var t=tasks[task.id]||{}, start=getTV(t.sh||"",t.sm||"");
    bc1Rows.push({type:"fixed",task:task,t:t,idx:idx,sMin:toMin(start)});
  });
  extrasBoutChaud.forEach(function(et,idx){
    var start=getTV(et.sh||"",et.sm||"");
    bc1Rows.push({type:"extra",et:et,idx:idx,sMin:toMin(start)});
  });
  bc1Rows.sort(function(a,b){ if(a.sMin===null)return 1; if(b.sMin===null)return -1; return a.sMin-b.sMin; });
  bc1Rows.forEach(function(rowData,rowIdx){
    if(rowData.type==="fixed"){
      var task=rowData.task, t=rowData.t, idx=rowData.idx;
      var color=TASK_COLORS[idx%TASK_COLORS.length];
      var uid="task_bc1_"+task.id;
      var quiDisplay=ganttQuiOverrides[uid]||t.qui||task.qui;
      renderTaskRow(task,t,idx,uid,color,quiDisplay,rowIdx,false);
    } else {
      var et=rowData.et, idx=rowData.idx;
      var color=et.color||TASK_COLORS[(TASKS_BOUT_CHAUD.length+idx)%TASK_COLORS.length];
      var uid="extra_bc1_"+idx;
      renderExtraRow(et,idx,uid,color,rowIdx,false);
    }
  });

  // BOUT CHAUD 2
  if (hasBc2) {
    h+='<tr><td colspan="'+(5+slots+1)+'" style="background:#c0392b;color:#fff;font-weight:700;font-size:12px;padding:7px 12px;">BOUT CHAUD 2</td></tr>';
    var bc2Rows=[];
    TASKS_BOUT_CHAUD.forEach(function(task,idx){
      var t=tasks2[task.id]||{}, start=getTV(t.sh||"",t.sm||"");
      bc2Rows.push({type:"fixed",task:task,t:t,idx:idx,sMin:toMin(start)});
    });
    extrasBoutChaud2.forEach(function(et,idx){
      var start=getTV(et.sh||"",et.sm||"");
      bc2Rows.push({type:"extra",et:et,idx:idx,sMin:toMin(start)});
    });
    bc2Rows.sort(function(a,b){ if(a.sMin===null)return 1; if(b.sMin===null)return -1; return a.sMin-b.sMin; });
    bc2Rows.forEach(function(rowData,rowIdx){
      if(rowData.type==="fixed"){
        var task=rowData.task, t=rowData.t, idx=rowData.idx;
        var color=TASK_COLORS[idx%TASK_COLORS.length];
        var uid="task_bc2_"+task.id;
        var quiDisplay=ganttQuiOverrides[uid]||t.qui||task.qui;
        renderTaskRow(task,t,idx,uid,color,quiDisplay,rowIdx,false);
      } else {
        var et=rowData.et, idx=rowData.idx;
        var color=et.color||TASK_COLORS[(TASKS_BOUT_CHAUD.length+idx)%TASK_COLORS.length];
        var uid="extra_bc2_"+idx;
        renderExtraRow(et,idx,uid,color,rowIdx,false);
      }
    });
  }

  // BOUT FROID
  h+='<tr><td colspan="'+(5+slots+1)+'" style="background:'+BOUT_FROID_COLOR+';color:#fff;font-weight:700;font-size:12px;padding:7px 12px;">BOUT FROID</td></tr>';
  var bfRows=[];
  TASKS_BOUT_FROID.forEach(function(task,idx){
    var t=tasks[task.id]||{}, start=getTV(t.sh||"",t.sm||"");
    bfRows.push({type:"fixed",task:task,t:t,idx:idx,sMin:toMin(start)});
  });
  extrasBoutFroid.forEach(function(et,idx){
    var start=getTV(et.sh||"",et.sm||"");
    bfRows.push({type:"extra",et:et,idx:idx,sMin:toMin(start)});
  });
  bfRows.sort(function(a,b){ if(a.sMin===null)return 1; if(b.sMin===null)return -1; return a.sMin-b.sMin; });
  bfRows.forEach(function(rowData,rowIdx){
    if(rowData.type==="fixed"){
      var task=rowData.task, t=rowData.t, idx=rowData.idx;
      var uid="task_bf_"+task.id;
      var quiDisplay=ganttQuiOverrides[uid]||t.qui||task.qui;
      renderTaskRow(task,t,idx,uid,task.color,quiDisplay,rowIdx,true);
    } else {
      var et=rowData.et, idx=rowData.idx;
      var color=et.color||TASK_COLORS[idx%TASK_COLORS.length];
      var uid="extra_bf_"+idx;
      renderExtraRow(et,idx,uid,color,rowIdx,true);
    }
  });

  h+='</table>';
  container.innerHTML=h;

  container.querySelectorAll(".gantt-bar").forEach(function(el){
    el.addEventListener("mouseenter",function(e){ showTT(e,el.dataset.label,el.dataset.qui,el.dataset.start,el.dataset.end,el.dataset.color,el.dataset.cmt); });
    el.addEventListener("mouseleave",hideTT);
  });
  container.querySelectorAll("input[type=checkbox][data-uid]").forEach(function(chk){
    chk.addEventListener("change",function(){ toggleSelect(chk.dataset.uid); });
  });
  container.addEventListener("click",function(e){
    var cell=e.target.closest(".who-editable"); if(!cell) return;
    showQuiEditor(cell,cell.dataset.uid,cell.textContent.replace(" [mod]","").trim());
  });

  document.getElementById("gantt-section").style.display="block";
  updateCmpBar();
  renderJustifications();
}

// ── TOOLTIP ───────────────────────────────────────────────────────────────────

function showTT(e,label,qui,start,end,color,comment){
  var TT=document.getElementById("tooltip");
  document.getElementById("tt-dot").style.background=color||"#3b82f6";
  document.getElementById("tt-title").textContent=label||"--";
  document.getElementById("tt-qui").textContent=qui||"--";
  document.getElementById("tt-start").textContent=start||"--";
  document.getElementById("tt-end").textContent=end||"--";
  var s=toMin(start),en=toMin(end);
  document.getElementById("tt-dur").textContent=(s!==null&&en!==null)?"Duree: "+fmtDur(s,en):"";
  var cb=document.getElementById("tt-comment-box");
  var decoded=comment?comment.replace(/\\n/g,"\n"):"";
  document.getElementById("tt-comment").textContent=decoded;
  cb.style.display=decoded?"block":"none";
  TT.classList.add("visible");
  if(window.innerWidth<600){
    TT.style.left="50%"; TT.style.transform="translateX(-50%)"; TT.style.top="auto"; TT.style.bottom="10px"; TT.style.width="90vw"; TT.style.maxWidth="90vw";
  } else {
    TT.style.transform=""; TT.style.bottom="auto"; TT.style.width=""; TT.style.maxWidth="300px";
    var x=e.clientX+16,y=e.clientY+16;
    if(x+310>window.innerWidth) x=e.clientX-310;
    if(y+230>window.innerHeight) y=e.clientY-230;
    if(y<0) y=8;
    TT.style.left=x+"px"; TT.style.top=y+"px";
  }
}
function hideTT(){ document.getElementById("tooltip").classList.remove("visible"); }

// ── SELECTION ─────────────────────────────────────────────────────────────────

function toggleSelect(id){
  var idx=selectedIds.indexOf(id);
  if(idx>-1) selectedIds.splice(idx,1);
  else { if(selectedIds.length>=2) selectedIds.shift(); selectedIds.push(id); }
  updateCmpBar();
  document.querySelectorAll("[data-uid]").forEach(function(tr){
    var uid=tr.dataset.uid, chk=tr.querySelector("input[type=checkbox]");
    if(chk){ chk.checked=selectedIds.includes(uid); tr.classList.toggle("sel-a",selectedIds[0]===uid); tr.classList.toggle("sel-b",selectedIds[1]===uid); }
  });
}

function updateCmpBar(){
  var bar=document.getElementById("cmp-bar");
  var jc=document.getElementById("justif-btn-container");
  if(selectedIds.length>=1){
    bar.classList.add("visible");
    document.getElementById("cmp-bar-names").textContent=selectedIds.map(function(id){return allTasks[id]?allTasks[id].machine||"--":"--";}).join(" vs ");
    if(jc) jc.style.display="block";
  } else {
    bar.classList.remove("visible");
    if(jc) jc.style.display="none";
    var d=document.getElementById("justif-dialog"); if(d) d.remove();
  }
}

function doCompare(){
  if(selectedIds.length!==2) return;
  var A=allTasks[selectedIds[0]], B=allTasks[selectedIds[1]]; if(!A||!B) return;
  document.getElementById("cmp-result-title").textContent=A.machine+" vs "+B.machine;
  document.getElementById("cmp-cards").innerHTML=
    '<div class="cmp-card a"><div class="cmp-card-badge a">A</div><div class="cmp-card-name">'+A.machine+'</div><div class="cmp-card-time">'+(A.start||"?")+" -> "+(A.end||"?")+'</div></div>'+
    '<div class="cmp-card b"><div class="cmp-card-badge b">B</div><div class="cmp-card-name">'+B.machine+'</div><div class="cmp-card-time">'+(B.start||"?")+" -> "+(B.end||"?")+'</div></div>';
  var sA=toMin(A.start),sB=toMin(B.start), diffText="--", diffSub="Donnees insuffisantes";
  if(sA!==null&&sB!==null){
    var d=Math.abs(sB-sA),hh=Math.floor(d/60),mm=d%60;
    diffText=hh&&mm?hh+"h "+mm+"min":hh?hh+"h":mm+"min";
    diffSub=sB>sA?"B demarre "+diffText+" apres A":sB<sA?"B demarre "+diffText+" avant A":"Meme heure";
  }
  document.getElementById("cmp-diff-box").innerHTML='<div class="cmp-diff-label">Ecart</div><div class="cmp-diff-value">'+diffText+'</div><div class="cmp-diff-sub">'+diffSub+'</div>';
  document.getElementById("cmp-result").classList.add("visible");
  document.getElementById("cmp-result").scrollIntoView({behavior:"smooth",block:"nearest"});
}
function closeCompare(){ document.getElementById("cmp-result").classList.remove("visible"); }

// ── JUSTIFICATION ─────────────────────────────────────────────────────────────

function openJustifDialog(){
  if(selectedIds.length<1) return;
  var existing=document.getElementById("justif-dialog"); if(existing){existing.remove();return;}
  var taskA=allTasks[selectedIds[0]], taskB=selectedIds[1]?allTasks[selectedIds[1]]:null; if(!taskA) return;
  var ecartMin="";
  if(taskB){
    var endA=toMin(taskA.end),startB=toMin(taskB.start),endB=toMin(taskB.end),startA=toMin(taskA.start);
    if(endA!==null&&startB!==null&&startB>endA) ecartMin=startB-endA;
    else if(endB!==null&&startA!==null&&startA>endB) ecartMin=startA-endB;
  }
  var dialog=document.createElement("div"); dialog.id="justif-dialog"; dialog.className="justif-dialog";
  dialog.innerHTML='<div class="justif-dialog-title">Justification'+(ecartMin?" - "+ecartMin+" min":"")+'</div>'+
    '<div class="justif-dialog-sub">'+taskA.machine+(taskB?" -> "+taskB.machine:"")+'</div>'+
    '<textarea id="justif-input" class="justif-input" placeholder="Ex: Attente piece, pause..." rows="3"></textarea>'+
    '<div class="justif-dialog-actions"><button id="justif-confirm" class="justif-confirm-btn">Enregistrer</button><button id="justif-cancel" class="justif-cancel-btn">Annuler</button></div>';
  document.getElementById("justif-btn-container").insertAdjacentElement("afterend",dialog);
  document.getElementById("justif-input").focus();
  document.getElementById("justif-cancel").addEventListener("click",function(){dialog.remove();});
  document.getElementById("justif-confirm").addEventListener("click",function(){
    var text=document.getElementById("justif-input").value.trim();
    if(!text){alert("Veuillez saisir un commentaire.");return;}
    justifications.push({taskA:taskA,taskB:taskB,ecartMin:ecartMin,text:text});
    dialog.remove(); renderJustifications();
    showToast("Justification enregistree !","#f59e0b");
  });
}

function renderJustifications(){
  var container=document.getElementById("justif-container"); if(!container) return;
  container.innerHTML=""; if(!justifications.length) return;
  var title=document.createElement("div"); title.style.cssText="font-size:11px;font-weight:700;color:#6c6c70;text-transform:uppercase;margin-bottom:8px;padding:0 4px;"; title.textContent="Justifications"; container.appendChild(title);
  justifications.forEach(function(j,idx){
    var card=document.createElement("div"); card.className="justif-timeline-card";
    var row=document.createElement("div"); row.className="justif-timeline-row";
    var boxA=document.createElement("div"); boxA.className="justif-task-box"; boxA.style.background=j.taskA.color||"#3b82f6";
    boxA.innerHTML='<div class="justif-task-name">'+j.taskA.machine+'</div><div class="justif-task-time">'+(j.taskA.end||"?")+'</div>'; row.appendChild(boxA);
    var arrow=document.createElement("div"); arrow.className="justif-arrow";
    arrow.innerHTML='<div class="justif-arrow-line"></div>'+(j.ecartMin?'<div class="justif-arrow-label">'+j.ecartMin+' min</div>':'')+'<div class="justif-arrow-head">&#x25B6;</div>'; row.appendChild(arrow);
    if(j.taskB){var boxB=document.createElement("div"); boxB.className="justif-task-box"; boxB.style.background=j.taskB.color||"#22c55e"; boxB.innerHTML='<div class="justif-task-name">'+j.taskB.machine+'</div><div class="justif-task-time">'+(j.taskB.start||"?")+'</div>'; row.appendChild(boxB);}
    var delBtn=document.createElement("button"); delBtn.className="justif-del-btn"; delBtn.textContent="x";
    delBtn.addEventListener("click",function(){justifications.splice(idx,1);renderJustifications();}); row.appendChild(delBtn);
    var comment=document.createElement("div"); comment.className="justif-comment"; comment.textContent=j.text;
    card.appendChild(row); card.appendChild(comment); container.appendChild(card);
  });
}

// ── QUI EDITABLE ──────────────────────────────────────────────────────────────

function showQuiEditor(cell,uid,current){
  var existing=document.getElementById("qui-editor"); if(existing) existing.remove();
  var editor=document.createElement("div"); editor.id="qui-editor"; editor.className="qui-editor";
  var input=document.createElement("input"); input.type="text"; input.value=current; input.className="qui-editor-input"; input.placeholder="Nom du responsable";
  var saveBtn=document.createElement("button"); saveBtn.textContent="OK"; saveBtn.className="qui-editor-save";
  var cancelBtn=document.createElement("button"); cancelBtn.textContent="X"; cancelBtn.className="qui-editor-cancel";
  editor.appendChild(input); editor.appendChild(saveBtn); editor.appendChild(cancelBtn);
  cell.style.position="relative"; cell.appendChild(editor); input.focus(); input.select();
  function applyEdit(){
    var val=input.value.trim(); if(!val){editor.remove();return;}
    ganttQuiOverrides[uid]=val; cell.textContent=val+" [mod]"; cell.dataset.uid=uid;
    editor.remove();
    showToast("Responsable mis a jour !","#1a3a6b");
  }
  saveBtn.addEventListener("click",applyEdit);
  input.addEventListener("keydown",function(e){if(e.key==="Enter")applyEdit();if(e.key==="Escape")editor.remove();});
  cancelBtn.addEventListener("click",function(){editor.remove();});
}

// ── EXPORT ────────────────────────────────────────────────────────────────────

function initExportButtons(){
  document.getElementById("export-toggle-btn").addEventListener("click",function(e){
    e.stopPropagation();
    var menu=document.getElementById("export-menu");
    menu.style.display=menu.style.display==="none"?"block":"none";
  });
  document.addEventListener("click",function(e){
    var dd=document.getElementById("export-dropdown");
    if(dd&&!dd.contains(e.target)) document.getElementById("export-menu").style.display="none";
  });
  document.getElementById("export-all").addEventListener("click",function(e){e.stopPropagation();exportToExcel(null,null);document.getElementById("export-menu").style.display="none";});
  document.getElementById("export-month").addEventListener("click",function(e){
    e.stopPropagation();
    var now=new Date(),from=new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10),to=new Date(now.getFullYear(),now.getMonth()+1,0).toISOString().slice(0,10);
    exportToExcel(from,to); document.getElementById("export-menu").style.display="none";
  });
  document.getElementById("export-custom").addEventListener("click",function(e){
    e.stopPropagation();
    var r=document.getElementById("export-date-range"); r.style.display=r.style.display==="none"?"flex":"none";
  });
  document.getElementById("export-confirm-btn").addEventListener("click",function(e){
    e.stopPropagation();
    var from=document.getElementById("export-date-from").value,to=document.getElementById("export-date-to").value;
    if(!from||!to){alert("Veuillez choisir les deux dates.");return;}
    exportToExcel(from,to); document.getElementById("export-menu").style.display="none"; document.getElementById("export-date-range").style.display="none";
  });
}

function exportToExcel(dateFrom,dateTo){
  var sessions=Object.values(allSessions);
  var filtered=dateFrom&&dateTo?sessions.filter(function(s){return s.date>=dateFrom&&s.date<=dateTo;}):sessions;
  if(!filtered.length){alert("Aucune seance trouvee.");return;}
  filtered.sort(function(a,b){return new Date(a.date)-new Date(b.date);});
  var rows=[["Date","Jour","Machine","Section","Tache","Qui","Debut","Fin","Duree (min)","Commentaire"]];
  filtered.forEach(function(session){
    var dateStr=session.date||"",jourStr=dateStr?new Date(dateStr+"T00:00:00").toLocaleDateString("fr-FR",{weekday:"long"}):"",machine=session.machine||"";
    var data=session.ganttData||{},targets=data.targets||{},tasks=data.tasks||{},extras=data.extraTasks||[];
    [["grand_t1","TARGET (Grand T1)"],["petit_t1","TARGET (Petit t1)"],["rondelle","TARGET (Rondelle)"]].forEach(function(td){
      var t=targets[td[0]]||{},start=getTV(t.sh||"",t.sm||""),end=getTV(t.eh||"",t.em||"");
      var dur=toMin(start)!==null&&toMin(end)!==null?toMin(end)-toMin(start):"";
      rows.push([dateStr,jourStr,machine,td[1],"Target","--",start,end,dur,(t.comment||"").replace(/\n/g," | ")]);
    });
    TASKS_BOUT_CHAUD.forEach(function(task){
      var t=tasks[task.id]||{},start=getTV(t.sh||"",t.sm||""),end=getTV(t.eh||"",t.em||"");
      var dur=toMin(start)!==null&&toMin(end)!==null?toMin(end)-toMin(start):"";
      rows.push([dateStr,jourStr,machine,"Bout Chaud 1",task.machine,t.qui||task.qui,start,end,dur,(t.comment||"").replace(/\n/g," | ")]);
    });
    extras.forEach(function(et){
      var start=getTV(et.sh||"",et.sm||""),end=getTV(et.eh||"",et.em||"");
      var dur=toMin(start)!==null&&toMin(end)!==null?toMin(end)-toMin(start):"";
      rows.push([dateStr,jourStr,machine,"Bout Chaud 1",et.machine||"Extra",et.qui||"",start,end,dur,(et.comment||"").replace(/\n/g," | ")]);
    });
    rows.push(["","","","","","","","","",""]);
  });
  var csv=rows.map(function(row){return row.map(function(cell){var str=String(cell!==null&&cell!==undefined?cell:"").replace(/\n/g," | ").replace(/\r/g,""); return(str.indexOf(";")>-1||str.indexOf('"')>-1)?'"'+str.replace(/"/g,'""')+'"':str;}).join(";");}).join("\n");
  var blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  var url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url; a.download="SGD_Chrono_V2_"+new Date().toLocaleDateString("fr-FR").replace(/\//g,"-")+".csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── TOAST ─────────────────────────────────────────────────────────────────────

function showToast(message,color){
  var ex=document.getElementById("toast-notif"); if(ex) ex.remove();
  var toast=document.createElement("div"); toast.id="toast-notif"; toast.textContent=message;
  toast.style.cssText="position:fixed;top:70px;left:50%;transform:translateX(-50%);background:"+color+";color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:700;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.2);transition:opacity .3s;font-family:Arial,sans-serif;";
  document.body.appendChild(toast);
  setTimeout(function(){toast.style.opacity="0";setTimeout(function(){toast.remove();},300);},2500);
}
