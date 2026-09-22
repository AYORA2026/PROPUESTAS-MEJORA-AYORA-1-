/* global PDFLib, supabase */
const $ = (s, r = document) => r.querySelector(s),
  $$ = (s, r = document) => [...r.querySelectorAll(s)];
const views = {
  auth: $("#authView"),
  home: $("#homeView"),
  form: $("#formView"),
};
const SUPABASE_URL = "https://opvmwbxtllwkureadfxw.supabase.co",
  SUPABASE_KEY = "sb_publishable_Iet2wIkRKD3lrPhQVxUjWA_yyAaky3W";
const APP_VERSION = "11.0.0",
  PDF_MODEL = "rg-spm28-ed09",
  PDF_MODEL_ALIASES = new Set([PDF_MODEL, "rg-spm28-v9"]),
  PDF_TEMPLATE_SHA256 =
    "13a9b8a765f7f00977eb32b1b1e87625f740982478a8d8c584f1080be67b8bf2";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY),
  form = $("#proposalForm"),
  canvas = $("#signatureCanvas"),
  ctx = canvas.getContext("2d");
let currentStep = 1,
  drawing = false,
  signatureDirty = false,
  photos = [],
  currentPdf = null,
  currentRecord = null,
  installPrompt = null,
  currentUser = null,
  currentProfile = null,
  currentProject = null,
  projects = [],
  memberships = [],
  recipients = [],
  syncing = false,
  templatePromise = null;
const requestedPdfModel = new URLSearchParams(location.search).get("pdf"),
  dbPromise = openDb();

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("ayora-propuestas", 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("records"))
        db.createObjectStore("records", { keyPath: "id" });
      if (!db.objectStoreNames.contains("drafts"))
        db.createObjectStore("drafts", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(value, store = "records") {
  const db = await dbPromise;
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => res(value);
    tx.onerror = () => rej(tx.error);
  });
}
async function dbGet(id, store = "records") {
  const db = await dbPromise;
  return new Promise((res, rej) => {
    const req = db.transaction(store).objectStore(store).get(id);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function dbAll(store = "records") {
  const db = await dbPromise;
  return new Promise((res, rej) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function dbDelete(id, store = "records") {
  const db = await dbPromise;
  return new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");
  scrollTo({ top: 0, behavior: "smooth" });
}
function nowLocal() {
  const d = new Date(),
    z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}
function data() {
  return Object.fromEntries(new FormData(form).entries());
}
function escapeHtml(v = "") {
  return String(v).replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
}
function formatDate(v) {
  return v
    ? new Intl.DateTimeFormat("es-ES", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(v))
    : "";
}
function pendingNumber(id) {
  return `PENDIENTE-${String(id).slice(0, 8).toUpperCase()}`;
}
function showSyncNotice(message, type = "info") {
  const el = $("#syncNotice");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden", "sync-error", "sync-ok");
  if (type === "error") el.classList.add("sync-error");
  if (type === "ok") el.classList.add("sync-ok");
}
function hideSyncNotice() {
  $("#syncNotice")?.classList.add("hidden");
}

function resetForm() {
  form.reset();
  form.worksite.value = currentProject?.worksite || "ISFV Ayora I";
  form.inspector.value = currentProfile?.full_name || "";
  $("#inspectionDate").value = nowLocal();
  photos = [];
  signatureDirty = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  currentStep = 1;
  updateStep();
  renderPhotos();
  applyConditionalFields();
}
function updateStep() {
  $$(".step").forEach((x) =>
    x.classList.toggle("active", +x.dataset.step === currentStep),
  );
  $("#stepLabel").textContent = `Paso ${currentStep} de 5`;
  $("#progressBar").style.width = `${currentStep * 20}%`;
  $("#prevStep").classList.toggle("hidden", currentStep === 1);
  $("#nextStep").classList.toggle("hidden", currentStep === 5);
  $("#finishButton").classList.toggle("hidden", currentStep !== 5);
  if (currentStep === 5) renderReview();
  scrollTo({ top: 0, behavior: "smooth" });
}
function validateStep() {
  const step = $(`.step[data-step="${currentStep}"]`);
  for (const el of $$("[required]", step)) {
    if (!el.checkValidity()) {
      el.reportValidity();
      return false;
    }
  }
  if (
    currentStep === 4 &&
    data().signatureStatus === "signed" &&
    !signatureDirty
  ) {
    alert("La persona apercibida debe firmar antes de continuar.");
    return false;
  }
  return true;
}
function renderReview() {
  const d = data();
  $("#reviewCard").innerHTML =
    `<dl><dt>Fecha</dt><dd>${escapeHtml(formatDate(d.inspectionDate))}</dd><dt>Técnico</dt><dd>${escapeHtml(d.inspector)}</dd><dt>Destinatario</dt><dd>${d.recipientType === "eiffage" ? "Grupo Eiffage" : escapeHtml(d.company)}</dd><dt>Trabajador/es</dt><dd>${escapeHtml(d.workers)}</dd><dt>Ubicación</dt><dd>${escapeHtml(d.worksite)} · ${escapeHtml(d.zone)}</dd><dt>Incumplimiento</dt><dd>${escapeHtml(d.deficiencies)}</dd><dt>Corrección</dt><dd>${escapeHtml(d.correctiveAction)}</dd><dt>Plazo</dt><dd>${escapeHtml(d.deadline)}</dd><dt>Firma</dt><dd>${d.signatureStatus === "signed" ? "Realizada" : d.signatureStatus === "refused" ? "Negativa a firmar" : "Imposibilidad de firma"}</dd><dt>Fotos</dt><dd>${photos.length}</dd></dl>`;
}
function applyConditionalFields() {
  const d = data(),
    contractor = d.recipientType === "contractor",
    signed = d.signatureStatus === "signed";
  $("#companyField").classList.toggle("hidden", !contractor);
  form.company.required = contractor;
  $("#signatureArea").classList.toggle("hidden", !signed);
  $("#witnessField").classList.toggle("hidden", signed);
  form.witness.required = !signed;
}

function pointer(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) * canvas.width) / r.width,
    y: ((e.clientY - r.top) * canvas.height) / r.height,
  };
}
canvas.addEventListener("pointerdown", (e) => {
  drawing = true;
  signatureDirty = true;
  canvas.setPointerCapture(e.pointerId);
  const p = pointer(e);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  const p = pointer(e);
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#111";
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
});
canvas.addEventListener("pointerup", () => (drawing = false));
canvas.addEventListener("pointercancel", () => (drawing = false));
$("#photoInput").addEventListener("change", async (e) => {
  try {
    photos = await Promise.all([...e.target.files].slice(0, 6).map(fileToData));
    renderPhotos();
  } catch (error) {
    alert("No se pudieron preparar las fotografías: " + error.message);
  }
});
function renderPhotos() {
  $("#photoPreview").innerHTML = photos
    .map((src) => `<img src="${src}" alt="Fotografía adjunta">`)
    .join("");
}
function fileToData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Imagen no válida"));
      img.onload = () => {
        const max = 1600,
          scale = Math.min(1, max / Math.max(img.width, img.height)),
          c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function saveDraft(showMessage = true) {
  const draft = {
    id: "current",
    projectId: currentProject?.id,
    formData: data(),
    photos: [...photos],
    signatureData: signatureDirty ? canvas.toDataURL("image/png") : null,
    savedAt: new Date().toISOString(),
  };
  await dbPut(draft, "drafts");
  if (showMessage)
    alert(
      "Borrador guardado en este dispositivo, incluidas fotografías y firma.",
    );
  return draft;
}
async function restoreDraft(draft) {
  resetForm();
  for (const [name, value] of Object.entries(draft.formData || {})) {
    const fields = $$(`[name="${CSS.escape(name)}"]`, form);
    for (const field of fields) {
      if (field.type === "radio") field.checked = field.value === value;
      else if (field.type === "checkbox")
        field.checked = value === "on" || value === true;
      else field.value = value ?? "";
    }
  }
  photos = draft.photos || [];
  renderPhotos();
  if (draft.signatureData)
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        signatureDirty = true;
        resolve();
      };
      img.onerror = reject;
      img.src = draft.signatureData;
    });
  applyConditionalFields();
  currentStep = 1;
  updateStep();
}

