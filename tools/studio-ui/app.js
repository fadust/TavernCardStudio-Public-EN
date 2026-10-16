'use strict';

/* ---------------------------------------------------------------------------
   TavernCardStudio Creator desktop tool · Frontend (native DOM, no framework or CDN)

   Conventions:
   - The #token=... launch fragment supplies the token; immediately store it in sessionStorage
     and clear the fragment with history.replaceState.
   - All /api requests include X-Studio-Token.
   - The page manages local files only; it never executes or previews card scripts, EJS, or UI code.
   - Write every dynamic value with textContent; never use innerHTML.
   --------------------------------------------------------------------------- */

const TOKEN_STORAGE_KEY = 'tavern-card-studio.token';
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
const MAX_COVER_EDGE = 4096;
const MAX_COVER_PIXELS = 24_000_000;
const COUNT_FIELDS = [
  { key: 'worldbook', label: 'Worldbook' },
  { key: 'regex', label: 'Regex' },
  { key: 'scripts', label: 'Scripts' },
  { key: 'greetings', label: 'Greetings' },
];
const STATUS_LABELS = { success: 'Success', warn: 'Warning', error: 'Failed', info: 'Info' };
const MAX_RESULT_ENTRIES = 40;
// The server release manifest identifies examples; the prefix only suggests a copy name.
const EXAMPLE_PREFIX = /^(?:example-|\u793a\u4f8b-)/;
const ONBOARDING_STORAGE_KEY = 'tavern-card-studio.onboarding-done';

const OPEN_TARGETS = [
  { target: 'card', label: 'Card folder' },
  { target: 'source', label: 'Source folder' },
  { target: 'dist', label: 'Output folder' },
  { target: 'root', label: 'Repository root' },
];

/* ===================== Token ===================== */

function readTokenFromHash() {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  if (!raw) return '';
  let value = '';
  try {
    value = new URLSearchParams(raw).get('token') || '';
  } catch (err) {
    value = '';
  }
  if (!value) {
    const match = /(?:^|&)token=([^&]+)/.exec(raw);
    value = match ? decodeURIComponent(match[1]) : '';
  }
  return value.trim();
}

function readStoredToken() {
  try {
    return (sessionStorage.getItem(TOKEN_STORAGE_KEY) || '').trim();
  } catch (err) {
    return '';
  }
}

function storeToken(value) {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, value);
  } catch (err) {
    /* Private browsing may disable sessionStorage; retain the token in memory only. */
  }
}

const hashToken = readTokenFromHash();
if (hashToken) {
  storeToken(hashToken);
  history.replaceState(null, '', location.pathname + location.search);
}
let token = hashToken || readStoredToken();

/* ===================== Utilities ===================== */

class StudioError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'StudioError';
    this.detail = detail === undefined || detail === null ? '' : String(detail);
  }
}

function errorMessage(err) {
  if (err && typeof err.message === 'string' && err.message) return err.message;
  return 'Operation failed. Please try again.';
}

function errorDetail(err) {
  if (err && typeof err.detail === 'string' && err.detail) return err.detail;
  if (err && typeof err.stack === 'string' && err.stack) return err.stack;
  return String(err);
}

function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return bytes + ' B';
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return (value >= 100 ? value.toFixed(0) : value.toFixed(1)) + ' ' + units[index];
}

