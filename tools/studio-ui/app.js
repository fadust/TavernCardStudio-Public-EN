'use strict';

/* ---------------------------------------------------------------------------
   TavernCardStudio 创作者桌面工具 · 前端（原生 DOM，无框架、无 CDN）

   约定：
   - 启动地址片段 #token=... 只用于换取令牌，读到后立刻写入 sessionStorage
     并用 history.replaceState 清掉片段。
   - 所有 /api 请求都带 X-Studio-Token。
   - 页面只做本地管理：不执行、不预览卡里的脚本、EJS 与界面代码。
   - 所有动态值一律用 textContent 写入，任何位置都不使用 innerHTML。
   --------------------------------------------------------------------------- */

const TOKEN_STORAGE_KEY = 'tavern-card-studio.token';
const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
const MAX_COVER_EDGE = 4096;
const MAX_COVER_PIXELS = 24_000_000;
const COUNT_FIELDS = [
  { key: 'worldbook', label: '世界书' },
  { key: 'regex', label: '正则' },
  { key: 'scripts', label: '脚本' },
  { key: 'greetings', label: '开场白' },
];
const STATUS_LABELS = { success: '成功', warn: '警告', error: '失败', info: '提示' };
const MAX_RESULT_ENTRIES = 40;
// 来源标识由服务端的公开示例清单决定，名称前缀仅用于默认副本名。
const EXAMPLE_PREFIX = '示例-';
const ONBOARDING_STORAGE_KEY = 'tavern-card-studio.onboarding-done';

const OPEN_TARGETS = [
  { target: 'card', label: '卡片文件夹' },
  { target: 'source', label: '内容文件夹' },
  { target: 'dist', label: '成品文件夹' },
  { target: 'root', label: '仓库根目录' },
];

/* ===================== 令牌 ===================== */

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
    /* 隐私模式下可能禁用 sessionStorage；令牌只保留在内存里。 */
  }
}

const hashToken = readTokenFromHash();
if (hashToken) {
  storeToken(hashToken);
  history.replaceState(null, '', location.pathname + location.search);
}
let token = hashToken || readStoredToken();

/* ===================== 工具函数 ===================== */

class StudioError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'StudioError';
    this.detail = detail === undefined || detail === null ? '' : String(detail);
  }
}

function errorMessage(err) {
  if (err && typeof err.message === 'string' && err.message) return err.message;
  return '操作失败，请重试。';
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
  return base.slice(0, 80) || '未命名卡片';
}

function validateProjectName(value) {
  const name = String(value || '').trim();
  if (!name) return '请填写工程名。';
  if (/[\\/:*?"<>|]/.test(name)) return '工程名不能包含 \\ / : * ? " < > | 这些字符。';
  if (/^[.\s]/.test(name) || /[.\s]$/.test(name)) return '工程名不能以点号或空格开头、结尾。';
  if (name.length > 80) return '工程名请控制在 80 个字符以内。';
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
  const message = raw || '请求失败（HTTP ' + response.status + '）';
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
    throw new StudioError('无法连接到本地服务，请确认启动器仍在运行，并从这个页面继续操作。', errorDetail(err));
  }
  if (!response.ok) {
    const failure = await parseFailure(response);
    if (response.status === 401 || response.status === 403) {
      if (!failure.fromServer) failure.message = '访问令牌无效或已失效，请从仓库根目录的启动器重新打开本工具。';
      failure.detail = 'HTTP ' + response.status;
      failure.auth = true;
    }
    throw failure;
  }
  let payload;
  try {
    payload = await response.json();
  } catch (err) {
    throw new StudioError('服务返回的内容无法解析，请查看启动器窗口的日志。', errorDetail(err));
  }
  if (!payload || payload.ok !== true) {
    const message = payload && typeof payload.error === 'string' && payload.error ? payload.error : '操作未完成。';
    throw new StudioError(message, '响应里 ok 不是 true');
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
    throw new StudioError('无法读取封面，服务连接已中断。', errorDetail(err));
  }
  if (!response.ok) throw await parseFailure(response);
  return response.blob();
}

/* ===================== DOM 辅助 ===================== */

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
        // 支持 onClick 这类写法；绝不写成内联属性，内联处理器会被站点 CSP 拦掉而且不会报错。
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

// 忙碌期间新建的控件要跟着禁用，忙完后按标记恢复；已有的控件由 beginBusy 的快照恢复。
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

/* ===================== 状态 ===================== */

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

/* ===================== 忙碌状态 ===================== */

function updateBusyLabel() {
  if (!refs) return;
  refs.busyText.textContent = busy.label || '正在处理…';
}

function updateBusyElapsed() {
  if (!refs || busy.depth === 0) return;
  const seconds = (Date.now() - busy.startedAt) / 1000;
  refs.busyElapsed.textContent = seconds.toFixed(1) + ' 秒';
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

/* ===================== 提示与结果区 ===================== */

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
    title: entry.title || '操作',
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
    details: errorDetail(err) ? [{ label: '技术细节', text: errorDetail(err) }] : [],
  });
}