function wrap(font, text, size, maxWidth) {
  const words = String(text || "").split(/\s+/),
    lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth) {
      if (line) lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function drawBlock(
  page,
  font,
  text,
  x,
  y,
  maxWidth,
  size = 9,
  lineHeight = 11,
  maxLines = 8,
) {
  let fittedSize = size,
    fittedLineHeight = lineHeight,
    lines = wrap(font, text, fittedSize, maxWidth);
  while (lines.length > maxLines && fittedSize > 7) {
    fittedSize -= 0.5;
    fittedLineHeight = Math.max(fittedSize + 1.5, 8.5);
    lines = wrap(font, text, fittedSize, maxWidth);
  }
  lines.slice(0, maxLines).forEach((line, i) =>
    page.drawText(line, {
      x,
      y: y - i * fittedLineHeight,
      size: fittedSize,
      font,
      color: PDFLib.rgb(0.05, 0.08, 0.13),
    }),
  );
}
async function sha256Hex(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function loadOfficialTemplate() {
  if (templatePromise) return templatePromise;
  templatePromise = (async () => {
    const parts = [];
    for (let i = 1; i <= 7; i++) {
      const n = String(i).padStart(2, "0");
      parts.push(
        await fetch(`assets/template-part-${n}.txt?v=11`, {
          cache: "no-store",
        }).then((r) => {
          if (!r.ok)
            throw new Error("No se pudo cargar la plantilla oficial RG-SPM-28");
          return r.text();
        }),
      );
    }
    const raw = atob(parts.join("").replace(/\s/g, "")),
      bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    if ((await sha256Hex(bytes)) !== PDF_TEMPLATE_SHA256)
      throw new Error(
        "La plantilla RG-SPM-28 no corresponde a la Edición 09 autorizada",
      );
    return bytes;
  })();
  try {
    return await templatePromise;
  } catch (error) {
    templatePromise = null;
    throw error;
  }
}
async function makePdf(d) {
  const pdf = await PDFLib.PDFDocument.load(await loadOfficialTemplate()),
    page = pdf.getPages()[0],
    font = await pdf.embedFont(PDFLib.StandardFonts.Helvetica),
    bold = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold),
    top = d.recipientType === "eiffage";
  const inspection = new Date(d.inspectionDate),
    day = String(inspection.getDate()).padStart(2, "0"),
    month = String(inspection.getMonth() + 1).padStart(2, "0"),
    year = inspection.getFullYear(),
    dateText = `${day}/${month}/${year}`;
  page.drawRectangle({
    x: 458,
    y: 743,
    width: 107,
    height: 16.5,
    color: PDFLib.rgb(1, 1, 1),
  });
  page.drawText(dateText, {
    x: 491,
    y: 748.5,
    size: 8,
    font: bold,
    color: PDFLib.rgb(0.05, 0.08, 0.13),
  });
  page.drawText("X", { x: 36, y: top ? 737 : 437, size: 9, font: bold });
  if (top) {
    drawBlock(page, font, d.workers, 34, 724, 525, 8.5, 10, 3);
    drawBlock(
      page,
      font,
      `${d.worksite} - Zona: ${d.zone}`,
      34,
      678,
      525,
      8.5,
      10,
      3,
    );
    drawBlock(page, font, d.deficiencies, 34, 632, 525, 8.5, 10, 4);
    drawBlock(page, font, d.correctiveAction, 34, 575, 525, 8.5, 10, 10);
  } else {
    drawBlock(page, font, d.company, 34, 423, 525, 8.5, 10, 2);
    drawBlock(
      page,
      font,
      `${d.worksite} - Zona: ${d.zone}`,
      34,
      377,
      525,
      8.5,
      10,
      3,
    );
    drawBlock(page, font, d.deficiencies, 34, 331, 525, 8.5, 10, 5);
    drawBlock(page, font, d.workers, 34, 262, 525, 8.5, 10, 3);
    drawBlock(page, font, d.correctiveAction, 34, 217, 525, 8.5, 10, 10);
  }
  const sy = top ? 466 : 96,
    status =
      d.signatureStatus === "signed"
        ? ""
        : d.signatureStatus === "refused"
          ? `Se niega a firmar. Testigo: ${d.witness || "No consta"}`
          : `No puede firmar. Testigo: ${d.witness || "No consta"}`;
  if (status) drawBlock(page, font, status, 355, sy + 18, 195, 7, 9, 4);
  if (d.signatureStatus === "signed" && signatureDirty) {
    const sig = await pdf.embedPng(canvas.toDataURL("image/png")),
      dims = sig.scaleToFit(160, 55);
    page.drawImage(sig, {
      x: 455 - dims.width / 2,
      y: sy,
      width: dims.width,
      height: dims.height,
    });
  }
  for (let i = 0; i < photos.length; i++) {
    if (i % 2 === 0) {
      const p = pdf.addPage([595.28, 841.89]);
      p.drawText("ANEXO FOTOGRÁFICO · RG-SPM-28", {
        x: 36,
        y: 805,
        size: 12,
        font: bold,
        color: PDFLib.rgb(0.1, 0.2, 0.35),
      });
    }
    const p = pdf.getPages().at(-1),
      bytes = await fetch(photos[i]).then((r) => r.arrayBuffer());
    let image;
    try {
      image = await pdf.embedJpg(bytes);
    } catch {
      try {
        image = await pdf.embedPng(bytes);
      } catch {
        continue;
      }
    }
    const dims = image.scaleToFit(520, 330),
      y = i % 2 === 0 ? 440 : 75;
    p.drawImage(image, {
      x: (595.28 - dims.width) / 2,
      y,
      width: dims.width,
      height: dims.height,
    });
    p.drawText(`Fotografía ${i + 1}`, { x: 36, y: y - 16, size: 8, font });
  }
  return new Blob([await pdf.save()], { type: "application/pdf" });
}

function proposalPayload(d, id) {
  return {
    id,
    project_id: currentProject.id,
    created_by: currentUser.id,
    inspection_at: new Date(d.inspectionDate).toISOString(),
    recipient_type: d.recipientType,
    company: d.company || "Grupo Eiffage",
    workers: d.workers
      .split(/\n|,/)
      .map((x) => x.trim())
      .filter(Boolean),
    worksite: d.worksite,
    zone: d.zone,
    deficiency: d.deficiencies,
    corrective_action: d.correctiveAction,
    classification: d.classification,
    recurrence: d.repeatOffence === "on",
    signature_status: d.signatureStatus,
    signer_name: d.workers,
    witness_name: d.witness || null,
    signature_data: null,
    copy_delivered: d.copyDelivered === "on",
    status: "borrador",
    closed_at: null,
  };
}
async function saveCatalogs(d, projectId = currentProject?.id) {
  if (!currentUser || !projectId) return;
  const items = [
    ["empresa", d.company],
    ["trabajador", d.workers],
    ["zona", d.zone],
    ["incumplimiento", d.deficiencies],
    ["medida_correctora", d.correctiveAction],
  ];
  for (const [category, value] of items) {
    if (!value?.trim()) continue;
    const { error } = await sb.from("catalog_items").insert({
      project_id: projectId,
      category,
      value: value.trim(),
      created_by: currentUser.id,
    });
    if (error && error.code !== "23505")
      console.warn("No se pudo guardar catálogo", category, error.message);
  }
  await loadCatalogs();
}
async function syncRecord(record) {
  if (!currentUser || record.ownerId !== currentUser.id)
    throw new Error("La propuesta pertenece a otra sesión");
  if (!record.projectId) {
    const legacyProject = projects.find((project) => project.code === "AY1");
    if (!legacyProject)
      throw new Error(
        "No se pudo identificar el proyecto de la propuesta pendiente",
      );
    record.projectId = legacyProject.id;
    record.payload.project_id = legacyProject.id;
  }
  let remote;
  const inserted = await sb
    .from("proposals")
    .insert(record.payload)
    .select("id,proposal_number,created_at,status,pdf_path,project_id")
    .single();
  if (inserted.error) {
    if (inserted.error.code !== "23505") throw inserted.error;
    const existing = await sb
      .from("proposals")
      .select("id,proposal_number,created_at,status,pdf_path,project_id")
      .eq("id", record.id)
      .single();
    if (existing.error) throw existing.error;
    remote = existing.data;
  } else remote = inserted.data;
  if (remote.status === "cerrada" && remote.pdf_path) {
    record.number = remote.proposal_number;
    record.createdAt = remote.created_at;
    record.status = "cerrada";
    record.syncStatus = "synced";
    record.pdfPath = remote.pdf_path;
    record.projectId = remote.project_id;
    record.lastSyncError = null;
    await dbPut(record);
    return record;
  }
  const path = `${record.projectId}/${currentUser.id}/${record.id}.pdf`;
  const uploaded = await sb.storage
    .from("proposal-pdfs")
    .upload(path, record.pdf, { contentType: "application/pdf", upsert: true });
  if (uploaded.error) throw uploaded.error;
  const closed = await sb
    .from("proposals")
    .update({ pdf_path: path, status: "cerrada", closed_at: record.closedAt })
    .eq("id", record.id)
    .eq("created_by", currentUser.id)
    .select("id,proposal_number,created_at,status,pdf_path,project_id")
    .single();
  if (closed.error) throw closed.error;
  record.number = closed.data.proposal_number;
  record.createdAt = closed.data.created_at;
  record.status = "cerrada";
  record.syncStatus = "synced";
  record.pdfPath = closed.data.pdf_path;
  record.projectId = closed.data.project_id;
  record.lastSyncError = null;
  await dbPut(record);
  await saveCatalogs(record.formData, record.projectId);
  return record;
}
async function syncPending({ silent = false } = {}) {
  if (syncing || !currentUser) return;
  syncing = true;
  try {
    const pending = (await dbAll()).filter(
      (r) =>
        r.ownerId === currentUser.id &&
        r.syncStatus === "pending" &&
        r.payload &&
        r.pdf,
    );
    if (!pending.length) {
      if (!silent)
        showSyncNotice("Todo el histórico local está sincronizado.", "ok");
      return;
    }
    showSyncNotice(
      `Sincronizando ${pending.length} propuesta${pending.length === 1 ? "" : "s"} pendiente${pending.length === 1 ? "" : "s"}…`,
    );
    let failed = 0;
    for (const record of pending) {
      try {
        await syncRecord(record);
      } catch (error) {
        failed++;
        record.lastSyncError = error.message || String(error);
        record.lastSyncAttempt = new Date().toISOString();
        await dbPut(record);
      }
    }
    if (failed)
      showSyncNotice(
        `${pending.length - failed} sincronizadas; ${failed} siguen pendientes. Se reintentará automáticamente.`,
        "error",
      );
    else
      showSyncNotice(
        `${pending.length} propuesta${pending.length === 1 ? "" : "s"} sincronizada${pending.length === 1 ? "" : "s"} correctamente.`,
        "ok",
      );
  } finally {
    syncing = false;
    await refreshHistory({ skipSync: true });
  }
}
async function finalize(e) {
  e.preventDefault();
  if (!$("#truthCheck").checked) {
    $("#truthCheck").reportValidity();
    return;
  }
  const button = $("#finishButton");
  button.disabled = true;
  button.textContent = "Generando y guardando…";
  try {
    if (!currentProject) throw new Error("Selecciona un proyecto");
    const d = data(),
      id = crypto.randomUUID(),
      closedAt = new Date().toISOString();
    currentPdf = await makePdf(d);
    currentRecord = {
      id,
      projectId: currentProject.id,
      projectCode: currentProject.code,
      number: pendingNumber(id),
      createdAt: closedAt,
      closedAt,
      status: "pendiente",
      syncStatus: "pending",
      ownerId: currentUser.id,
      summary: {
        workers: d.workers,
        company: d.company || "Grupo Eiffage",
        zone: d.zone,
      },
      formData: d,
      payload: proposalPayload(d, id),
      pdf: currentPdf,
      pdfPath: null,
      lastSyncError: null,
    };
    await dbPut(currentRecord);
    await dbDelete("current", "drafts");
    let synced = false;
    try {
      currentRecord = await syncRecord(currentRecord);
      currentPdf = currentRecord.pdf;
      synced = true;
    } catch (error) {
      currentRecord.lastSyncError = error.message || String(error);
      currentRecord.lastSyncAttempt = new Date().toISOString();
      await dbPut(currentRecord);
    }
    $("#resultNumber").textContent =
      `${currentRecord.number} · ${d.workers}${synced ? "" : " · Pendiente de sincronización automática"}`;
    renderRecipientButtons();
    $("#resultDialog").showModal();
    await refreshHistory({ skipSync: true });
  } catch (error) {
    console.error(error);
    try {
      await saveDraft(false);
    } catch {}
    alert(
      "No se pudo cerrar la propuesta. El borrador se ha conservado. Motivo: " +
        (error.message || error),
    );
  } finally {
    button.disabled = false;
    button.textContent = "Cerrar y generar PDF";
  }
}

async function loadCatalogs() {
  if (!currentUser || !currentProject) return;
  try {
    const { data: items, error } = await sb
      .from("catalog_items")
      .select("category,value")
      .eq("project_id", currentProject.id)
      .order("use_count", { ascending: false });
    if (error) throw error;
    const ids = {
      empresa: "companyOptions",
      trabajador: "workerOptions",
      zona: "zoneOptions",
      incumplimiento: "deficiencyOptions",
      medida_correctora: "correctiveOptions",
    };
    Object.values(ids).forEach((id) => ($("#" + id).innerHTML = ""));
    $("#workerSelect").innerHTML =
      '<option value="">— Escribir uno nuevo —</option>';
    $("#deficiencySelect").innerHTML =
      '<option value="">— Escribir uno nuevo —</option>';
    $("#correctiveSelect").innerHTML =
      '<option value="">— Escribir una nueva —</option>';
    for (const item of items || []) {
      const list = $("#" + ids[item.category]);
      if (list)
        list.insertAdjacentHTML(
          "beforeend",
          `<option value="${escapeHtml(item.value)}"></option>`,
        );
      const select =
        item.category === "trabajador"
          ? $("#workerSelect")
          : item.category === "incumplimiento"
            ? $("#deficiencySelect")
            : item.category === "medida_correctora"
              ? $("#correctiveSelect")
              : null;
      if (select)
        select.insertAdjacentHTML(
          "beforeend",
          `<option value="${escapeHtml(item.value)}">${escapeHtml(item.value)}</option>`,
        );
    }
  } catch (error) {
    console.warn("Catálogos no disponibles", error);
  }
}
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
function download() {
  downloadBlob(currentPdf, `${currentRecord.number}.pdf`);
}
async function downloadHistoryPdf(id) {
  const local = await dbGet(id);
  if (local?.pdf)
    return downloadBlob(local.pdf, `${local.number || pendingNumber(id)}.pdf`);
  const query = await sb
    .from("proposals")
    .select("proposal_number,pdf_path")
    .eq("id", id)
    .single();
  if (query.error || !query.data?.pdf_path)
    throw new Error("El PDF todavía no está disponible");
  const signed = await sb.storage
    .from("proposal-pdfs")
    .createSignedUrl(query.data.pdf_path, 60);
  if (signed.error) throw signed.error;
  const response = await fetch(signed.data.signedUrl);
  if (!response.ok) throw new Error("No se pudo descargar el PDF");
  downloadBlob(await response.blob(), `${query.data.proposal_number}.pdf`);
}
function sendRecipient(id, channel) {
  const recipient = recipients.find((x) => x.id === id);
  if (!recipient) return;
  const d = currentRecord.formData || data(),
    summary = `Propuesta de mejora ${currentRecord.number}\nProyecto: ${currentProject.name}\nPersona apercibida: ${d.workers}\nEmpresa: ${d.company || "Grupo Eiffage"}\nZona: ${d.zone}\nFecha: ${formatDate(d.inspectionDate)}\n\nAdjuntar el PDF ${currentRecord.number}.pdf.`;
  if (channel === "whatsapp") {
    if (!recipient.phone)
      return alert(
        `El administrador debe configurar el teléfono de ${recipient.name}.`,
      );
    open(
      `https://wa.me/${recipient.phone.replace(/\D/g, "")}?text=${encodeURIComponent(summary)}`,
      "_blank",
      "noopener",
    );
  } else {
    if (!recipient.email)
      return alert(
        `El administrador debe configurar el correo de ${recipient.name}.`,
      );
    open(
      `mailto:${encodeURIComponent(recipient.email)}?subject=${encodeURIComponent(`Propuesta de mejora ${currentRecord.number}`)}&body=${encodeURIComponent(summary)}`,
      "_self",
    );
  }
}
function renderRecipientButtons() {
  $("#recipientButtons").innerHTML =
    recipients
      .filter((x) => x.active)
      .map(
        (r) =>
          `${r.phone ? `<button class="whatsapp recipient-send" data-id="${r.id}" data-channel="whatsapp" type="button">WhatsApp ${escapeHtml(r.name)}</button>` : ""}${r.email ? `<button class="email recipient-send" data-id="${r.id}" data-channel="email" type="button">Correo ${escapeHtml(r.name)}</button>` : ""}`,
      )
      .join("") ||
    '<p class="notice">El administrador todavía no ha configurado los datos de los técnicos destinatarios.</p>';
}
async function shareApp() {
  const url = location.origin + location.pathname,
    text = `Instala Propuestas de mejora · ${currentProject?.name || "Eiffage"} (versión ${APP_VERSION}): ${url}`;
  open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

async function loadRecipients() {
  if (!currentProject) return;
  let { data: rows, error } = await sb
    .from("project_recipients")
    .select("*")
    .eq("project_id", currentProject.id)
    .eq("active", true)
    .order("name");
  if (error) throw error;
  recipients = rows || [];
  const legacyRaw = localStorage.getItem("ayora-settings");
  if (legacyRaw && isProjectAdmin() && currentProject.code === "AY1") {
    try {
      const legacy = JSON.parse(legacyRaw);
      for (const recipient of recipients) {
        const key = recipient.name.toLowerCase();
        const phone = legacy[`${key}Phone`];
        const email = legacy[`${key}Email`];
        if (phone || email)
          await sb
            .from("project_recipients")
            .update({ phone: phone || null, email: email || null })
            .eq("id", recipient.id)
            .eq("project_id", currentProject.id);
      }
      localStorage.removeItem("ayora-settings");
      const refreshed = await sb
        .from("project_recipients")
        .select("*")
        .eq("project_id", currentProject.id)
        .eq("active", true)
        .order("name");
      if (!refreshed.error) recipients = refreshed.data || [];
    } catch (migrationError) {
      console.warn(
        "No se pudo migrar la configuración local de destinatarios",
        migrationError,
      );
    }
  }
  renderRecipientButtons();
}
function isProjectAdmin() {
  return (
    currentProfile?.is_superadmin ||
    memberships.some(
      (m) =>
        m.project_id === currentProject?.id && m.role === "admin" && m.active,
    )
  );
}
async function selectProject(id) {
  currentProject = projects.find((p) => p.id === id) || projects[0];
  if (!currentProject) throw new Error("No tienes ningún proyecto asignado");
  localStorage.setItem("active-project-id", currentProject.id);
  $("#projectSelect").value = currentProject.id;
  $(".topbar span").textContent =
    `${currentProject.name} · ${currentProfile.full_name}`;
  await Promise.all([
    loadRecipients(),
    loadCatalogs(),
    refreshHistory({ skipSync: true }),
  ]);
}
async function loadProjects() {
  const [pr, mem] = await Promise.all([
    sb.from("projects").select("*").eq("active", true).order("name"),
    sb
      .from("project_members")
      .select("project_id,user_id,role,active")
      .eq("user_id", currentUser.id),
  ]);
  if (pr.error) throw pr.error;
  if (mem.error) throw mem.error;
  memberships = mem.data || [];
  projects = (pr.data || []).filter(
    (p) =>
      currentProfile.is_superadmin ||
      memberships.some((m) => m.project_id === p.id && m.active),
  );
  $("#projectSelect").innerHTML = projects
    .map(
      (p) =>
        `<option value="${p.id}">${escapeHtml(p.name)} · ${escapeHtml(p.code)}</option>`,
    )
    .join("");
  await selectProject(localStorage.getItem("active-project-id"));
}
async function refreshHistory({ skipSync = false } = {}) {
  if (!currentProject) return;
  if (!skipSync && !syncing) syncPending({ silent: true });
  const local = (await dbAll()).filter(
      (r) =>
        ((!r.projectId && currentProject.code === "AY1") ||
          r.projectId === currentProject.id) &&
        (!currentUser || !r.ownerId || r.ownerId === currentUser.id),
    ),
    map = new Map();
  for (const r of local) map.set(r.id, { ...r, hasLocalPdf: !!r.pdf });
  try {
    if (currentUser) {
      const { data: remote, error } = await sb
        .from("proposals")
        .select(
          "id,proposal_number,created_at,status,workers,company,zone,pdf_path,project_id",
        )
        .eq("project_id", currentProject.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      for (const r of remote || []) {
        const existing = map.get(r.id);
        map.set(r.id, {
          ...existing,
          id: r.id,
          projectId: r.project_id,
          number: r.proposal_number,
          createdAt: r.created_at,
          status: r.status,
          syncStatus: "synced",
          pdfPath: r.pdf_path,
          summary: {
            workers: (r.workers || []).join(", "),
            company: r.company,
            zone: r.zone,
          },
          hasLocalPdf: !!existing?.pdf,
        });
      }
    }
  } catch (error) {
    console.warn("Histórico remoto no disponible", error);
  }
  const records = [...map.values()].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt)),
  );
  $("#totalCount").textContent = records.length;
  $("#pendingCount").textContent = records.filter(
    (x) =>
      x.syncStatus === "pending" ||
      x.status === "borrador" ||
      x.status === "pendiente",
  ).length;
  $("#closedCount").textContent = records.filter(
    (x) => x.status === "cerrada" || x.status === "corregida",
  ).length;
  $("#historyList").innerHTML = records.length
    ? records
        .map(
          (r) =>
            `<div class="history-item"><div><strong>${escapeHtml(r.number || pendingNumber(r.id))}</strong><span>${escapeHtml(r.summary?.workers || "")} · ${escapeHtml(r.summary?.zone || "")}</span><span>${new Date(r.createdAt).toLocaleString("es-ES")}</span>${r.lastSyncError ? `<span class="history-error">Pendiente: ${escapeHtml(r.lastSyncError)}</span>` : ""}</div><div class="history-actions"><span class="status ${r.syncStatus === "pending" ? "pending-status" : ""}">${r.syncStatus === "pending" ? "Pendiente de sincronizar" : escapeHtml(r.status || "cerrada")}</span>${r.hasLocalPdf || r.pdfPath ? `<button class="secondary history-download" data-id="${r.id}" type="button">Descargar PDF</button>` : ""}</div></div>`,
        )
        .join("")
    : '<p class="empty">Todavía no hay propuestas guardadas.</p>';
}

