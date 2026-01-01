const tg = Telegram.WebApp;
tg.ready();

const API = "https://ao4.fourwordbefore.space";

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

/* ================= Config + Form ================= */
async function loadConfig() {
  const res = await fetch("config.json", { cache: "no-store" });
  if (!res.ok) throw new Error("config.json not found");
  formConfig = await res.json();
  buildForm();
}

function buildForm() {
  el.taskForm.innerHTML = "";

  (formConfig.form.fields || []).forEach(f => {
    const input = document.createElement("input");
    input.placeholder = f.placeholder;
    input.dataset.type = "field";
    el.taskForm.appendChild(input);
  });

  (formConfig.form.dropdowns || []).forEach(d => {
    const select = document.createElement("select");
    select.dataset.type = "dropdown";
    d.options.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    });
    el.taskForm.appendChild(select);
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

    /* ----- To Delete State ----- */
    if (t.status === "to_delete") {
      card.classList.add("deleting");
      const badge = document.createElement("div");
      badge.className = "deleting-badge";
      badge.textContent = "🟡 جارٍ الحذف";
      card.appendChild(badge);
    }

    /* ----- Financial Note ----- */
    if (t.financial_note) {
      const fn = document.createElement("div");
      fn.className = "fin-note";
      fn.textContent = t.financial_note;
      card.appendChild(fn);
    }

    /* ----- Status text (pending tab only) ----- */
    if (currentTab === "pending" && t.status !== "to_delete") {
      const st = document.createElement("div");
      st.className = "status-text";
      st.textContent =
        t.status === "pending"   ? "جارٍ النشر" :
        t.status === "completed" ? "قيد الإنجاز" :
                                   "مرفوضة";
      card.appendChild(st);
    }

    /* ----- Fields ----- */
    (t.fields || []).forEach(v => {
      const line = document.createElement("div");
      line.className = "line";
      line.textContent = v;
      card.appendChild(line);
    });

    /* ----- Dropdowns ----- */
    (t.dropdowns || []).forEach(v => {
      const line = document.createElement("div");
      line.className = "line";
      line.textContent = v;
      card.appendChild(line);
    });

    /* ----- Delete Button ----- */
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
el.addBtn.onclick = () => el.modal.classList.remove("hidden");
el.cancelBtn.onclick = () => el.modal.classList.add("hidden");

/* ================= Create Task ================= */
el.submitBtn.onclick = async () => {
  const fields = [...el.taskForm.querySelectorAll('[data-type="field"]')]
    .map(i => i.value.trim());
  const dropdowns = [...el.taskForm.querySelectorAll('[data-type="dropdown"]')]
    .map(s => s.value);

  if (fields.some(v => !v)) {
    showNotice("يرجى تعبئة جميع الحقول");
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
    await loadConfig();
    await bootstrap();
    await loadTasks();
  } catch (e) {
    console.error(e);
    showNotice("خطأ في تحميل التطبيق");
  }
})();