function setResultsCollapsed(collapsed) {
  state.resultsCollapsed = collapsed;
  refs.resultsBody.hidden = collapsed;
  refs.resultsToggle.textContent = collapsed ? '展开' : '折叠';
}

function renderResults() {
  refs.resultsBody.textContent = '';
  refs.resultsCount.textContent = state.results.length ? '（' + state.results.length + '）' : '';
  if (!state.results.length) {
    refs.resultsBody.appendChild(
      el('p', { class: 'results-empty', text: '暂无操作记录。导入、检查或打包后，结果会固定显示在这里。' })
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
    el('span', { class: 'result-status', text: STATUS_LABELS[entry.status] || '提示' }),
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
        el('summary', { text: detail.label || '详细错误' }),
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

/* ===================== 卡片列表 ===================== */

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
  const split = '我的卡 ' + mine + ' 张 · 官方示例 ' + examples + ' 张';
  if (filtering) return '匹配 ' + items.length + ' / 共 ' + state.cards.length + ' 张 · ' + split;
  return split + ' · 共 ' + state.cards.length + ' 张';
}

function renderList() {
  refs.cardList.textContent = '';
  const items = filteredCards();
  const filtering = state.filter.trim().length > 0;
  refs.listMeta.textContent = state.cards.length ? listSummary(items, filtering) : '';
  refs.listEmpty.hidden = items.length > 0;
  if (state.cards.length && !items.length) {
    refs.listEmpty.hidden = false;
    refs.listEmpty.querySelector('.empty-title').textContent = '没有匹配的卡';
    refs.listEmpty.querySelector('.empty-hint').textContent = '换个关键词试试，搜索会同时匹配工程名、角色名、作者与标签。';
  } else if (items.length) {
    refs.listEmpty.hidden = true;
  } else {
    refs.listEmpty.querySelector('.empty-title').textContent = '还没有卡片';
    refs.listEmpty.querySelector('.empty-hint').textContent = '用「导入 PNG / JSON」拆分已有卡，或用「新建卡」从模板开始。';
  }

  for (const card of items) {
    refs.cardList.appendChild(renderCardItem(card));
  }
}

function renderCardItem(card) {
  const top = el('span', { class: 'card-item-top' }, [
    el('span', { class: 'card-item-name', text: card.name }),
  ]);
  if (isExampleCard(card)) top.appendChild(el('span', { class: 'chip chip-example', text: '官方示例' }));
  if (card.error) top.appendChild(el('span', { class: 'chip chip-warn', text: '读取异常' }));
  else if (card.hasCover) top.appendChild(el('span', { class: 'chip chip-soft', text: '封面' }));

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

/* ===================== 详情 ===================== */

function releaseCoverUrl(cover) {
  if (cover && cover.url) {
    try {
      URL.revokeObjectURL(cover.url);
    } catch (err) {
      /* 忽略释放失败 */
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

// 每次列表刷新后都重新取一次封面：换封面、去封面、重命名都会走到这里，不能只看缓存状态。
function refreshSelectedCover() {
  const card = selectedCard();
  if (!card) {
    revokeCoverUrl();
    state.cover = null;
    renderDetail();
    return;
  }
  // 保留旧图，等新封面取回来再替换，避免详情闪一下占位。
  loadCover(card, { keepExisting: true });
}

let coverRequest = 0;

async function loadCover(card, options) {
  const settings = options || {};
  const requestId = coverRequest + 1;
  coverRequest = requestId;
  const hasCover = Boolean(card.hasCover);
  const cachedUrl = state.cover && state.cover.name === card.name ? state.cover.url : '';
  // 只有“同一张卡且允许保留”才继续用旧图，其余情况立刻释放，避免拿到上一张封面。
  const keepUrl = hasCover && settings.keepExisting ? cachedUrl : '';
  if (state.cover && state.cover.url && state.cover.url !== keepUrl) releaseCoverUrl(state.cover);
  state.cover = { name: card.name, status: hasCover ? 'loading' : 'none', url: keepUrl, message: '' };
  renderDetail();
  if (!hasCover) return;
  try {
    const blob = await fetchCoverBlob(card.name);
    // 只接受最后一次请求的结果；旧请求晚到不能覆盖新封面。
    if (requestId !== coverRequest || state.selected !== card.name) return;
    const url = URL.createObjectURL(blob);
    if (state.cover.url && state.cover.url !== url) releaseCoverUrl(state.cover);
    state.cover = { name: card.name, status: 'ready', url, message: '' };
  } catch (err) {
    if (requestId !== coverRequest || state.selected !== card.name) return;
    // 取失败时保留已经显示出来的旧图，只把错误写在封面下方。
    const keptUrl = state.cover.url;
    state.cover = { name: card.name, status: keptUrl ? 'ready' : 'error', url: keptUrl, message: errorMessage(err) };
  }
  renderDetail();
}

function renderCoverBox(card) {
  const box = el('div', { class: 'cover' });
  const cover = state.cover && state.cover.name === card.name ? state.cover : null;
  if (cover && cover.url && (cover.status === 'ready' || cover.status === 'loading')) {
    box.appendChild(el('img', { class: 'cover-img', src: cover.url, alt: '《' + card.name + '》封面' }));
    if (cover.message) box.appendChild(el('p', { class: 'cover-error', text: cover.message }));
    return box;
  }
  let text = '未设置封面';
  if (cover && cover.status === 'loading') text = '封面加载中…';
  else if (cover && cover.status === 'error') text = '封面读取失败';
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
    tagBox.appendChild(el('span', { class: 'tag tag-empty', text: '无标签' }));
  }

  return el('div', { class: 'detail-info' }, [
    el('div', { class: 'detail-heading' }, [
      el('h2', { class: 'detail-name', text: card.name }),
      isExampleCard(card) ? el('span', { class: 'chip chip-example', text: '官方示例' }) : null,
      card.hasCover ? el('span', { class: 'chip chip-soft', text: '有封面' }) : el('span', { class: 'chip', text: '无封面' }),
    ]),
    el('p', { class: 'detail-character' }, [
      el('span', { class: 'detail-character-label', text: '角色名：' }),
      el('span', { class: 'detail-character-value', text: textOrDash(card.characterName) }),
    ]),
    el('div', { class: 'meta-grid' }, [
      fieldBlock('来源', isExampleCard(card) ? '官方示例（复制后再改）' : '我的卡'),
      fieldBlock('作者', textOrDash(card.creator)),
      fieldBlock('版本', textOrDash(card.version)),
      fieldBlock('拆分编辑区（AI 与手动共用）', 'cards/' + card.name + '/src'),
    ]),
    el('div', { class: 'meta-grid' }, [
      fieldBlock('完整导入原卡', card.importPath || '新建卡或早期工程；校验副本在 original/'),
      fieldBlock('打包成品', 'dist/' + card.name),
    ]),
    renderStatRow(card),
    el('div', { class: 'meta-item meta-item-wide' }, [
      el('span', { class: 'meta-label', text: '标签' }),
      tagBox,
    ]),
  ]);
}

function renderActions(card) {
  const groups = [
    {
      title: '打包与检查',
      actions: [
        { label: '检查', run: () => checkCard(card.name) },
        { label: '打包', run: () => buildCard(card.name), primary: true },
      ],
    },
    {
      title: '工程',
      actions: [
        ...(isExampleCard(card) ? [{ label: '复制成我的卡', run: () => openExampleDialog(card.name) }] : []),
        { label: '重命名', run: () => openRenameDialog(card) },
        { label: '复制卡', run: () => openDuplicateDialog(card) },
      ],
    },
    {
      title: '封面',
      actions: [
        { label: '换封面', run: () => openCoverDialog(card) },
        { label: card.hasCover ? '去封面' : '去封面（无封面）', run: () => removeCover(card), disabled: !card.hasCover },
      ],
    },
    {
      title: '打开目录',
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
        el('h2', { class: 'empty-title', text: '选择一张卡开始' }),
        el('p', { class: 'empty-hint', text: '左侧是 cards/ 下的工程列表。选中后可检查、打包、重命名、换封面，或打开对应的文件夹。' }),
        el('p', { class: 'empty-hint muted', text: '本工具只读写文件，不执行也不预览卡里的脚本与界面代码。' }),
      ])
    );
    return;
  }
  const head = el('div', { class: 'detail-head' }, [renderCoverBox(card), renderInfo(card)]);
  refs.detailPanel.appendChild(head);
  if (isExampleCard(card)) {
    refs.detailPanel.appendChild(
      el('div', { class: 'alert alert-note' }, [
        el('p', { class: 'alert-text', text: '这是官方示例：要改内容时，先用「复制成我的卡」生成自己的工程，示例原卡保持不动。' }),
        el('p', { class: 'alert-hint', text: '复制后编辑 cards/新工程名/src，打包产出在 dist/新工程名/。' }),
      ])
    );
  }
  if (card.error) {
    refs.detailPanel.appendChild(
      el('div', { class: 'alert alert-warn' }, [
        el('p', { class: 'alert-text', text: '这张卡读取时有问题：' + String(card.error) }),
        el('p', { class: 'alert-hint', text: '可以先修复目录内容，再点「刷新」重新读取。' }),
      ])
    );
  }
  refs.detailPanel.appendChild(renderActions(card));
}

/* ===================== 列表加载 ===================== */

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
  if (!settings.silentBusy) beginBusy('正在读取卡片列表…');
  try {
    const payload = await apiFetch('/api/cards');
    state.root = typeof payload.root === 'string' ? payload.root : '';
    state.cards = Array.isArray(payload.cards) ? payload.cards : [];
    if (state.selected && !state.cards.some((card) => card.name === state.selected)) {
      state.selected = '';
      revokeCoverUrl();
      state.cover = null;
    }
    refs.rootPath.textContent = state.root || '（未提供根目录）';
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
    if (!settings.quiet) reportFailure('读取卡片列表', err);
  } finally {
    if (!settings.silentBusy) endBusy();
  }
}

/* ===================== 对话框通用行为 ===================== */

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

/* ===================== 导入 ===================== */

function acceptsImport(file) {
  const ext = extensionOf(file.name);
  return ext === '.png' || ext === '.json';
}

function openImportDialog(file) {
  if (!file) return;
  if (!acceptsImport(file)) {
    reportFailure('导入卡片', new StudioError('只支持 PNG 或 JSON 文件，当前选择的是「' + file.name + '」。'));
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    reportFailure(
      '导入卡片',
      new StudioError(
        '文件超过 64 MiB 限制：「' + file.name + '」为 ' + formatBytes(file.size) + '，请先自行压缩或裁剪。'
      )
    );
    return;
  }
  state.pendingImport = { file };
  refs.importFileName.textContent = file.name;
  refs.importFileSize.textContent = formatBytes(file.size);
  refs.importName.value = deriveProjectName(file.name);
  refs.importNote.textContent = '完整原卡先归档到 imports/，拆分文件放到 cards/工程名/src/。之后交给 AI 或自己编辑；修改后直接打包到 dist/工程名/，不用重新导入。同名原卡内容不同会自动加序号，已有编辑工程不会覆盖。';
  showFieldError(refs.importError, '');
  showDialog(refs.importDialog);
  setTimeout(() => refs.importName.focus(), 30);
}

function readFileAsBase64(file, setLabel) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(stripDataUrl(reader.result));
    reader.onerror = () =>
      reject(new StudioError('读取文件失败，请重试或换一个文件。', reader.error ? String(reader.error.message || reader.error) : 'FileReader 报错'));
    reader.onabort = () => reject(new StudioError('读取文件已取消。'));
    reader.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      setLabel('正在读取 ' + file.name + '（' + percent + '%）…');
    };
    setLabel('正在读取 ' + file.name + '…');
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
    await run('正在导入卡片…', async ({ setLabel }) => {
      const base64 = await readFileAsBase64(pending.file, setLabel);
      setLabel('正在导入并拆分「' + name + '」…');
      const payload = await apiFetch('/api/import', {
        method: 'POST',
        body: { filename: pending.file.name, base64, name },
      });
      if (typeof payload.name === 'string' && payload.name) importedName = payload.name;
      addResult({
        title: '导入卡片 · ' + importedName,
        status: 'success',
        summary: [
          '源文件：' + pending.file.name + '（' + formatBytes(pending.file.size) + '）',
          payload.message ? String(payload.message) : '已拆分到 cards/' + importedName,
        ],
      });
      // 列表刷新和切换选中留在同一个忙碌窗口里：用户在刷新途中点不到别的卡，也就不会被覆盖。
      state.selected = '';
      revokeCoverUrl();
      state.cover = null;
      await loadCards({ silentBusy: true });
      if (state.cards.some((card) => card.name === importedName)) selectCard(importedName);
    });
  } catch (err) {
    showFieldError(refs.importError, errorMessage(err));
    reportFailure('导入卡片 · ' + pending.file.name, err);
    return;
  }
  state.pendingImport = null;
  closeDialog(refs.importDialog);
  dismissOnboarding();
  showToast('已导入「' + importedName + '」', 'success');
}

