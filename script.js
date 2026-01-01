const tg = Telegram.WebApp;
tg.ready();

let API = "";

/* ================= DOM ================= */
const el = {
  available: document.getElementById("available"),
  frozen: document.getElementById("frozen"),
  trial: document.getElementById("trial"),

  balFrozen: document.getElementById("bal-frozen"),
  balTrial: document.getElementById("bal-trial"),

  taskList: document.getElementById("task-list"),
  modal: document.getElementById("modal"),
  taskForm: document.getElementById("task-form"),
  notice: document.getElementById("notice"),

  addBtn: document.getElementById("add-btn"),
  submitBtn: document.getElementById("submit"),
  cancelBtn: document.getElementById("cancel"),

  tabs: Array.from(document.querySelectorAll(".tabs button"))
};

/* ================= Helpers ================= */
let noticeTimer = null;
function showNotice(msg) {
  el.notice.textContent = msg;
  el.notice.classList.remove("hidden");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => el.notice.classList.add("hidden"), 3500);
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": tg.initData,
      "ngrok-skip-browser-warning": "true"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) throw new Error(data.detail || text || "request failed");
  return data;
}

/* ================= State ================= */
let balances = { available: 0, frozen: 0, trial: 0 };
let TASK_COST = 12;
let currentTab = "pending";
let formConfig = null;

/* ================= Load API Config ================= */
async function loadApiConfig() {
  const res = await fetch("ao.json", { cache: "no-store" });
  if (!res.ok) throw new Error("ao.json not found");
  const cfg = await res.json();
  API = (cfg.API_BASE || "").replace(/\/$/, "");
  if (!API) throw new Error("API_BASE missing in ao.json");
}

/* ================= Config + Dynamic Dropdown Engine ================= */
let dropdownCfgs = [];
let dropdownEls = [];

async function loadConfig() {
  const res = await fetch("config.json", { cache: "no-store" });
  if (!res.ok) throw new Error("config.json not found");
  formConfig = await res.json();
  buildForm();
}

function next7Days() {
  const out = [];
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);

  for (let i = 0; i < 7; i++) {
    const d = new Date(d0);
    d.setDate(d0.getDate() + i);

    const value = d.toISOString().slice(0, 10); // YYYY-MM-DD
    const label = d.toLocaleDateString("ar", {
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });

    out.push({ value, label });
  }
  return out;
}

function setSelectOptions(sel, options, placeholder) {
  const prev = sel.value;
  sel.innerHTML = "";

  // placeholder
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder || "اختر";
  ph.disabled = true;
  ph.selected = true;
  sel.appendChild(ph);

  const normalized = (options || []).map(opt => {
    if (opt && typeof opt === "object") return opt; // {value,label}
    return { value: String(opt), label: String(opt) };
  });

  normalized.forEach(opt => {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    sel.appendChild(o);
  });

  // keep selection if still exists
  const stillExists = normalized.some(o => o.value === prev);
  if (stillExists) sel.value = prev;

  sel.disabled = normalized.length === 0;
}

function getSelectValue(id) {
  const s = dropdownEls.find(x => x.dataset.id === id);
  return s ? (s.value || "") : "";
}

function resolveOptions(cfg) {
  // dynamic dates
  if (cfg.dynamic === "next_7_days") return next7Days();

  // no dependency -> static options
  if (!cfg.depends_on) return cfg.options || [];

  // dependency path (one or many)
  const deps = Array.isArray(cfg.depends_on) ? cfg.depends_on : [cfg.depends_on];

  let node = cfg.options_map || {};
  for (const depId of deps) {
    const val = getSelectValue(depId);
    if (!val) return cfg.fallback || [];
    node = node?.[val];
    if (!node) return cfg.fallback || [];
  }

  return Array.isArray(node) ? node : (cfg.fallback || []);
}

function refreshByParent(parentId, visited = new Set()) {
  if (visited.has(parentId)) return;
  visited.add(parentId);

  dropdownCfgs.forEach((cfg, i) => {
    const deps = cfg.depends_on
      ? (Array.isArray(cfg.depends_on) ? cfg.depends_on : [cfg.depends_on])
      : [];

    if (deps.includes(parentId)) {
      setSelectOptions(dropdownEls[i], resolveOptions(cfg), cfg.placeholder);

      const childId = cfg.id || dropdownEls[i].dataset.id;
      refreshByParent(childId, visited);
    }
  });
}

function buildForm() {
  el.taskForm.innerHTML = "";
  dropdownCfgs = (formConfig?.form?.dropdowns || []);
  dropdownEls = [];

  // fields
  (formConfig?.form?.fields || []).forEach(f => {
    const input = document.createElement("input");
    input.placeholder = f.placeholder;
    input.dataset.type = "field";
    el.taskForm.appendChild(input);
  });

  // dropdowns
  dropdownCfgs.forEach(cfg => {
    const select = document.createElement("select");
    select.dataset.type = "dropdown";
    select.dataset.id = cfg.id || "";

    setSelectOptions(select, resolveOptions(cfg), cfg.placeholder);

    select.addEventListener("change", () => {
      refreshByParent(select.dataset.id);
    });

    dropdownEls.push(select);
    el.taskForm.appendChild(select);
  });

  // initial cascade refresh
  dropdownEls.forEach(s => refreshByParent(s.dataset.id));
}