function formatClock(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

function extensionOf(fileName) {
  const name = String(fileName || '');
  const index = name.lastIndexOf('.');
  return index === -1 ? '' : name.slice(index).toLowerCase();
}

function stripDataUrl(text) {
  const value = String(text || '');
  const index = value.indexOf(',');
  return index === -1 ? value : value.slice(index + 1);
}

function deriveProjectName(fileName) {
  let base = String(fileName || '').replace(/.[^.]+$/, '');
  base = base.replace(/[\\/:*?"<>|]+/g, '-');
  base = base.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  base = base.replace(/^[\.\s]+/, '').replace(/[\.\s]+$/, '');
  return base.slice(0, 80) || 'untitled-card';
}

function validateProjectName(value) {
  const name = String(value || '').trim();
  if (!name) return 'Enter a project name.';
  if (/[\\/:*?"<>|]/.test(name)) return 'Project names cannot contain \\ / : * ? " < > | these characters.';
  if (/^[.\s]/.test(name) || /[.\s]$/.test(name)) return 'Project names cannot start or end with a dot or space.';
  if (name.length > 80) return 'Project names must be at most 80 characters.';
  return '';
}

function textOrDash(value) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text || '—';
}

function isExampleCard(card) {
  return Boolean(card?.officialExample);
}

function officialExamples() {
  return state.cards.filter((card) => isExampleCard(card) && !card.error);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ===================== API ===================== */

async function parseFailure(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    payload = null;
  }
  const raw = payload && typeof payload.error === 'string' ? payload.error.trim() : '';
  const message = raw || 'Request failed (HTTP ' + response.status + ')';
  const error = new StudioError(message, 'HTTP ' + response.status + ' ' + (response.statusText || ''));
  error.fromServer = Boolean(raw);
  return error;
}

async function apiFetch(path, options) {
  const settings = options || {};
  const headers = Object.assign({ 'X-Studio-Token': token }, settings.headers || {});
  let body;
  if (settings.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(settings.body);
  }
  let response;
  try {
    response = await fetch(path, { method: settings.method || 'GET', headers, body, cache: 'no-store' });
  } catch (err) {
    throw new StudioError('Cannot connect to the local service. Make sure the launcher is still running and continue from this page.', errorDetail(err));
  }
  if (!response.ok) {
    const failure = await parseFailure(response);
    if (response.status === 401 || response.status === 403) {
      if (!failure.fromServer) failure.message = 'The access token is invalid or expired. Reopen the tool using the launcher in the repository root.';
      failure.detail = 'HTTP ' + response.status;
      failure.auth = true;
    }
    throw failure;
  }
  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    throw new StudioError('Cannot parse the service response. Check the launcher window log.', errorDetail(err));
  }
  if (!payload || payload.ok !== true) {
    const message = payload && typeof payload.error === 'string' && payload.error ? payload.error : 'The operation did not complete.';
    throw new StudioError(message, 'Response ok is not true');
  }
  return payload;
}

async function fetchCoverBlob(name) {
  let response;
  try {
    response = await fetch('/api/cover?name=' + encodeURIComponent(name), {
      headers: { 'X-Studio-Token': token },
      cache: 'no-store',
    });
  } catch (err) {
    throw new StudioError('Cannot read the cover; the service connection was interrupted.', errorDetail(err));
  }
  if (!response.ok) throw await parseFailure(response);
  return response.blob();
}

/* ===================== DOM helpers ===================== */

function appendChildren(node, children) {
  if (children === null || children === undefined) return;
  if (Array.isArray(children)) {
    for (const child of children) appendChildren(node, child);
    return;
  }
  if (children instanceof Node) {
    node.appendChild(children);
    return;
  }
  node.appendChild(document.createTextNode(String(children)));
}

function el(tag, props, children) {
  const node = document.createElement(tag);
  if (props) {
    for (const key of Object.keys(props)) {
      const value = props[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.setAttribute('class', String(value));
      else if (key === 'text') node.textContent = String(value);
      else if (key === 'style') node.setAttribute('style', String(value));
      else if (key === 'dataset') {
        for (const dataKey of Object.keys(value)) node.dataset[dataKey] = String(value[dataKey]);
      } else if (key === 'on' && typeof value === 'object') {
        for (const eventName of Object.keys(value)) node.addEventListener(eventName, value[eventName]);
      } else if (/^on[A-Z]/.test(key) && typeof value === 'function') {
        // Support handlers such as onClick via listeners; inline attributes are silently blocked by CSP.
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key in node) node[key] = value;
      else node.setAttribute(key, String(value));
    }
  }
  appendChildren(node, children);
  return node;
}

function button(label, options) {
  const config = options || {};
  const node = el('button', {
    type: 'button',
    class: config.class || 'btn',
    text: label,
    title: config.title || null,
  });
  if (config.ariaLabel) node.setAttribute('aria-label', config.ariaLabel);
  if (config.onClick) node.addEventListener('click', config.onClick);
  if (config.disabled) node.disabled = true;
  return applyBusyDisabled(node);
}

// Disable controls created while busy and restore marked controls afterward; beginBusy snapshots existing controls.
function applyBusyDisabled(node) {
  if (busy.depth === 0 || node.disabled) return node;
  node.disabled = true;
  node.dataset.busyDisabled = '1';
  return node;
}

function fieldBlock(labelText, valueText) {
  return el('div', { class: 'meta-item' }, [
    el('span', { class: 'meta-label', text: labelText }),
    el('span', { class: 'meta-value', text: valueText }),
  ]);
}

/* ===================== State ===================== */

const state = {
  root: '',
  cards: [],
  selected: '',
  filter: '',
  cover: null,
  results: [],
  resultsCollapsed: false,
  shutdown: false,
  pendingImport: null,
  pendingCover: null,
  pendingExample: null,
};

const busy = { depth: 0, label: '', startedAt: 0, timer: null };
const busyDisabled = new Map();

let refs = null;
function cacheDom() {
  refs = {
    app: document.getElementById('app'),
    bootNotice: document.getElementById('bootNotice'),
    bootNoticeText: document.getElementById('bootNoticeText'),
    bootNoticeDetail: document.getElementById('bootNoticeDetail'),
    bootRetryBtn: document.getElementById('bootRetryBtn'),
    shutdownNotice: document.getElementById('shutdownNotice'),
    rootPath: document.getElementById('rootPath'),
    busyBar: document.getElementById('busyBar'),
    busyText: document.getElementById('busyText'),
    busyElapsed: document.getElementById('busyElapsed'),
    loadError: document.getElementById('loadError'),
    loadErrorText: document.getElementById('loadErrorText'),
    loadRetryBtn: document.getElementById('loadRetryBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    importBtn: document.getElementById('importBtn'),
    newBtn: document.getElementById('newBtn'),
    shutdownBtn: document.getElementById('shutdownBtn'),
    searchInput: document.getElementById('searchInput'),
    listMeta: document.getElementById('listMeta'),
    cardList: document.getElementById('cardList'),
    listEmpty: document.getElementById('listEmpty'),
    onboarding: document.getElementById('onboarding'),
    onboardingDismissBtn: document.getElementById('onboardingDismissBtn'),
    onboardingNewBtn: document.getElementById('onboardingNewBtn'),
    onboardingImportBtn: document.getElementById('onboardingImportBtn'),
    onboardingExampleBtn: document.getElementById('onboardingExampleBtn'),
    detailPanel: document.getElementById('detailPanel'),
    resultsPanel: document.getElementById('resultsPanel'),
    resultsCount: document.getElementById('resultsCount'),
    resultsToggle: document.getElementById('resultsToggle'),
    resultsClear: document.getElementById('resultsClear'),
    resultsBody: document.getElementById('resultsBody'),
    dropOverlay: document.getElementById('dropOverlay'),
    toastArea: document.getElementById('toastArea'),
    importDialog: document.getElementById('importDialog'),
    importForm: document.getElementById('importForm'),
    importFileName: document.getElementById('importFileName'),
    importFileSize: document.getElementById('importFileSize'),
    importName: document.getElementById('importName'),
    importNote: document.getElementById('importNote'),
    importError: document.getElementById('importError'),
    importFileInput: document.getElementById('importFileInput'),
    newDialog: document.getElementById('newDialog'),
    newForm: document.getElementById('newForm'),
    newName: document.getElementById('newName'),
    newError: document.getElementById('newError'),
    renameDialog: document.getElementById('renameDialog'),
    renameForm: document.getElementById('renameForm'),
    renameProject: document.getElementById('renameProject'),
    renameCharacter: document.getElementById('renameCharacter'),
    renameError: document.getElementById('renameError'),
    duplicateDialog: document.getElementById('duplicateDialog'),
    duplicateForm: document.getElementById('duplicateForm'),
    duplicateSource: document.getElementById('duplicateSource'),
    duplicateName: document.getElementById('duplicateName'),
    duplicateError: document.getElementById('duplicateError'),
    exampleDialog: document.getElementById('exampleDialog'),
    exampleForm: document.getElementById('exampleForm'),
    exampleList: document.getElementById('exampleList'),
    exampleName: document.getElementById('exampleName'),
    exampleNote: document.getElementById('exampleNote'),
    exampleError: document.getElementById('exampleError'),
    exampleSubmit: document.getElementById('exampleSubmit'),
    coverDialog: document.getElementById('coverDialog'),
    coverForm: document.getElementById('coverForm'),
    coverFile: document.getElementById('coverFile'),
    coverPreview: document.getElementById('coverPreview'),
    coverPreviewImage: document.getElementById('coverPreviewImage'),
    coverNote: document.getElementById('coverNote'),
    coverError: document.getElementById('coverError'),
    coverSubmit: document.getElementById('coverSubmit'),
    confirmDialog: document.getElementById('confirmDialog'),
    confirmTitle: document.getElementById('confirmTitle'),
    confirmMessage: document.getElementById('confirmMessage'),
    confirmExtra: document.getElementById('confirmExtra'),
    confirmOk: document.getElementById('confirmOk'),
  };
}

/* ===================== Busy state ===================== */

function updateBusyLabel() {
  if (!refs) return;
  refs.busyText.textContent = busy.label || 'Working…';
}

function updateBusyElapsed() {
  if (!refs || busy.depth === 0) return;
  const seconds = (Date.now() - busy.startedAt) / 1000;
  refs.busyElapsed.textContent = seconds.toFixed(1) + ' seconds';
}

function beginBusy(label) {
  busy.depth += 1;
  if (label) busy.label = label;
  if (busy.depth === 1) {
    busy.startedAt = Date.now();
    busyDisabled.clear();
    document.querySelectorAll('button, input, select, textarea').forEach((node) => {
      if (node.dataset.busyExempt === 'true') return;
      busyDisabled.set(node, node.disabled === true);
      node.disabled = true;
    });
    document.body.classList.add('is-busy');
    refs.busyBar.hidden = false;
    updateBusyElapsed();
    busy.timer = setInterval(updateBusyElapsed, 200);
  }
  updateBusyLabel();
}

function endBusy() {
  busy.depth = Math.max(0, busy.depth - 1);
  if (busy.depth > 0) {
    updateBusyLabel();
    return;
  }
  if (busy.timer) {
    clearInterval(busy.timer);
    busy.timer = null;
  }
  document.body.classList.remove('is-busy');
  refs.busyBar.hidden = true;
  for (const [node, wasDisabled] of busyDisabled) {
    if (document.contains(node)) node.disabled = wasDisabled;
  }
  busyDisabled.clear();
  for (const node of document.querySelectorAll('[data-busy-disabled]')) {
    node.disabled = false;
    delete node.dataset.busyDisabled;
  }
  busy.label = '';
}

function setBusyLabel(text) {
  if (!text) return;
  busy.label = String(text);
  updateBusyLabel();
}

async function run(label, task) {
  beginBusy(label);
  try {
    return await task({ setLabel: setBusyLabel });
  } finally {
    endBusy();
  }
}

/* ===================== Notifications and results ===================== */

function showToast(message, kind) {
  const node = el('div', { class: 'toast toast-' + (kind || 'info'), text: message });
  refs.toastArea.appendChild(node);
  while (refs.toastArea.childElementCount > 3) {
    refs.toastArea.removeChild(refs.toastArea.firstElementChild);
  }
  setTimeout(() => {
    node.classList.add('is-leaving');
    setTimeout(() => {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 260);
  }, 4200);
}

function addResult(entry) {
  state.results.unshift({
    id: 'r' + Date.now() + '-' + state.results.length,
    time: new Date(),
    title: entry.title || 'Operation',
    status: entry.status || 'info',
    summary: entry.summary || [],
    details: entry.details || [],
    actions: entry.actions || [],
  });
  if (state.results.length > MAX_RESULT_ENTRIES) {
    state.results.length = MAX_RESULT_ENTRIES;
  }
  if (state.resultsCollapsed) setResultsCollapsed(false);
  renderResults();
}

function reportFailure(title, err) {
  addResult({
    title,
    status: 'error',
    summary: [errorMessage(err)],
    details: errorDetail(err) ? [{ label: 'Technical details', text: errorDetail(err) }] : [],
  });
}

function setResultsCollapsed(collapsed) {
  state.resultsCollapsed = collapsed;
  refs.resultsBody.hidden = collapsed;
  refs.resultsToggle.textContent = collapsed ? 'Expand' : 'Collapse';
}

function renderResults() {
  refs.resultsBody.textContent = '';
  refs.resultsCount.textContent = state.results.length ? ' (' + state.results.length + ')' : '';
  if (!state.results.length) {
    refs.resultsBody.appendChild(
      el('p', { class: 'results-empty', text: 'No operations yet. Import, check, and build results will remain here.' })
    );
    return;
  }
  for (const entry of state.results) {
    refs.resultsBody.appendChild(renderResultEntry(entry));
  }
}

function renderResultEntry(entry) {
  const head = el('header', { class: 'result-head' }, [
    el('span', { class: 'result-dot', 'aria-hidden': 'true' }),
    el('h3', { class: 'result-title', text: entry.title }),
    el('span', { class: 'result-status', text: STATUS_LABELS[entry.status] || 'Info' }),
    el('time', { class: 'result-time', text: formatClock(entry.time) }),
  ]);
  const body = el('div', { class: 'result-body' });
  for (const line of entry.summary) {
    body.appendChild(el('p', { class: 'result-line', text: line }));
  }
  if (entry.actions.length) {
    const actions = el('div', { class: 'result-actions' });
    for (const action of entry.actions) {
      actions.appendChild(
        button(action.label, {
          class: 'btn btn-small',
          onClick: () => withFailureReport(action.label + ' · ' + entry.title, action.run),
        })
      );
    }
    body.appendChild(actions);
  }
  for (const detail of entry.details) {
    body.appendChild(
      el('details', { class: 'result-details' }, [
        el('summary', { text: detail.label || 'Error details' }),
        el('pre', { class: 'result-pre', text: detail.text }),
      ])
    );
  }
  return el('article', { class: 'result result-' + entry.status }, [head, body]);
}

async function withFailureReport(title, task) {
  try {
    await task();
  } catch (err) {
    reportFailure(title, err);
  }
}

/* ===================== Card list ===================== */

function filteredCards() {
  const query = state.filter.trim().toLowerCase();
  if (!query) return state.cards;
  return state.cards.filter((card) => {
    const haystack = [card.name, card.characterName, card.creator, card.version, (card.tags || []).join(' ')]
      .map((value) => String(value === undefined || value === null ? '' : value).toLowerCase())
      .join(' ');
    return haystack.indexOf(query) !== -1;
  });
}

function selectedCard() {
  if (!state.selected) return null;
  return state.cards.find((card) => card.name === state.selected) || null;
}

function listSummary(items, filtering) {
  const examples = state.cards.filter(isExampleCard).length;
  const mine = state.cards.length - examples;
  const split = 'My cards: ' + mine + ' · Official examples: ' + examples + ' cards';
  if (filtering) return 'Matching ' + items.length + ' / total ' + state.cards.length + ' · ' + split;
  return split + ' · Total: ' + state.cards.length + ' cards';
}

function renderList() {
  refs.cardList.textContent = '';
  const items = filteredCards();
  const filtering = state.filter.trim().length > 0;
  refs.listMeta.textContent = state.cards.length ? listSummary(items, filtering) : '';
  refs.listEmpty.hidden = items.length > 0;
  if (state.cards.length && !items.length) {
    refs.listEmpty.hidden = false;
    refs.listEmpty.querySelector('.empty-title').textContent = 'No matching cards';
    refs.listEmpty.querySelector('.empty-hint').textContent = 'Try another keyword. Search matches project names, character names, creators, and tags.';
  } else if (items.length) {
    refs.listEmpty.hidden = true;
  } else {
    refs.listEmpty.querySelector('.empty-title').textContent = 'No cards yet';
    refs.listEmpty.querySelector('.empty-hint').textContent = 'Use “Import PNG / JSON” to split an existing card, or “New card” to start from a template.';
  }

  for (const card of items) {
    refs.cardList.appendChild(renderCardItem(card));
  }
}

function renderCardItem(card) {
  const top = el('span', { class: 'card-item-top' }, [
    el('span', { class: 'card-item-name', text: card.name }),
  ]);
  if (isExampleCard(card)) top.appendChild(el('span', { class: 'chip chip-example', text: 'Official example' }));
  if (card.error) top.appendChild(el('span', { class: 'chip chip-warn', text: 'Read error' }));
  else if (card.hasCover) top.appendChild(el('span', { class: 'chip chip-soft', text: 'Cover' }));

  const counts = el('span', { class: 'card-item-counts' });
  const countsData = card.counts || {};
  for (const field of COUNT_FIELDS) {
    const value = countsData[field.key];
    if (value === undefined || value === null) continue;
    counts.appendChild(el('span', { class: 'mini-chip', text: field.label + ' ' + value }));
  }

  const item = el(
    'button',
    {
      type: 'button',
      class: 'card-item' + (isExampleCard(card) ? ' is-example' : '') + (card.name === state.selected ? ' is-selected' : ''),
      'aria-pressed': card.name === state.selected ? 'true' : 'false',
      on: { click: () => selectCard(card.name) },
    },
    [top, el('span', { class: 'card-item-sub', text: textOrDash(card.characterName) }), counts]
  );
  return applyBusyDisabled(item);
}

/* ===================== Details ===================== */

function releaseCoverUrl(cover) {
  if (cover && cover.url) {
    try {
      URL.revokeObjectURL(cover.url);
    } catch (err) {
      /* Ignore cleanup failures */
    }
  }
}

function revokeCoverUrl() {
  releaseCoverUrl(state.cover);
}

function selectCard(name, options) {
  const settings = options || {};
  if (state.selected === name && !settings.force) return;
  state.selected = name;
  renderList();
  const card = selectedCard();
  if (!card) {
    revokeCoverUrl();
    state.cover = null;
    renderDetail();
    return;
  }
  loadCover(card);
}

// Fetch the cover after each list refresh: cover changes and renames must invalidate cached state.
function refreshSelectedCover() {
  const card = selectedCard();
  if (!card) {
    revokeCoverUrl();
    state.cover = null;
    renderDetail();
    return;
  }
  // Keep the previous image until its replacement arrives to avoid placeholder flicker.
  loadCover(card, { keepExisting: true });
}

let coverRequest = 0;

async function loadCover(card, options) {
  const settings = options || {};
  const requestId = coverRequest + 1;
  coverRequest = requestId;
  const hasCover = Boolean(card.hasCover);
  const cachedUrl = state.cover && state.cover.name === card.name ? state.cover.url : '';
  // Reuse the old image only for the same card when allowed; otherwise release it immediately.
  const keepUrl = hasCover && settings.keepExisting ? cachedUrl : '';
  if (state.cover && state.cover.url && state.cover.url !== keepUrl) releaseCoverUrl(state.cover);
  state.cover = { name: card.name, status: hasCover ? 'loading' : 'none', url: keepUrl, message: '' };
  renderDetail();
  if (!hasCover) return;
  try {
    const blob = await fetchCoverBlob(card.name);
    // Accept only the latest request so a late response cannot replace a newer cover.
    if (requestId !== coverRequest || state.selected !== card.name) return;
    const url = URL.createObjectURL(blob);
    if (state.cover.url && state.cover.url !== url) releaseCoverUrl(state.cover);
    state.cover = { name: card.name, status: 'ready', url, message: '' };
  } catch (err) {
    if (requestId !== coverRequest || state.selected !== card.name) return;
    // Keep the displayed image on failure and show the error below it.
    const keptUrl = state.cover.url;
    state.cover = { name: card.name, status: keptUrl ? 'ready' : 'error', url: keptUrl, message: errorMessage(err) };
  }
  renderDetail();
}

function renderCoverBox(card) {
  const box = el('div', { class: 'cover' });
  const cover = state.cover && state.cover.name === card.name ? state.cover : null;
  if (cover && cover.url && (cover.status === 'ready' || cover.status === 'loading')) {
    box.appendChild(el('img', { class: 'cover-img', src: cover.url, alt: card.name + ' cover' }));
    if (cover.message) box.appendChild(el('p', { class: 'cover-error', text: cover.message }));
    return box;
  }
  let text = 'No cover set';
  if (cover && cover.status === 'loading') text = 'Loading cover…';
  else if (cover && cover.status === 'error') text = 'Cannot load cover';
  box.appendChild(el('div', { class: 'cover-placeholder', text }));
  if (cover && cover.status === 'error' && cover.message) {
    box.appendChild(el('p', { class: 'cover-error', text: cover.message }));
  }
  return box;
}

function renderStatRow(card) {
  const counts = card.counts || {};
  const row = el('div', { class: 'stat-row' });
  for (const field of COUNT_FIELDS) {
    const value = counts[field.key];
    row.appendChild(
      el('div', { class: 'stat' }, [
        el('span', { class: 'stat-value', text: value === undefined || value === null ? '—' : String(value) }),
        el('span', { class: 'stat-label', text: field.label }),
      ])
    );
  }
  return row;
}

function renderInfo(card) {
  const tags = Array.isArray(card.tags) ? card.tags.filter((tag) => String(tag || '').trim()) : [];
  const tagBox = el('div', { class: 'tag-row' });
  if (tags.length) {
    for (const tag of tags) tagBox.appendChild(el('span', { class: 'tag', text: String(tag) }));
  } else {
    tagBox.appendChild(el('span', { class: 'tag tag-empty', text: 'No tags' }));
  }

  return el('div', { class: 'detail-info' }, [
    el('div', { class: 'detail-heading' }, [
      el('h2', { class: 'detail-name', text: card.name }),
      isExampleCard(card) ? el('span', { class: 'chip chip-example', text: 'Official example' }) : null,
      card.hasCover ? el('span', { class: 'chip chip-soft', text: 'Has cover' }) : el('span', { class: 'chip', text: 'No cover' }),
    ]),
    el('p', { class: 'detail-character' }, [
      el('span', { class: 'detail-character-label', text: 'Character name: ' }),
      el('span', { class: 'detail-character-value', text: textOrDash(card.characterName) }),
    ]),
    el('div', { class: 'meta-grid' }, [
      fieldBlock('Source', isExampleCard(card) ? 'Official example (copy before editing)' : 'My card'),
      fieldBlock('Creator', textOrDash(card.creator)),
      fieldBlock('Version', textOrDash(card.version)),
      fieldBlock('Source files (shared by you and AI)', 'cards/' + card.name + '/src'),
    ]),
    el('div', { class: 'meta-grid' }, [
      fieldBlock('Archived original card', card.importPath || 'New card or older project; verification copy in original/'),
      fieldBlock('Build output', 'dist/' + card.name),
    ]),
    renderStatRow(card),
    el('div', { class: 'meta-item meta-item-wide' }, [
      el('span', { class: 'meta-label', text: 'Tags' }),
      tagBox,
    ]),
  ]);
}

function renderActions(card) {
  const groups = [
    {
      title: 'Build and check',
      actions: [
        { label: 'Check', run: () => checkCard(card.name) },
        { label: 'Build', run: () => buildCard(card.name), primary: true },
      ],
    },
    {
      title: 'Project',
      actions: [
        ...(isExampleCard(card) ? [{ label: 'Copy as my card', run: () => openExampleDialog(card.name) }] : []),
        { label: 'Rename', run: () => openRenameDialog(card) },
        { label: 'Copy card', run: () => openDuplicateDialog(card) },
      ],
    },
    {
      title: 'Worldbook',
      actions: [
        {
          label: 'Organize worldbook',
          run: () => organizeCard(card.name),
          title: 'Organize worldbook files by category and entry name, updating references. Save and close editors for this project first; the tool backs up the original project.',
        },
        {
          label: 'Number in prompt order',
          run: () => arrangeCard(card.name),
          title: 'Order entries before character → after character → at depth (deepest first), renumber 1..N, and update index, order, and display index after backing up. This changes prompt budget priority across positions; verify in the host. For author notes, example messages, and outlets, arrange the index in host order first, then run --order index.',
        },
      ],
    },
    {
      title: 'Cover',
      actions: [
        { label: 'Change cover', run: () => openCoverDialog(card) },
        { label: card.hasCover ? 'Remove cover' : 'Remove cover (none set)', run: () => removeCover(card), disabled: !card.hasCover },
      ],
    },
    {
      title: 'Open folder',
      actions: OPEN_TARGETS.map((item) => ({
        label: item.label,
        small: true,
        run: () => openTarget(card.name, item.target, item.label),
      })),
    },
  ];

  const grid = el('div', { class: 'actions-grid' });
  for (const group of groups) {
    const box = el('div', { class: 'action-group' }, [el('h3', { class: 'action-title', text: group.title })]);
    const row = el('div', { class: 'action-row' });
    for (const action of group.actions) {
      row.appendChild(
        button(action.label, {
          class: 'btn' + (action.primary ? ' btn-primary' : '') + (action.small ? ' btn-small' : ''),
          disabled: action.disabled,
          title: action.title,
          onClick: action.run,
        })
      );
    }
    box.appendChild(row);
    grid.appendChild(box);
  }
  return grid;
}

function renderDetail() {
  refs.detailPanel.textContent = '';
  const card = selectedCard();
  if (!card) {
    refs.detailPanel.appendChild(
      el('div', { class: 'detail-empty' }, [
        el('h2', { class: 'empty-title', text: 'Select a card to begin' }),
        el('p', { class: 'empty-hint', text: 'Projects in cards/ appear on the left. Select one to check, build, rename, change its cover, or open its folders.' }),
        el('p', { class: 'empty-hint muted', text: 'This tool reads and writes files; it never executes or previews card scripts or UI code.' }),
      ])
    );
    return;
  }
  const head = el('div', { class: 'detail-head' }, [renderCoverBox(card), renderInfo(card)]);
  refs.detailPanel.appendChild(head);
  if (isExampleCard(card)) {
    refs.detailPanel.appendChild(
      el('div', { class: 'alert alert-note' }, [
        el('p', { class: 'alert-text', text: 'This is an official example. Use “Copy as my card” to create your own project before editing.' }),
        el('p', { class: 'alert-hint', text: 'After copying, edit cards/new-project/src; builds go to dist/new-project/.' }),
      ])
    );
  }
  if (card.error) {
    refs.detailPanel.appendChild(
      el('div', { class: 'alert alert-warn' }, [
        el('p', { class: 'alert-text', text: 'Cannot read this card: ' + String(card.error) }),
        el('p', { class: 'alert-hint', text: 'Fix the project files, then click “Refresh” to load them again.' }),
      ])
    );
  }
  refs.detailPanel.appendChild(renderActions(card));
}

/* ===================== Load list ===================== */

function setLoadError(message) {
  if (!message) {
    refs.loadError.hidden = true;
    refs.loadErrorText.textContent = '';
    return;
  }
  refs.loadErrorText.textContent = message;
  refs.loadError.hidden = false;
}

async function loadCards(options) {
  const settings = options || {};
  if (!settings.silentBusy) beginBusy('Loading cards…');
  try {
    const payload = await apiFetch('/api/cards');
    state.root = typeof payload.root === 'string' ? payload.root : '';
    state.cards = Array.isArray(payload.cards) ? payload.cards : [];
    if (state.selected && !state.cards.some((card) => card.name === state.selected)) {
      state.selected = '';
      revokeCoverUrl();
      state.cover = null;
    }
    refs.rootPath.textContent = state.root || '(root directory not provided)';
    refs.rootPath.title = state.root || '';
    setLoadError('');
    renderList();
    refreshSelectedCover();
  } catch (err) {
    if (err && err.auth) {
      showBootNotice(errorMessage(err));
      return;
    }
    setLoadError(errorMessage(err));
    if (!settings.quiet) reportFailure('Load cards', err);
  } finally {
    if (!settings.silentBusy) endBusy();
  }
}

/* ===================== Dialog behavior ===================== */

function showDialog(dialog) {
  if (busy.depth > 0) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

function wireDialogChrome() {
  const dialogs = ['importDialog', 'newDialog', 'exampleDialog', 'renameDialog', 'duplicateDialog', 'coverDialog', 'confirmDialog'];
  for (const key of dialogs) {
    const dialog = refs[key];
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && busy.depth === 0) closeDialog(dialog);
    });
    dialog.addEventListener('cancel', (event) => {
      if (busy.depth > 0) event.preventDefault();
    });
    for (const closeBtn of dialog.querySelectorAll('[data-close]')) {
      closeBtn.addEventListener('click', () => {
        if (busy.depth === 0) closeDialog(dialog);
      });
    }
  }
}

function showFieldError(node, message) {
  if (!message) {
    node.textContent = '';
    node.hidden = true;
    return;
  }
  node.textContent = message;
  node.hidden = false;
}

/* ===================== Import ===================== */

function acceptsImport(file) {
  const ext = extensionOf(file.name);
  return ext === '.png' || ext === '.json';
}

function openImportDialog(file) {
  if (!file) return;
  if (!acceptsImport(file)) {
    reportFailure('Import card', new StudioError('Only PNG or JSON files are supported. Selected: “' + file.name + '”.'));
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    reportFailure(
      'Import card',
      new StudioError(
        'File exceeds the 64 MiB limit: “' + file.name + '” is ' + formatBytes(file.size) + '. Compress or crop it first.'
      )
    );
    return;
  }
  state.pendingImport = { file };
  refs.importFileName.textContent = file.name;
  refs.importFileSize.textContent = formatBytes(file.size);
  refs.importName.value = deriveProjectName(file.name);
  refs.importNote.textContent = 'The full original is archived in imports/ and split files go to cards/project-name/src/. Edit them yourself or with AI, then build to dist/project-name/. Different originals with the same name receive a suffix; existing projects are never overwritten.';
  showFieldError(refs.importError, '');
  showDialog(refs.importDialog);
  setTimeout(() => refs.importName.focus(), 30);
}

function readFileAsBase64(file, setLabel) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(stripDataUrl(reader.result));
    reader.onerror = () =>
      reject(new StudioError('Cannot read the file. Try again or select another file.', reader.error ? String(reader.error.message || reader.error) : 'FileReader error'));
    reader.onabort = () => reject(new StudioError('File reading was canceled.'));
    reader.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      setLabel('Reading ' + file.name + ' (' + percent + '%)…');
    };
    setLabel('Reading ' + file.name + '…');
    reader.readAsDataURL(file);
  });
}