function renderRecipientSettings() {
  const editable = isProjectAdmin();
  $("#recipientSettingsList").innerHTML = recipients
    .map((recipient) =>
      editable
        ? `<div class="recipient-setting" data-id="${recipient.id}"><strong class="recipient-name">${escapeHtml(recipient.name)}</strong><label>WhatsApp<input name="phone" value="${escapeHtml(recipient.phone || "")}" inputmode="tel" placeholder="34600000000"></label><label>Correo<input name="email" value="${escapeHtml(recipient.email || "")}" type="email"></label><button class="secondary save-recipient" type="button">Guardar</button></div>`
        : `<div class="recipient-readonly"><strong>${escapeHtml(recipient.name)}</strong><span>${escapeHtml(recipient.phone || "Sin teléfono")} · ${escapeHtml(recipient.email || "Sin correo")}</span></div>`,
    )
    .join("");
  $("#addRecipient").classList.toggle("hidden", !editable);
}

function openSettings() {
  $("#settingsProject").textContent =
    `${currentProject.name} · ${currentProject.code} · ${currentProject.worksite}`;
  renderRecipientSettings();
  $("#projectUserAdmin").classList.toggle("hidden", !isProjectAdmin());
  $("#globalProjectAdmin").classList.toggle(
    "hidden",
    !currentProfile.is_superadmin,
  );
  const adminOption = $('#createUserForm option[value="admin"]');
  adminOption.hidden = !currentProfile.is_superadmin;
  if (
    !currentProfile.is_superadmin &&
    $("#createUserForm").role.value === "admin"
  )
    $("#createUserForm").role.value = "member";
  $("#settingsDialog").showModal();
}