/* ================= Bootstrap ================= */
async function bootstrap() {
  const data = await api("/api/bootstrap");
  balances = data.balances;
  TASK_COST = Number(data.task_cost || 12);

  el.available.textContent = balances.available;

  balances.frozen > 0
    ? (el.frozen.textContent = balances.frozen, el.balFrozen.classList.remove("hidden"))
    : el.balFrozen.classList.add("hidden");

  balances.trial > 0
    ? (el.trial.textContent = balances.trial, el.balTrial.classList.remove("hidden"))
    : el.balTrial.classList.add("hidden");
}

/* ================= Load Tasks ================= */
async function loadTasks() {
  el.taskList.innerHTML = "جارٍ التحميل...";
  const tasks = await api(`/api/tasks?execution_status=${currentTab}`);
  el.taskList.innerHTML = "";

  if (!tasks.length) {
    el.taskList.innerHTML = "<p>لا توجد مهمات</p>";
    return;
  }

  tasks.forEach(t => {
    const card = document.createElement("div");
    card.className = "card";

    if (t.status === "to_delete") {
      card.classList.add("deleting");
      const badge = document.createElement("div");
      badge.className = "deleting-badge";
      badge.textContent = "🟡 جارٍ الحذف";
      card.appendChild(badge);
    }

    if (t.financial_note) {
      const fn = document.createElement("div");
      fn.className = "fin-note";
      fn.textContent = t.financial_note;
      card.appendChild(fn);
    }

    if (currentTab === "pending" && t.status !== "to_delete") {
      const st = document.createElement("div");
      st.className = "status-text";
      st.textContent =
        t.status === "pending" ? "جارٍ النشر" :
        t.status === "completed" ? "قيد الإنجاز" :
        "مرفوضة";
      card.appendChild(st);
    }

    (t.fields || []).forEach(v => {
      const line = document.createElement("div");
      line.className = "line";
      line.textContent = v;
      card.appendChild(line);
    });

    (t.dropdowns || []).forEach(v => {
      const line = document.createElement("div");
      line.className = "line";
      line.textContent = v;
      card.appendChild(line);
    });

    if (t.status !== "to_delete") {
      const btn = document.createElement("button");
      btn.textContent = "حذف المهمة";
      btn.onclick = async () => {
        await api(`/api/tasks/${t._id}/to-delete`, { method: "PATCH" });
        showNotice("تم إرسال طلب حذف المهمة");
        await loadTasks();
      };
      card.appendChild(btn);
    }

    el.taskList.appendChild(card);
  });
}

/* ================= Modal ================= */
el.addBtn.onclick = () => {
  // regenerate dates every time modal opens
  dropdownCfgs.forEach((cfg, i) => {
    if (cfg.dynamic === "next_7_days") {
      setSelectOptions(dropdownEls[i], next7Days(), cfg.placeholder);
    }
  });

  // ensure dependencies updated
  dropdownEls.forEach(s => refreshByParent(s.dataset.id));

  el.modal.classList.remove("hidden");
};

el.cancelBtn.onclick = () => el.modal.classList.add("hidden");

/* ================= Create Task ================= */
el.submitBtn.onclick = async () => {
  const fields = [...el.taskForm.querySelectorAll('[data-type="field"]')]
    .map(i => i.value.trim());

  const dropdowns = [...el.taskForm.querySelectorAll('[data-type="dropdown"]')]
    .map(s => s.value);

  // validation: fields
  if (fields.some(v => !v)) {
    showNotice("يرجى تعبئة جميع الحقول");
    return;
  }

  // validation: dropdowns must be selected (not empty)
  if (dropdowns.some(v => !v)) {
    showNotice("يرجى اختيار جميع القوائم");
    return;
  }

  let source = null;
  if (balances.available >= TASK_COST) source = "available";
  else if (balances.trial >= TASK_COST) source = "trial";

  if (!source) {
    showNotice("لا يوجد رصيد كافٍ لإضافة مهمة");
    return;
  }

  await api("/api/tasks", {
    method: "POST",
    body: { fields, dropdowns, balance_source: source }
  });

  el.modal.classList.add("hidden");
  await loadTasks();
};

/* ================= Tabs ================= */
el.tabs.forEach(btn => {
  btn.onclick = async () => {
    el.tabs.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.status;
    await loadTasks();
  };
});

/* ================= Init ================= */
(async function init() {
  try {
    await loadApiConfig();
    await loadConfig();
    await bootstrap();
    await loadTasks();
  } catch (e) {
    console.error(e);
    showNotice("خطأ في تحميل التطبيق");
  }
})();