async function submitImport() {
  const pending = state.pendingImport;
  if (!pending) return;
  const name = refs.importName.value.trim();
  const nameIssue = validateProjectName(name);
  if (nameIssue) {
    showFieldError(refs.importError, nameIssue);
    return;
  }
  showFieldError(refs.importError, '');
  let importedName = name;
  try {
    await run('Importing card…', async ({ setLabel }) => {
      const base64 = await readFileAsBase64(pending.file, setLabel);
      setLabel('Importing and splitting “' + name + '”…');
      const payload = await apiFetch('/api/import', {
        method: 'POST',
        body: { filename: pending.file.name, base64, name },
      });
      if (typeof payload.name === 'string' && payload.name) importedName = payload.name;
      const notes = classificationNotes(payload.classification);
      addResult({
        title: 'Import card · ' + importedName,
        status: 'success',
        summary: [
          'Source file: ' + pending.file.name + ' (' + formatBytes(pending.file.size) + ')',
          payload.message ? String(payload.message) : 'Split into cards/' + importedName,
          ...notes.lines,
        ],
        details: notes.details,
      });
      // Keep refresh and selection in the same busy operation to prevent selection races.
      state.selected = '';
      revokeCoverUrl();
      state.cover = null;
      await loadCards({ silentBusy: true });
      if (state.cards.some((card) => card.name === importedName)) selectCard(importedName);
    });
  } catch (err) {
    showFieldError(refs.importError, errorMessage(err));
    reportFailure('Import card · ' + pending.file.name, err);
    return;
  }
  state.pendingImport = null;
  closeDialog(refs.importDialog);
  dismissOnboarding();
  showToast('Imported “' + importedName + '”', 'success');
}