async function saveRecipient(button) {
  const row = button.closest(".recipient-setting");
  const phone = row.querySelector('[name="phone"]').value.trim();
  const email = row.querySelector('[name="email"]').value.trim();
  button.disabled = true;
  try {
    const { error } = await sb
      .from("project_recipients")
      .update({ phone: phone || null, email: email || null })
      .eq("id", row.dataset.id)
      .eq("project_id", currentProject.id);
    if (error) throw error;
    await loadRecipients();
    renderRecipientSettings();
  } finally {
    button.disabled = false;
  }
}

async function addRecipient() {
  const name = prompt("Nombre del técnico destinatario:")?.trim();
  if (!name) return;
  const phone = prompt(
    "Teléfono de WhatsApp con prefijo internacional (opcional):",
  )?.trim();
  const email = prompt("Correo corporativo (opcional):")?.trim();
  const { error } = await sb.from("project_recipients").insert({
    project_id: currentProject.id,
    name,
    phone: phone || null,
    email: email || null,
  });
  if (error) throw error;
  await loadRecipients();
  renderRecipientSettings();
}

function authMessage(message, isError = false) {
  const el = $("#authMessage");
  el.textContent = message;
  el.classList.remove("hidden");
  el.classList.toggle("auth-error", isError);
}
async function enterApp(session) {
  currentUser = session.user;
  const { data: profile, error } = await sb
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();
  if (error) {
    authMessage("No se pudo cargar el perfil autorizado.", true);
    await sb.auth.signOut();
    return;
  }
  currentProfile = profile;
  showView("home");
  if (requestedPdfModel && !PDF_MODEL_ALIASES.has(requestedPdfModel))
    showSyncNotice(
      `Aviso: la URL solicita ${requestedPdfModel}, pero esta aplicación solo admite ${PDF_MODEL}.`,
      "error",
    );
  try {
    await loadProjects();
    await syncPending({ silent: true });
  } catch (loadError) {
    showSyncNotice(
      "No se pudo cargar el proyecto autorizado: " + loadError.message,
      "error",
    );
  }
}
$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target)),
    email = d.username.trim().toLowerCase() + "@usuarios.ayora1.es";
  const { data: result, error } = await sb.auth.signInWithPassword({
    email,
    password: d.password,
  });
  if (error) return authMessage("Usuario o contraseña incorrectos.", true);
  authMessage("");
  await enterApp(result.session);
};
$("#showActivation").onclick = () => {
  $("#loginForm").classList.add("hidden");
  $("#showActivation").classList.add("hidden");
  $("#activationForm").classList.remove("hidden");
  $("#authMessage").classList.add("hidden");
};
$("#cancelActivation").onclick = () => {
  $("#activationForm").classList.add("hidden");
  $("#loginForm").classList.remove("hidden");
  $("#showActivation").classList.remove("hidden");
};
$("#activationForm").onsubmit = async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  authMessage("Activando usuario…");
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/activate-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify(d),
      }),
      result = await response.json().catch(() => ({}));
    if (!response.ok || result?.error)
      return authMessage(
        result?.error ||
          `No se pudo activar el usuario (error ${response.status}).`,
        true,
      );
    const login = await sb.auth.signInWithPassword({
      email: d.username.toLowerCase() + "@usuarios.ayora1.es",
      password: d.password,
    });
    if (login.error)
      return authMessage("Usuario activado. Entra con tu contraseña.", false);
    await enterApp(login.data.session);
  } catch (error) {
    authMessage(
      `No se pudo conectar con el servicio de activación: ${error.message}`,
      true,
    );
  }
};
$("#logoutButton").onclick = async () => {
  await sb.auth.signOut();
  currentUser = currentProfile = null;
  hideSyncNotice();
  showView("auth");
};
$("#workerSelect").onchange = (e) => {
  if (e.target.value) form.workers.value = e.target.value;
};
$("#deficiencySelect").onchange = (e) => {
  if (e.target.value) form.deficiencies.value = e.target.value;
};
$("#correctiveSelect").onchange = (e) => {
  if (e.target.value) form.correctiveAction.value = e.target.value;
};
$("#newButton").onclick = async () => {
  resetForm();
  const draft = await dbGet("current", "drafts");
  if (
    draft &&
    (!draft.projectId || draft.projectId === currentProject.id) &&
    confirm(
      `Hay un borrador guardado del ${new Date(draft.savedAt).toLocaleString("es-ES")}. ¿Quieres recuperarlo?`,
    )
  )
    await restoreDraft(draft);
  showView("form");
};
$("#backButton").onclick = () => showView("home");
$("#nextStep").onclick = () => {
  if (validateStep()) {
    currentStep++;
    updateStep();
  }
};
$("#prevStep").onclick = () => {
  currentStep--;
  updateStep();
};
$("#clearSignature").onclick = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  signatureDirty = false;
};
form.onsubmit = finalize;
$$('[name="recipientType"],[name="signatureStatus"]').forEach(
  (x) => (x.onchange = applyConditionalFields),
);
$("#saveDraft").onclick = () =>
  saveDraft(true).catch((error) =>
    alert("No se pudo guardar el borrador: " + error.message),
  );