/* ===================== 新建 ===================== */

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
    await run('正在创建「' + name + '」…', async () => {
      const payload = await apiFetch('/api/new', { method: 'POST', body: { name, modules } });
      if (typeof payload.name === 'string' && payload.name) createdName = payload.name;
      addResult({
        title: '新建卡 · ' + createdName,
        status: 'success',
        summary: [
          modules.length ? '模块：' + modules.join('、') : '模块：无（纯文字卡）',
          payload.message ? String(payload.message) : '已生成 cards/' + createdName,
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
    reportFailure('新建卡 · ' + name, err);
    return;
  }
  closeDialog(refs.newDialog);
  dismissOnboarding();
  showToast('已创建「' + createdName + '」', 'success');
}

/* ===================== 官方示例 / 入门引导 ===================== */

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
    /* 隐私模式下禁用 localStorage 时，只在这次页面里隐藏。 */
  }
  refs.onboarding.hidden = true;
}

function defaultCopyName(sourceName) {
  const source = String(sourceName || '');
  const base = (source.startsWith(EXAMPLE_PREFIX) ? source.slice(EXAMPLE_PREFIX.length) : source) || '我的卡';
  const taken = new Set(state.cards.map((card) => String(card.name).toLowerCase()));
  let candidate = base;
  if (taken.has(candidate.toLowerCase())) candidate = base + '-副本';
  let index = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = base + '-副本' + index;
    index += 1;
  }
  return candidate.slice(0, 80);
}