/* ===================== New ===================== */

function openNewDialog() {
  refs.newName.value = '';
  refs.newError.hidden = true;
  refs.newError.textContent = '';
  for (const box of refs.newForm.querySelectorAll('input[type="checkbox"]')) box.checked = false;
  showDialog(refs.newDialog);
  setTimeout(() => refs.newName.focus(), 30);
}

function selectedModules() {
  const modules = [];
  for (const box of refs.newForm.querySelectorAll('input[type="checkbox"]')) {
    if (box.checked) modules.push(box.value);
  }
  return modules;
}

function enforceModuleExclusion(changed) {
  if (!changed || !changed.checked) return;
  if (changed.value !== 'html' && changed.value !== 'vue') return;
  const other = changed.value === 'html' ? 'vue' : 'html';
  for (const box of refs.newForm.querySelectorAll('input[type="checkbox"]')) {
    if (box.value === other) box.checked = false;
  }
}

async function submitNew() {
  const name = refs.newName.value.trim();
  const nameIssue = validateProjectName(name);
  if (nameIssue) {
    showFieldError(refs.newError, nameIssue);
    return;
  }
  showFieldError(refs.newError, '');
  const modules = selectedModules();
  let createdName = name;
  try {
    await run('Creating “' + name + '”…', async () => {
      const payload = await apiFetch('/api/new', { method: 'POST', body: { name, modules } });
      if (typeof payload.name === 'string' && payload.name) createdName = payload.name;
      addResult({
        title: 'New card · ' + createdName,
        status: 'success',
        summary: [
          modules.length ? 'Modules: ' + modules.join(', ') : 'Modules: none (text-only card)',
          payload.message ? String(payload.message) : 'Created cards/' + createdName,
        ],
      });
      state.selected = '';
      revokeCoverUrl();
      state.cover = null;
      await loadCards({ silentBusy: true });
      if (state.cards.some((card) => card.name === createdName)) selectCard(createdName);
    });
  } catch (err) {
    showFieldError(refs.newError, errorMessage(err));
    reportFailure('New card · ' + name, err);
    return;
  }
  closeDialog(refs.newDialog);
  dismissOnboarding();
  showToast('Created “' + createdName + '”', 'success');
}