$("#downloadPdf").onclick = download;
$("#recipientButtons").onclick = (event) => {
  const button = event.target.closest(".recipient-send");
  if (button) sendRecipient(button.dataset.id, button.dataset.channel);
};
$("#shareAppButton").onclick = shareApp;
$("#projectSelect").onchange = (event) =>
  selectProject(event.target.value).catch((error) => alert(error.message));
$("#historyList").onclick = async (e) => {
  const button = e.target.closest(".history-download");
  if (!button) return;
  button.disabled = true;
  try {
    await downloadHistoryPdf(button.dataset.id);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
};
$$("[data-close]").forEach(
  (b) => (b.onclick = () => b.closest("dialog").close()),
);
$("#settingsButton").onclick = openSettings;
$("#recipientSettingsList").onclick = (event) => {
  const button = event.target.closest(".save-recipient");
  if (button)
    saveRecipient(button).catch((error) =>
      alert("No se pudo guardar el técnico: " + error.message),
    );
};
$("#addRecipient").onclick = () =>
  addRecipient().catch((error) =>
    alert("No se pudo añadir el técnico: " + error.message),
  );
$("#createUserForm").onsubmit = async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  const { data: response, error } = await sb.functions.invoke(
    "manage-project",
    {
      body: {
        action: "create_user",
        projectId: currentProject.id,
        username: values.username,
        fullName: values.fullName,
        role: values.role,
        activationPin: values.activationPin,
      },
    },
  );
  const created = response?.data;
  const notice = $("#createdUserMessage");
  notice.classList.remove("hidden", "auth-error");
  if (error || response?.error || !created) {
    notice.textContent =
      "No se pudo crear: " +
      (response?.error || error?.message || "respuesta incompleta");
    notice.classList.add("auth-error");
    return;
  }
  notice.textContent = `Usuario ${created.username} autorizado. Entrégale de forma segura el código inicial: ${values.activationPin}`;
  event.target.reset();
};
$("#createProjectForm").onsubmit = async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  const { data: response, error } = await sb.functions.invoke(
    "manage-project",
    {
      body: {
        action: "create_project",
        code: values.code,
        name: values.name,
        worksite: values.worksite,
        adminUsername: values.adminUsername,
        adminFullName: values.adminFullName,
        activationPin: values.activationPin,
      },
    },
  );
  const projectId = response?.data;
  const notice = $("#createdProjectMessage");
  notice.classList.remove("hidden", "auth-error");
  if (error || response?.error || !projectId) {
    notice.textContent =
      "No se pudo crear: " +
      (response?.error || error?.message || "respuesta incompleta");
    notice.classList.add("auth-error");
    return;
  }
  notice.textContent = `Proyecto creado. Administrador ${values.adminUsername.toUpperCase()}; código inicial: ${values.activationPin}`;
  event.target.reset();
  await loadProjects();
  await selectProject(projectId);
};
window.addEventListener("online", () => syncPending());
window.addEventListener("focus", () => syncPending({ silent: true }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncPending({ silent: true });
});
setInterval(() => syncPending({ silent: true }), 60000);
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("#installButton").classList.remove("hidden");
});
$("#installButton").onclick = async () => {
  await installPrompt?.prompt();
  installPrompt = null;
  $("#installButton").classList.add("hidden");
};
if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register("sw.js?v=11", { updateViaCache: "none" })
    .then((reg) => reg.update())
    .catch(() => {});
(async () => {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (session) await enterApp(session);
  else showView("auth");
})();