function selectExampleSource(name) {
  state.pendingExample = name;
  refs.exampleName.value = defaultCopyName(name);
  refs.exampleNote.textContent = '复制后得到的是普通工程：AI 和你改的都是 cards/新工程名/src，打包产出在 dist/新工程名/。';
}

function openExampleDialog(sourceName) {
  state.pendingExample = null;
  showFieldError(refs.exampleError, '');
  refs.exampleList.textContent = '';
  const examples = officialExamples();
  if (!examples.length) {
    refs.exampleList.appendChild(
      el('p', { class: 'note', text: '当前工作区没有可用的官方示例；可以先用「新建卡」开始，或从完整发布包恢复示例目录。' })
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
      card.characterName ? '角色：' + card.characterName : '',
      counts.worldbook ? '世界书 ' + counts.worldbook : '',
      counts.regex ? '正则 ' + counts.regex : '',
      counts.scripts ? '脚本 ' + counts.scripts : '',
    ].filter(Boolean).join(' · ');
    entries.push({ name: card.name, input });
    refs.exampleList.appendChild(
      el('label', { class: 'example-option' }, [
        input,
        el('span', { class: 'example-option-body' }, [
          el('span', { class: 'example-option-name', text: card.name }),
          el('span', { class: 'example-option-sub', text: summary || '官方示例卡' }),
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
    showFieldError(refs.exampleError, '请先选择一个官方示例。');
    return;
  }
  const newName = refs.exampleName.value.trim();
  const nameIssue = validateProjectName(newName);
  if (nameIssue) {
    showFieldError(refs.exampleError, nameIssue);
    return;
  }
  if (newName.toLowerCase() === source.toLowerCase()) {
    showFieldError(refs.exampleError, '新工程名要和示例不同；复制出来的才是你自己的卡。');
    return;
  }
  showFieldError(refs.exampleError, '');
  let createdName = newName;
  try {
    await run('正在复制示例「' + source + '」…', async () => {
      const payload = await apiFetch('/api/duplicate', { method: 'POST', body: { name: source, newName } });
      if (typeof payload.name === 'string' && payload.name) createdName = payload.name;
      addResult({
        title: '复制官方示例 · ' + createdName,
        status: 'success',
        summary: [
          '来源：' + source + '（官方示例原卡保持不变）',
          '编辑区：cards/' + createdName + '/src（AI 与手动共用）',
          '打包成品：dist/' + createdName,
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
    reportFailure('复制官方示例 · ' + source, err);
    return;
  }
  state.pendingExample = null;
  closeDialog(refs.exampleDialog);
  dismissOnboarding();
  showToast('已复制示例到「' + createdName + '」', 'success');
}

/* ===================== 重命名 / 复制 ===================== */

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
    showFieldError(refs.renameError, '请先选择一张卡。');
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
    await run('正在重命名「' + card.name + '」…', async () => {
      const payload = await apiFetch('/api/rename', { method: 'POST', body });
      if (typeof payload.name === 'string' && payload.name) renamedTo = payload.name;
      const characterLine = characterName
        ? '角色名：' + textOrDash(card.characterName) + ' → ' + characterName
        : '角色名：未改动（' + textOrDash(card.characterName) + '）';
      addResult({
        title: '重命名 · ' + card.name,
        status: 'success',
        summary: ['工程名：' + card.name + ' → ' + renamedTo, characterLine],
      });
      state.selected = '';
      revokeCoverUrl();
      state.cover = null;
      await loadCards({ silentBusy: true });
      selectCard(renamedTo);
    });
  } catch (err) {
    showFieldError(refs.renameError, errorMessage(err));
    reportFailure('重命名 · ' + card.name, err);
    return;
  }
  closeDialog(refs.renameDialog);
  showToast('已重命名为「' + renamedTo + '」', 'success');
}

function openDuplicateDialog(card) {
  refs.duplicateSource.textContent = '源卡：' + card.name + '（角色名：' + textOrDash(card.characterName) + '）';
  refs.duplicateName.value = deriveProjectName(card.name + '-副本');
  showFieldError(refs.duplicateError, '');
  showDialog(refs.duplicateDialog);
  setTimeout(() => refs.duplicateName.focus(), 30);
}

async function submitDuplicate() {
  const card = selectedCard();
  if (!card) {
    showFieldError(refs.duplicateError, '请先选择一张卡。');
    return;
  }
  const newName = refs.duplicateName.value.trim();
  const nameIssue = validateProjectName(newName);
  if (nameIssue) {
    showFieldError(refs.duplicateError, nameIssue);
    return;
  }
  if (newName === card.name) {
    showFieldError(refs.duplicateError, '新工程名要和源卡不同。');
    return;
  }
  showFieldError(refs.duplicateError, '');
  let createdName = newName;
  try {
    await run('正在复制「' + card.name + '」…', async () => {
      const payload = await apiFetch('/api/duplicate', { method: 'POST', body: { name: card.name, newName } });
      if (typeof payload.name === 'string' && payload.name) createdName = payload.name;
      addResult({
        title: '复制卡 · ' + createdName,
        status: 'success',
        summary: [card.name + ' → ' + createdName, payload.message ? String(payload.message) : '已生成 cards/' + createdName],
      });
      state.selected = '';
      revokeCoverUrl();
      state.cover = null;
      await loadCards({ silentBusy: true });
      if (state.cards.some((item) => item.name === createdName)) selectCard(createdName);
    });
  } catch (err) {
    showFieldError(refs.duplicateError, errorMessage(err));
    reportFailure('复制卡 · ' + card.name, err);
    return;
  }
  closeDialog(refs.duplicateDialog);
  showToast('已复制为「' + createdName + '」', 'success');
}

/* ===================== 封面 ===================== */

function openCoverDialog(card) {
  state.pendingCover = null;
  refs.coverFile.value = '';
  refs.coverPreview.hidden = true;
  refs.coverPreviewImage.removeAttribute('src');
  refs.coverNote.textContent = card.hasCover
    ? '当前已有封面，写入后会替换为这张图片。'
    : '这张卡当前没有封面，写入后会成为卡面图片。';
  showFieldError(refs.coverError, '');
  refs.coverSubmit.disabled = true;
  showDialog(refs.coverDialog);
}

function resetPendingCover() {
  if (state.pendingCover && state.pendingCover.previewUrl) {
    try {
      URL.revokeObjectURL(state.pendingCover.previewUrl);
    } catch (err) {
      /* 忽略释放失败 */
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
    throw new StudioError('无法读取这张图片，请换一张 PNG、JPEG 或 WebP 图片。', errorDetail(err));
  }
  try {
    const sourceWidth = bitmap.width;
    const sourceHeight = bitmap.height;
    if (!sourceWidth || !sourceHeight) throw new StudioError('图片尺寸无效，无法转换。');
    if (sourceWidth * sourceHeight > MAX_COVER_PIXELS) {
      throw new StudioError(
        '原图 ' + sourceWidth + '×' + sourceHeight + ' 超过 2400 万像素，请先缩小到 2400 万像素以内再上传。'
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
    if (!context) throw new StudioError('当前浏览器无法处理图片，请改用较新的 Chrome 或 Edge 打开本工具。');
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    let dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch (err) {
      throw new StudioError('图片转成 PNG 失败，请换一张图片重试。', errorDetail(err));
    }
    const base64 = stripDataUrl(dataUrl);
    const bytes = Math.floor((base64.length * 3) / 4);
    if (!base64) throw new StudioError('图片转换结果为空，请换一张图片重试。');
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
    showFieldError(refs.coverError, '封面只支持 PNG、JPEG 或 WebP，当前选择的是「' + file.name + '」。');
    return;
  }
  showFieldError(refs.coverError, '');
  refs.coverNote.textContent = '正在转换「' + file.name + '」…';
  let result;
  try {
    result = await run('正在转换封面…', () => convertCoverToPng(file));
  } catch (err) {
    refs.coverNote.textContent = '这张图片还不能写入。';
    showFieldError(refs.coverError, errorMessage(err));
    reportFailure('转换封面 · ' + file.name, err);
    return;
  }
  const previewUrl = URL.createObjectURL(dataUrlToBlob(result.dataUrl));
  state.pendingCover = { file, result, previewUrl };
  refs.coverPreviewImage.src = previewUrl;
  refs.coverPreview.hidden = false;
  refs.coverSubmit.disabled = busy.depth > 0 ? true : false;
  refs.coverNote.textContent =
    '已转换为 PNG：' +
    result.sourceWidth +
    '×' +
    result.sourceHeight +
    ' → ' +
    result.width +
    '×' +
    result.height +
    '（' +
    (result.scaled ? '等比缩放、不裁切' : '原尺寸保留') +
    '，约 ' +
    formatBytes(result.bytes) +
    '）。';
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
    showFieldError(refs.coverError, '请先选择一张卡。');
    return;
  }
  const pending = state.pendingCover;
  if (!pending) {
    showFieldError(refs.coverError, '请先选择一张图片。');
    return;
  }
  showFieldError(refs.coverError, '');
  try {
    await run('正在写入封面…', async () => {
      const payload = await apiFetch('/api/cover', {
        method: 'POST',
        body: { name: card.name, base64: pending.result.base64 },
      });
      addResult({
        title: '更换封面 · ' + card.name,
        status: 'success',
        summary: [
          pending.file.name + ' → PNG ' + pending.result.width + '×' + pending.result.height + '（约 ' + formatBytes(pending.result.bytes) + '）',
          payload.message ? String(payload.message) : '封面已写入。',
        ],
      });
      // 同一个忙碌窗口里立刻重取列表与封面，保证详情显示的是刚写入的新图。
      await loadCards({ silentBusy: true });
    });
  } catch (err) {
    showFieldError(refs.coverError, errorMessage(err));
    reportFailure('更换封面 · ' + card.name, err);
    return;
  }
  resetPendingCover();
  closeDialog(refs.coverDialog);
  showToast('已更新「' + card.name + '」的封面', 'success');
}

async function removeCover(card) {
  const confirmed = await askConfirm({
    title: '去掉封面',
    message: '确定去掉「' + card.name + '」的封面吗？',
    extra: '工程目录与卡片内容不会改变，只是不再写入封面图片。',
    confirmLabel: '去掉封面',
    danger: true,
  });
  if (!confirmed) return;
  await withFailureReport('去封面 · ' + card.name, async () => {
    await run('正在去掉封面…', async () => {
      const payload = await apiFetch('/api/remove-cover', { method: 'POST', body: { name: card.name } });
      addResult({
        title: '去封面 · ' + card.name,
        status: 'success',
        summary: [payload.message ? String(payload.message) : '已去掉封面。'],
      });
      await loadCards({ silentBusy: true });
    });
  });
}

/* ===================== 检查 / 打包 / 打开目录 ===================== */

async function checkCard(name) {
  await withFailureReport('检查 · ' + name, async () => {
    await run('正在检查「' + name + '」…', async () => {
      const payload = await apiFetch('/api/check', { method: 'POST', body: { name } });
      const report = payload.report || {};
      const errors = Array.isArray(report.errors) ? report.errors : [];
      const warnings = Array.isArray(report.warnings) ? report.warnings : [];
      const passed = report.ok === true;
      const details = [];
      if (errors.length) details.push({ label: '错误（' + errors.length + '）', text: errors.join('\n') });
      if (warnings.length) details.push({ label: '警告（' + warnings.length + '）', text: warnings.join('\n') });
      addResult({
        title: '检查 · ' + name,
        status: passed ? (warnings.length ? 'warn' : 'success') : 'error',
        summary: [
          passed ? '检查通过' : '检查未通过',
          errors.length || warnings.length
            ? '错误 ' + errors.length + ' 条，警告 ' + warnings.length + ' 条。'
            : '没有错误，也没有警告。',
          '静态检查只做解析与编译级验证，不等于真实酒馆实测。',
        ],
        details,
      });
    });
  });
}

async function buildCard(name) {
  await withFailureReport('打包 · ' + name, async () => {
    await run('正在打包「' + name + '」…', async () => {
      const payload = await apiFetch('/api/build', { method: 'POST', body: { name } });
      const files = Array.isArray(payload.files) ? payload.files : [];
      const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
      const directory = payload.directory ? String(payload.directory) : 'dist/' + name;
      const summary = ['成品文件夹：' + directory];
      const pngs = files.filter((file) => /\.png$/i.test(String(file)));
      const jsons = files.filter((file) => /\.json$/i.test(String(file)));
      if (pngs.length) summary.push('生成 PNG：' + pngs.join('、'));
      if (jsons.length) summary.push('生成 JSON：' + jsons.join('、'));
      if (!files.length) summary.push('服务没有报告具体文件，请查看产物目录。');
      if (warnings.length) summary.push('警告 ' + warnings.length + ' 条，展开可见。');
      const details = [];
      if (files.length) details.push({ label: '文件清单（' + files.length + '）', text: files.join('\n') });
      if (warnings.length) details.push({ label: '警告（' + warnings.length + '）', text: warnings.join('\n') });
      addResult({
        title: '打包 · ' + name,
        status: warnings.length ? 'warn' : 'success',
        summary,
        details,
        actions: [
          { label: '打开成品文件夹', run: () => openTarget(name, 'dist', '成品文件夹') },
          { label: '打开卡片文件夹', run: () => openTarget(name, 'card', '卡片文件夹') },
          { label: '打开内容文件夹', run: () => openTarget(name, 'source', '内容文件夹') },
        ],
      });
    });
  });
}

async function openTarget(name, target, label) {
  await withFailureReport('打开 ' + label + ' · ' + name, async () => {
    await run('正在打开 ' + label + '…', async () => {
      await apiFetch('/api/open', { method: 'POST', body: { name, target } });
      addResult({
        title: '打开 ' + label + ' · ' + name,
        status: 'success',
        summary: ['已请求系统文件管理器打开。'],
      });
    });
  });
}

/* ===================== 确认对话框 ===================== */

function askConfirm(options) {
  const config = options || {};
  return new Promise((resolve) => {
    refs.confirmTitle.textContent = config.title || '请确认';
    refs.confirmMessage.textContent = config.message || '';
    refs.confirmExtra.textContent = config.extra || '';
    refs.confirmExtra.hidden = !config.extra;
    refs.confirmOk.textContent = config.confirmLabel || '确认';
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

/* ===================== 拖放 ===================== */

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
        '导入卡片',
        new StudioError('拖放的文件里没有 PNG 或 JSON：' + files.map((file) => file.name).join('、'))
      );
      return;
    }
    if (usable.length > 1) {
      showToast('一次只导入一个文件，已选择「' + usable[0].name + '」', 'info');
    }
    openImportDialog(usable[0]);
  });
}

/* ===================== 关闭工具 ===================== */

async function shutdownTool() {
  const confirmed = await askConfirm({
    title: '关闭工具',
    message: '确定关闭本地服务吗？',
    extra: '关闭后本页面会断开，需要继续使用时要重新从仓库根目录运行启动器。cards/ 下的文件不受影响。',
    confirmLabel: '关闭服务',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await run('正在关闭本地服务…', async () => {
      await apiFetch('/api/shutdown', { method: 'POST', body: {} });
    });
  } catch (err) {
    /* 服务可能在响应前就已经退出，这种情况同样视为关闭成功。 */
    if (!/无法连接到本地服务/.test(errorMessage(err))) {
      reportFailure('关闭工具', err);
      return;
    }
  }
  state.shutdown = true;
  refs.app.hidden = true;
  refs.shutdownNotice.hidden = false;
}

/* ===================== 绑定与启动 ===================== */

function wireStaticHandlers() {
  document.getElementById('importsDirBtn').addEventListener('click', () => openTarget('', 'imports', '原卡文件夹'));
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
      start().catch((err) => reportFailure('启动界面', err));
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
    reportFailure('启动界面', err);
  });
});