/* ===================== Official examples / Onboarding ===================== */

function onboardingDone() {
  try {
    return localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';
  } catch (err) {
    return false;
  }
}

function updateOnboarding() {
  refs.onboarding.hidden = onboardingDone();
}

function dismissOnboarding() {
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
  } catch (err) {
    /* If private browsing disables localStorage, hide onboarding for this page only. */
  }
  refs.onboarding.hidden = true;
}

function defaultCopyName(sourceName) {
  const source = String(sourceName || '');
  const base = source.replace(EXAMPLE_PREFIX, '') || 'my-card';
  const taken = new Set(state.cards.map((card) => String(card.name).toLowerCase()));
  let candidate = base;
  if (taken.has(candidate.toLowerCase())) candidate = base + '-copy';
  let index = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = base + '-copy' + index;
    index += 1;
  }
  return candidate.slice(0, 80);
}

function selectExampleSource(name) {
  state.pendingExample = name;
  refs.exampleName.value = defaultCopyName(name);
  refs.exampleNote.textContent = 'The copy is a normal project: you and AI edit cards/new-project/src; builds go to dist/new-project/.';
}

function openExampleDialog(sourceName) {
  state.pendingExample = null;
  showFieldError(refs.exampleError, '');
  refs.exampleList.textContent = '';
  const examples = officialExamples();
  if (!examples.length) {
    refs.exampleList.appendChild(
      el('p', { class: 'note', text: 'No official examples are available. Start with “New card”, or restore the example directories from the complete release.' })
    );
    refs.exampleName.value = '';
    refs.exampleNote.textContent = '';
    refs.exampleSubmit.disabled = true;
    showDialog(refs.exampleDialog);
    return;
  }
  refs.exampleSubmit.disabled = false;
  const entries = [];
  for (const card of examples) {
    const input = el('input', { type: 'radio', name: 'exampleSource', value: card.name });
    input.addEventListener('change', () => {
      if (input.checked) selectExampleSource(card.name);
    });
    const counts = card.counts || {};
    const summary = [
      card.characterName ? 'Character: ' + card.characterName : '',
      counts.worldbook ? 'Worldbook ' + counts.worldbook : '',
      counts.regex ? 'Regex ' + counts.regex : '',
      counts.scripts ? 'Scripts ' + counts.scripts : '',
    ].filter(Boolean).join(' · ');
    entries.push({ name: card.name, input });
    refs.exampleList.appendChild(
      el('label', { class: 'example-option' }, [
        input,
        el('span', { class: 'example-option-body' }, [
          el('span', { class: 'example-option-name', text: card.name }),
          el('span', { class: 'example-option-sub', text: summary || 'Official example card' }),
        ]),
      ])
    );
  }
  const initial = entries.find((entry) => entry.name === sourceName) || entries[0];
  initial.input.checked = true;
  selectExampleSource(initial.name);
  showDialog(refs.exampleDialog);
  setTimeout(() => {
    refs.exampleName.focus();
    refs.exampleName.select();
  }, 30);
}

async function submitExampleCopy() {
  const source = state.pendingExample;
  if (!source) {
    showFieldError(refs.exampleError, 'Select an official example first.');
    return;
  }
  const newName = refs.exampleName.value.trim();
  const nameIssue = validateProjectName(newName);
  if (nameIssue) {
    showFieldError(refs.exampleError, nameIssue);
    return;
  }
  if (newName.toLowerCase() === source.toLowerCase()) {
    showFieldError(refs.exampleError, 'Choose a project name different from the example to create your own card.');
    return;
  }
  showFieldError(refs.exampleError, '');
  let createdName = newName;
  try {
    await run('Copying example “' + source + '”…', async () => {
      const payload = await apiFetch('/api/duplicate', { method: 'POST', body: { name: source, newName } });
      if (typeof payload.name === 'string' && payload.name) createdName = payload.name;
      addResult({
        title: 'Copy official example · ' + createdName,
        status: 'success',
        summary: [
          'Source: ' + source + ' (the original example is unchanged)',
          'Source: cards/' + createdName + '/src (shared by you and AI)',
          'Build output: dist/' + createdName,
        ],
      });
      state.selected = '';
      revokeCoverUrl();
      state.cover = null;
      await loadCards({ silentBusy: true });
      if (state.cards.some((card) => card.name === createdName)) selectCard(createdName);
    });
  } catch (err) {
    showFieldError(refs.exampleError, errorMessage(err));
    reportFailure('Copy official example · ' + source, err);
    return;
  }
  state.pendingExample = null;
  closeDialog(refs.exampleDialog);
  dismissOnboarding();
  showToast('Copied example to “' + createdName + '”', 'success');
}

/* ===================== Rename / Copy ===================== */

function openRenameDialog(card) {
  refs.renameProject.value = card.name;
  refs.renameCharacter.value = card.characterName ? String(card.characterName) : '';
  showFieldError(refs.renameError, '');
  showDialog(refs.renameDialog);
  setTimeout(() => refs.renameProject.focus(), 30);
}

