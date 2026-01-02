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

async function loadApiConfig() {
  const res = await fetch("ao.json", { cache: "no-store" });
  if (!res.ok) throw new Error("ao.json not found");
  const cfg = await res.json();
  API = (cfg.API_BASE || "").replace(/\/$/, "");
  if (!API) throw new Error("API_BASE missing in ao.json");
}

/* ================= State ================= */
let balances = { available: 0, frozen: 0, trial: 0 };
let TASK_COST = 12;
let currentTab = "pending";
let formConfig = null;

// dropdown elements (built dynamically)
let selSubject = null; // المادة
let selDate = null;    // التاريخ
let selGov = null;     // المحافظة
let selCenter = null;  // المركز

/* ================= Date helpers ================= */
function formatDateISO(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateLabel(d) {
  return d.toLocaleDateString("ar", {
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function buildNext7Days() {
  const out = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);

  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push({
      value: formatDateISO(d),
      label: (i === 0 ? `اليوم • ${formatDateLabel(d)}` : formatDateLabel(d))
    });
  }
  return out;
}

function fillDateDropdown() {
  if (!selDate) return;
  selDate.innerHTML = `<option value="" selected disabled>اختر التاريخ</option>`;
  buildNext7Days().forEach(x => {
    const o = document.createElement("option");
    o.value = x.value;
    o.textContent = x.label;
    selDate.appendChild(o);
  });
}

/* ================= Config + Form ================= */
async function loadConfig() {
  const res = await fetch("config.json", { cache: "no-store" });
  if (!res.ok) throw new Error("config.json not found");
  formConfig = await res.json();
  buildForm();
  wireDropdownLogic();
}

function getSubjectMap() {
  // لازم تضيفه داخل config.json كما بشرح تحت
  return formConfig?.form?.subject_map || {};
}

function setOptions(selectEl, placeholder, options) {
  selectEl.innerHTML = "";

  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  ph.disabled = true;
  ph.selected = true;
  selectEl.appendChild(ph);

  (options || []).forEach(opt => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    selectEl.appendChild(o);
  });
}

function buildForm() {
  el.taskForm.innerHTML = "";

  // fields (inputs)
  (formConfig.form.fields || []).forEach(f => {
    const input = document.createElement("input");
    input.placeholder = f.placeholder;
    input.dataset.type = "field";
    el.taskForm.appendChild(input);
  });

  // dropdown 1: subject from config.json
  selSubject = document.createElement("select");
  selSubject.dataset.type = "dropdown";
  selSubject.dataset.role = "subject";
  selSubject.innerHTML = `<option value="" selected disabled>اختر المادة</option>`;
  (formConfig.form.dropdowns?.[0]?.options || []).forEach(opt => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    selSubject.appendChild(o);
  });
  el.taskForm.appendChild(selSubject);

  // dropdown 2: date auto
  const dateWrap = document.createElement("div");
  dateWrap.className = "date-wrap";

  const hint = document.createElement("div");
  hint.className = "date-hint";
  hint.textContent = "أقرب تاريخ متاح ابتدائاً من:";
  dateWrap.appendChild(hint);

  selDate = document.createElement("select");
  selDate.dataset.type = "dropdown";
  selDate.dataset.role = "date";
  dateWrap.appendChild(selDate);

  el.taskForm.appendChild(dateWrap);

  // fill dates now
  fillDateDropdown();

  // dropdown 3: governorate depends on subject
  selGov = document.createElement("select");
  selGov.dataset.type = "dropdown";
  selGov.dataset.role = "gov";
  selGov.disabled = true;
  setOptions(selGov, "اختر المحافظة", []);
  el.taskForm.appendChild(selGov);

  // dropdown 4: center depends on subject + gov
  selCenter = document.createElement("select");
  selCenter.dataset.type = "dropdown";
  selCenter.dataset.role = "center";
  selCenter.disabled = true;
  setOptions(selCenter, "اختر المركز", []);
  el.taskForm.appendChild(selCenter);
}

function wireDropdownLogic() {
  if (!selSubject || !selGov || !selCenter) return;

  // subject => governorates
  selSubject.addEventListener("change", () => {
    const subject = selSubject.value;
    const map = getSubjectMap();

    const govs = (subject && map[subject]) ? Object.keys(map[subject]) : [];
    setOptions(selGov, "اختر المحافظة", govs);
    selGov.disabled = govs.length === 0;

    // reset center
    setOptions(selCenter, "اختر المركز", []);
    selCenter.disabled = true;
  });

  // governorate => centers
  selGov.addEventListener("change", () => {
    const subject = selSubject.value;
    const gov = selGov.value;
    const map = getSubjectMap();

    const centers =
      (subject && gov && map[subject] && Array.isArray(map[subject][gov]))
        ? map[subject][gov]
        : [];

    setOptions(selCenter, "اختر المركز", centers);
    selCenter.disabled = centers.length === 0;
  });
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
        t.status === "pending"   ? "جارٍ النشر" :
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
  // تحديث قائمة التواريخ عند كل فتح (حتى لو الصفحة مفتوحة من يوم)
  fillDateDropdown();
  el.modal.classList.remove("hidden");
};

el.cancelBtn.onclick = () => el.modal.classList.add("hidden");

/* ================= Create Task ================= */
el.submitBtn.onclick = async () => {
  const fields = [...el.taskForm.querySelectorAll('[data-type="field"]')]
    .map(i => i.value.trim());

  if (fields.some(v => !v)) {
    showNotice("يرجى تعبئة جميع الحقول");
    return;
  }

  const dropdowns = [
    selSubject?.value || "",
    selDate?.value || "",
    selGov?.value || "",
    selCenter?.value || ""
  ];

  if (!dropdowns[0]) return showNotice("اختر المادة");
  if (!dropdowns[1]) return showNotice("اختر التاريخ");
  if (!dropdowns[2]) return showNotice("اختر المحافظة");
  if (!dropdowns[3]) return showNotice("اختر المركز");

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