async function submitRename() {
  const card = selectedCard();
  if (!card) {
    showFieldError(refs.renameError, 'Select a card first.');
    return;
  }
  const newName = refs.renameProject.value.trim();
  const nameIssue = validateProjectName(newName);
  if (nameIssue) {
    showFieldError(refs.renameError, nameIssue);
    return;
  }
  const characterName = refs.renameCharacter.value.trim();
  const body = { name: card.name, newName };
  if (characterName) body.characterName = characterName;
  showFieldError(refs.renameError, '');
  let renamedTo = newName;
  try {
    await run('Renaming “' + card.name + '”…', async () => {
      const payload = await apiFetch('/api/rename', { method: 'POST', body });
      if (typeof payload.name === 'string' && payload.name) renamedTo = payload.name;
      const characterLine = characterName
        ? 'Character name: ' + textOrDash(card.characterName) + ' → ' + characterName
        : 'Character name: unchanged (' + textOrDash(card.characterName) + ')';
      addResult({
        title: 'Rename · ' + card.name,
        status: 'success',
        summary: ['Project name: ' + card.name + ' → ' + renamedTo, characterLine],
      });
      state.selected = '';
      revokeCoverUrl();
      state.cover = null;
      await loadCards({ silentBusy: true });
      selectCard(renamedTo);
    });
  } catch (err) {
    showFieldError(refs.renameError, errorMessage(err));
    reportFailure('Rename · ' + card.name, err);
    return;
  }
  closeDialog(refs.renameDialog);
  showToast('Renamed to “' + renamedTo + '”', 'success');
}

function openDuplicateDialog(card) {
  refs.duplicateSource.textContent = 'Source card: ' + card.name + ' (Character name: ' + textOrDash(card.characterName) + ')';
  refs.duplicateName.value = deriveProjectName(card.name + '-copy');
  showFieldError(refs.duplicateError, '');
  showDialog(refs.duplicateDialog);
  setTimeout(() => refs.duplicateName.focus(), 30);
}

async function submitDuplicate() {
  const card = selectedCard();
  if (!card) {
    showFieldError(refs.duplicateError, 'Select a card first.');
    return;
  }
  const newName = refs.duplicateName.value.trim();
  const nameIssue = validateProjectName(newName);
  if (nameIssue) {
    showFieldError(refs.duplicateError, nameIssue);
    return;
  }
  if (newName === card.name) {
    showFieldError(refs.duplicateError, 'Choose a project name different from the source card.');
    return;
  }
  showFieldError(refs.duplicateError, '');
  let createdName = newName;
  try {
    await run('Copying “' + card.name + '”…', async () => {
      const payload = await apiFetch('/api/duplicate', { method: 'POST', body: { name: card.name, newName } });
      if (typeof payload.name === 'string' && payload.name) createdName = payload.name;
      addResult({
        title: 'Copy card · ' + createdName,
        status: 'success',
        summary: [card.name + ' → ' + createdName, payload.message ? String(payload.message) : 'Created cards/' + createdName],
      });
      state.selected = '';
      revokeCoverUrl();
      state.cover = null;
      await loadCards({ silentBusy: true });
      if (state.cards.some((item) => item.name === createdName)) selectCard(createdName);
    });
  } catch (err) {
    showFieldError(refs.duplicateError, errorMessage(err));
    reportFailure('Copy card · ' + card.name, err);
    return;
  }
  closeDialog(refs.duplicateDialog);
  showToast('Copied as “' + createdName + '”', 'success');
}

/* ===================== Cover ===================== */

function openCoverDialog(card) {
  state.pendingCover = null;
  refs.coverFile.value = '';
  refs.coverPreview.hidden = true;
  refs.coverPreviewImage.removeAttribute('src');
  refs.coverNote.textContent = card.hasCover
    ? 'This image will replace the current cover.'
    : 'This card has no cover. This image will become its cover.';
  showFieldError(refs.coverError, '');
  refs.coverSubmit.disabled = true;
  showDialog(refs.coverDialog);
}

function resetPendingCover() {
  if (state.pendingCover && state.pendingCover.previewUrl) {
    try {
      URL.revokeObjectURL(state.pendingCover.previewUrl);
    } catch (err) {
      /* Ignore cleanup failures */
    }
  }
  state.pendingCover = null;
  refs.coverPreview.hidden = true;
  refs.coverPreviewImage.removeAttribute('src');
  refs.coverSubmit.disabled = true;
}

function isCoverImage(file) {
  const ext = extensionOf(file.name);
  return ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp';
}

async function convertCoverToPng(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    throw new StudioError('Cannot read this image. Select another PNG, JPEG, or WebP image.', errorDetail(err));
  }
  try {
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    if (!sourceWidth || !sourceHeight) throw new StudioError('Invalid image dimensions; cannot convert.');
    if (sourceWidth * sourceHeight > MAX_COVER_PIXELS) {
      throw new StudioError(
        'Original image ' + sourceWidth + '×' + sourceHeight + ' exceeds 24 megapixels. Resize it to at most 24 megapixels before uploading.'
      );
    }
    const longEdge = Math.max(sourceWidth, sourceHeight);
    let scale = longEdge > MAX_COVER_EDGE ? MAX_COVER_EDGE / longEdge : 1;
    let targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    let targetHeight = Math.max(1, Math.round(sourceHeight * scale));
    if (targetWidth * targetHeight > MAX_COVER_PIXELS) {
      const shrink = Math.sqrt(MAX_COVER_PIXELS / (targetWidth * targetHeight));
      targetWidth = Math.max(1, Math.floor(targetWidth * shrink));
      targetHeight = Math.max(1, Math.floor(targetHeight * shrink));
    }
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new StudioError('This browser cannot process images. Open the tool in a recent Chrome or Edge version.');
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    let dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (err) {
      throw new StudioError('Cannot convert the image to PNG. Try another image.', errorDetail(err));
    }
    const base64 = stripDataUrl(dataUrl);
    const bytes = Math.floor((base64.length * 3) / 4);
    if (!base64) throw new StudioError('Image conversion produced no data. Try another image.');
    return {
      base64,
      width: targetWidth,
      height: targetHeight,
      sourceWidth,
      sourceHeight,
      sourceBytes: file.size,
      bytes,
      scaled: targetWidth !== sourceWidth || targetHeight !== sourceHeight,
      dataUrl,
    };
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

async function handleCoverFile(file) {
  resetPendingCover();
  if (!file) return;
  if (!isCoverImage(file)) {
    showFieldError(refs.coverError, 'Covers support PNG, JPEG, or WebP. Selected: “' + file.name + '”.');
    return;
  }
  showFieldError(refs.coverError, '');
  refs.coverNote.textContent = 'Converting “' + file.name + '”…';
  let result;
  try {
    result = await run('Converting cover…', () => convertCoverToPng(file));
  } catch (err) {
    refs.coverNote.textContent = 'This image cannot be saved yet.';
    showFieldError(refs.coverError, errorMessage(err));
    reportFailure('Convert cover · ' + file.name, err);
    return;
  }
  const previewUrl = URL.createObjectURL(dataUrlToBlob(result.dataUrl));
  state.pendingCover = { file, result, previewUrl };
  refs.coverPreviewImage.src = previewUrl;
  refs.coverPreview.hidden = false;
  refs.coverSubmit.disabled = busy.depth > 0 ? true : false;
  refs.coverNote.textContent =
    'Converted to PNG: ' +
    result.sourceWidth +
    '×' +
    result.sourceHeight +
    ' → ' +
    result.width +
    '×' +
    result.height +
    ' (' +
    (result.scaled ? 'resized proportionally, no cropping' : 'original dimensions retained') +
    ', about ' +
    formatBytes(result.bytes) +
    ').';
}

function dataUrlToBlob(dataUrl) {
  const parts = String(dataUrl).split(',');
  const meta = parts[0] || '';
  const mimeMatch = /:(.*?);/.exec(meta);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const binary = atob(parts[1] || '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

async function submitCover() {
  const card = selectedCard();
  if (!card) {
    showFieldError(refs.coverError, 'Select a card first.');
    return;
  }
  const pending = state.pendingCover;
  if (!pending) {
    showFieldError(refs.coverError, 'Select an image first.');
    return;
  }
  showFieldError(refs.coverError, '');
  try {
    await run('Saving cover…', async () => {
      const payload = await apiFetch('/api/cover', {
        method: 'POST',
        body: { name: card.name, base64: pending.result.base64 },
      });
      addResult({
        title: 'Change cover · ' + card.name,
        status: 'success',
        summary: [
          pending.file.name + ' → PNG ' + pending.result.width + '×' + pending.result.height + ' (about ' + formatBytes(pending.result.bytes) + ')',
          payload.message ? String(payload.message) : 'Cover saved.',
        ],
      });
      // Reload cards and cover within the same busy operation to show the newly saved image.
      await loadCards({ silentBusy: true });
    });
  } catch (err) {
    showFieldError(refs.coverError, errorMessage(err));
    reportFailure('Change cover · ' + card.name, err);
    return;
  }
  resetPendingCover();
  closeDialog(refs.coverDialog);
  showToast('Updated cover for “' + card.name + '”', 'success');
}

async function removeCover(card) {
  const confirmed = await askConfirm({
    title: 'Remove cover',
    message: 'Remove the cover from “' + card.name + '”?',
    extra: 'The project and card content remain unchanged; builds will omit the cover image.',
    confirmLabel: 'Remove cover',
    danger: true,
  });
  if (!confirmed) return;
  await withFailureReport('Remove cover · ' + card.name, async () => {
    await run('Removing cover…', async () => {
      const payload = await apiFetch('/api/remove-cover', { method: 'POST', body: { name: card.name } });
      addResult({
        title: 'Remove cover · ' + card.name,
        status: 'success',
        summary: [payload.message ? String(payload.message) : 'Cover removed.'],
      });
      await loadCards({ silentBusy: true });
    });
  });
}

/* ===================== Check / Build / Open folder ===================== */

async function checkCard(name) {
  await withFailureReport('Check · ' + name, async () => {
    await run('Checking “' + name + '”…', async () => {
      const payload = await apiFetch('/api/check', { method: 'POST', body: { name } });
      const report = payload.report || {};
      const errors = Array.isArray(report.errors) ? report.errors : [];
      const warnings = Array.isArray(report.warnings) ? report.warnings : [];
      const passed = report.ok === true;
      const details = [];
      if (errors.length) details.push({ label: 'Errors (' + errors.length + ')', text: errors.join('\n') });
      if (warnings.length) details.push({ label: 'Warning (' + warnings.length + ')', text: warnings.join('\n') });
      addResult({
        title: 'Check · ' + name,
        status: passed ? (warnings.length ? 'warn' : 'success') : 'error',
        summary: [
          passed ? 'Check passed' : 'Check failed',
          errors.length || warnings.length
            ? 'Errors: ' + errors.length + '; warnings: ' + warnings.length + '.'
            : 'No errors or warnings.',
          'Static checks validate parsing and compilation; they do not verify behavior in SillyTavern.',
        ],
        details,
      });
    });
  });
}

async function buildCard(name) {
  await withFailureReport('Build · ' + name, async () => {
    await run('Building “' + name + '”…', async () => {
      const payload = await apiFetch('/api/build', { method: 'POST', body: { name } });
      const files = Array.isArray(payload.files) ? payload.files : [];
      const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
      const directory = payload.directory ? String(payload.directory) : 'dist/' + name;
      const summary = ['Output folder: ' + directory];
      const pngs = files.filter((file) => /\.png$/i.test(String(file)));
      const jsons = files.filter((file) => /\.json$/i.test(String(file)));
      if (pngs.length) summary.push('Generated PNG: ' + pngs.join(', '));
      if (jsons.length) summary.push('Generated JSON: ' + jsons.join(', '));
      if (!files.length) summary.push('The service did not report file names. Check the output directory.');
      if (warnings.length) summary.push('Warning ' + warnings.length + '; expand to view.');
      const details = [];
      if (files.length) details.push({ label: 'Files (' + files.length + ')', text: files.join('\n') });
      if (warnings.length) details.push({ label: 'Warning (' + warnings.length + ')', text: warnings.join('\n') });
      addResult({
        title: 'Build · ' + name,
        status: warnings.length ? 'warn' : 'success',
        summary,
        details,
        actions: [
          { label: 'OpenOutput folder', run: () => openTarget(name, 'dist', 'Output folder') },
          { label: 'OpenCard folder', run: () => openTarget(name, 'card', 'Card folder') },
          { label: 'OpenSource folder', run: () => openTarget(name, 'source', 'Source folder') },
        ],
      });
    });
  });
}

async function openTarget(name, target, label) {
  await withFailureReport('Open ' + label + ' · ' + name, async () => {
    await run('Opening ' + label + '…', async () => {
      await apiFetch('/api/open', { method: 'POST', body: { name, target } });
      addResult({
        title: 'Open ' + label + ' · ' + name,
        status: 'success',
        summary: ['Requested the system file manager to open the folder.'],
      });
    });
  });
}

async function organizeCard(name) {
  const card = state.cards.find((item) => item.name === name);
  const worldbookCount = card && card.counts ? Number(card.counts.worldbook) || 0 : 0;
  await withFailureReport('Organize worldbook · ' + name, async () => {
    await run('Organizing worldbook for “' + name + '”…', async () => {
      const payload = await apiFetch('/api/organize', { method: 'POST', body: { name } });
      const changes = Array.isArray(payload.changes) ? payload.changes : [];
      const backup = typeof payload.backup === 'string' && payload.backup ? payload.backup : '';
      const organized = payload.organized === true;
      // List only settings paths when bodies are unchanged to avoid duplicate paths.
      const entries = changes
        .filter((change) => String(change.from) !== String(change.to))
        .map((change) => String(change.from) + ' → ' + String(change.to));
      const bodies = changes
        .filter((change) => String(change.bodyFrom) !== String(change.bodyTo))
        .map((change) => String(change.bodyFrom) + ' → ' + String(change.bodyTo));
      const details = [];
      if (entries.length) details.push({ label: 'Entry settings (' + entries.length + ')', text: entries.join('\n') });
      if (bodies.length) details.push({ label: 'Entry bodies (' + bodies.length + ')', text: bodies.join('\n') });
      const notes = classificationNotes(payload.classification);
      addResult({
        title: 'Organize worldbook · ' + name,
        status: organized ? 'success' : 'info',
        summary: organized
          ? [
              'Organized ' + changes.length + ' worldbook entries: settings and bodies are filed by category and entry name; references are updated and content is preserved.',
              backup ? 'Original project backup: ' + backup : 'Original project backup is in work/layout-backups/.',
              'Continue editing in the new directories. Card content, entry order, and injection positions are unchanged.',
              ...notes.lines,
            ]
          : [
              'No organization needed',
              worldbookCount
                ? 'This worldbook is already organized by category and entry name; no files need moving.'
                : 'This card has no worldbook entries; organizing changes no files.',
              ...notes.lines,
            ],
        details: details.concat(notes.details),
      });
      await loadCards({ silentBusy: true });
    });
  });
}

// Classification feedback: only explicit name tags and known overview names are inferred; AI must read bodies in batches and write categories to entry YAML.
function classificationNotes(classification) {
  const info = classification && typeof classification === 'object' ? classification : null;
  if (!info) return { lines: [], details: [] };
  const files = (value) => (Array.isArray(value) ? value : []).map((item) => String(item)).filter((item) => item);
  const pending = files(info.pending);
  const pendingMoves = files(info.pendingMoves);
  const details = [];
  if (pending.length) details.push({ label: 'Uncategorized entries (' + pending.length + ')', text: pending.join('\n') });
  if (pendingMoves.length) details.push({ label: 'Category/directory mismatches (' + pendingMoves.length + ')', text: pendingMoves.join('\n') });
  if (!info.supported) {
    return { lines: ['Worldbook categories: migrate this project to v2 before reading entry bodies and adding category values.'], details };
  }
  if (Number(info.total) === 0) return { lines: [], details: [] };
  const lines = [];
  if (pending.length) {
    lines.push('Uncategorized: ' + pending.length + ' entries. The tool infers categories only from explicit name tags and known overview names, never from body content.');
    lines.push('Have AI read these bodies in batches, add category to each entry YAML by purpose, then run “Organize worldbook”. Size batches by body length instead of reading the entire book at once.');
  } else {
    lines.push('Worldbook categories are complete: all entries have usable category directories.');
  }
  if (pendingMoves.length) lines.push('Another ' + pendingMoves.length + ' entries have category/directory mismatches and will move when you run “Organize worldbook”.');
  return { lines, details };
}

async function arrangeCard(name) {
  const card = state.cards.find((item) => item.name === name);
  const worldbookCount = card && card.counts ? Number(card.counts.worldbook) || 0 : 0;
  await withFailureReport('Number in prompt order · ' + name, async () => {
    await run('Numbering worldbook in prompt order for “' + name + '”…', async () => {
      const payload = await apiFetch('/api/arrange', { method: 'POST', body: { name } });
      const changes = Array.isArray(payload.changes) ? payload.changes : [];
      const arranged = payload.arranged === true;
      const backup = typeof payload.backup === 'string' && payload.backup ? payload.backup : '';
      const budgetNotice = typeof payload.budgetNotice === 'string' ? payload.budgetNotice.trim() : '';
      const mode = payload.order === 'index' ? 'index' : 'prompt';
      const rows = changes.map((change) => {
        const row = change && typeof change === 'object' ? change : {};
        const label = textOrDash(row.name);
        const from = row.from ? String(row.from) : '';
        const to = row.to ? String(row.to) : '';
        return from || to ? label + ': order ' + (from || '—') + ' → ' + (to || '—') : label;
      });
      const details = rows.length ? [{ label: 'Entries with changed order (' + rows.length + ')', text: rows.join('\n') }] : [];
      const summary = arranged
        ? [
            mode === 'index'
              ? 'Numbered in index order: entry order is now consecutive from 1..N.'
              : 'Numbered in prompt order: regular entries run before character → after character → at depth (deepest first), consecutively from 1..N.',
            rows.length ? 'Entries with changed order: ' + rows.length + '; expand to view.' : 'Relative entry order is unchanged; only numbering and display indexes were synchronized.',
            backup ? 'Original project backup: ' + backup : 'Original project backup is in work/order-backups/.',
            'Entry positions, depths, roles, keywords, and bodies are unchanged. Order affects prompt budget priority across positions; verify in the host prompt preview.',
          ]
        : [
            'No changes needed',
            worldbookCount
              ? 'Worldbook entries already follow this ordering; no order changes are needed.'
              : 'This card has no worldbook entries; numbering changes no files.',
          ];
      if (budgetNotice) summary.push(budgetNotice);
      addResult({ title: 'Number in prompt order · ' + name, status: arranged ? 'success' : 'info', summary, details });
      await loadCards({ silentBusy: true });
    });
  });
}

/* ===================== Confirmation dialog ===================== */

function askConfirm(options) {
  const config = options || {};
  return new Promise((resolve) => {
    refs.confirmTitle.textContent = config.title || 'Please confirm';
    refs.confirmMessage.textContent = config.message || '';
    refs.confirmExtra.textContent = config.extra || '';
    refs.confirmExtra.hidden = !config.extra;
    refs.confirmOk.textContent = config.confirmLabel || 'Confirm';
    refs.confirmOk.className = config.danger ? 'btn btn-danger' : 'btn btn-primary';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      refs.confirmDialog.removeEventListener('close', onClose);
      resolve(value);
    };
    const onClose = () => finish(refs.confirmDialog.returnValue === 'confirm');
    refs.confirmDialog.addEventListener('close', onClose);
    refs.confirmDialog.returnValue = 'cancel';
    showDialog(refs.confirmDialog);
  });
}

/* ===================== Drag and drop ===================== */

function wireDragAndDrop() {
  let depth = 0;
  const showOverlay = () => {
    if (busy.depth > 0 || state.shutdown) return;
    refs.dropOverlay.hidden = false;
    document.body.classList.add('is-dragging');
  };
  const hideOverlay = () => {
    depth = 0;
    refs.dropOverlay.hidden = true;
    document.body.classList.remove('is-dragging');
  };
  window.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    depth += 1;
    showOverlay();
  });
  window.addEventListener('dragover', (event) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (!event.dataTransfer) return;
    depth -= 1;
    if (depth <= 0) hideOverlay();
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    hideOverlay();
    if (busy.depth > 0 || state.shutdown) return;
    const files = event.dataTransfer ? Array.from(event.dataTransfer.files || []) : [];
    if (!files.length) return;
    const usable = files.filter(acceptsImport);
    if (!usable.length) {
      reportFailure(
        'Import card',
        new StudioError('No PNG or JSON found in dropped files: ' + files.map((file) => file.name).join(', '))
      );
      return;
    }
    if (usable.length > 1) {
      showToast('Only one file can be imported at a time. Selected “' + usable[0].name + '”', 'info');
    }
    openImportDialog(usable[0]);
  });
}

/* ===================== Stop tool ===================== */

async function shutdownTool() {
  const confirmed = await askConfirm({
    title: 'Stop tool',
    message: 'Stop the local service?',
    extra: 'This page will disconnect. Run the launcher from the repository root to continue later. Files in cards/ are unaffected.',
    confirmLabel: 'Stop service',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await run('Stopping local service…', async () => {
      await apiFetch('/api/shutdown', { method: 'POST', body: {} });
    });
  } catch (err) {
    /* The service may exit before responding; treat that as a successful shutdown. */
    if (!/Cannot connect to the local service/.test(errorMessage(err))) {
      reportFailure('Stop tool', err);
      return;
    }
  }
  state.shutdown = true;
  refs.app.hidden = true;
  refs.shutdownNotice.hidden = false;
}

/* ===================== Events and startup ===================== */

function wireStaticHandlers() {
  document.getElementById('importsDirBtn').addEventListener('click', () => openTarget('', 'imports', 'Original cards folder'));
  refs.onboardingDismissBtn.addEventListener('click', () => dismissOnboarding());
  refs.onboardingNewBtn.addEventListener('click', () => {
    dismissOnboarding();
    openNewDialog();
  });
  refs.onboardingImportBtn.addEventListener('click', () => {
    dismissOnboarding();
    if (busy.depth > 0) return;
    refs.importFileInput.value = '';
    refs.importFileInput.click();
  });
  refs.onboardingExampleBtn.addEventListener('click', () => {
    dismissOnboarding();
    if (busy.depth > 0) return;
    openExampleDialog();
  });
  refs.refreshBtn.addEventListener('click', () => {
    loadCards().catch(() => {});
  });
  refs.importBtn.addEventListener('click', () => {
    if (busy.depth > 0) return;
    refs.importFileInput.value = '';
    refs.importFileInput.click();
  });
  refs.importFileInput.addEventListener('change', () => {
    const file = refs.importFileInput.files && refs.importFileInput.files[0];
    if (file) openImportDialog(file);
  });
  refs.newBtn.addEventListener('click', () => {
    if (busy.depth > 0) return;
    openNewDialog();
  });
  refs.shutdownBtn.addEventListener('click', () => {
    if (busy.depth > 0) return;
    shutdownTool();
  });
  refs.loadRetryBtn.addEventListener('click', () => {
    loadCards().catch(() => {});
  });
  refs.searchInput.addEventListener('input', () => {
    state.filter = refs.searchInput.value;
    renderList();
  });
  refs.resultsToggle.addEventListener('click', () => setResultsCollapsed(!state.resultsCollapsed));
  refs.resultsClear.addEventListener('click', () => {
    state.results = [];
    renderResults();
  });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    if (event.key === '/' && !typing) {
      event.preventDefault();
      refs.searchInput.focus();
    }
  });

  refs.importForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitImport();
  });
  refs.newForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitNew();
  });
  refs.renameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitRename();
  });
  refs.duplicateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitDuplicate();
  });
  refs.exampleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitExampleCopy();
  });
  refs.coverForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitCover();
  });
  refs.newForm.addEventListener('change', (event) => enforceModuleExclusion(event.target));
  refs.coverFile.addEventListener('change', () => {
    const file = refs.coverFile.files && refs.coverFile.files[0];
    handleCoverFile(file);
  });
  refs.importName.addEventListener('input', () => showFieldError(refs.importError, ''));
  refs.newName.addEventListener('input', () => showFieldError(refs.newError, ''));
  refs.renameProject.addEventListener('input', () => showFieldError(refs.renameError, ''));
  refs.renameCharacter.addEventListener('input', () => showFieldError(refs.renameError, ''));
  refs.duplicateName.addEventListener('input', () => showFieldError(refs.duplicateError, ''));
  refs.exampleName.addEventListener('input', () => showFieldError(refs.exampleError, ''));
}

function showBootNotice(detail) {
  refs.app.hidden = true;
  refs.shutdownNotice.hidden = true;
  refs.bootNotice.hidden = false;
  if (detail) {
    refs.bootNoticeDetail.textContent = String(detail);
    refs.bootNoticeDetail.hidden = false;
  } else {
    refs.bootNoticeDetail.textContent = '';
    refs.bootNoticeDetail.hidden = true;
  }
}

async function start() {
  cacheDom();
  if (!document.body.dataset.chromeWired) {
    document.body.dataset.chromeWired = 'true';
    wireDialogChrome();
    refs.bootRetryBtn.addEventListener('click', () => {
      start().catch((err) => reportFailure('Start interface', err));
    });
  }
  if (!token) {
    showBootNotice();
    return;
  }
  const stored = readStoredToken();
  if (stored && stored !== token) token = stored;
  refs.bootNotice.hidden = true;
  refs.app.hidden = false;
  if (!refs.app.dataset.wired) {
    refs.app.dataset.wired = 'true';
    wireStaticHandlers();
    wireDragAndDrop();
  }
  renderResults();
  renderList();
  renderDetail();
  updateOnboarding();
  await loadCards({ quiet: true });
}

document.addEventListener('DOMContentLoaded', () => {
  start().catch((err) => {
    reportFailure('Start interface', err);
  });
});
