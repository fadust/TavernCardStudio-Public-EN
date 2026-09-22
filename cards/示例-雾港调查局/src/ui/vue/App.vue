<script setup>
// 雾港调查局状态栏：只读取当前楼层的 MVU 状态并展示，不写回任何变量。
import { computed, onMounted, onUnmounted, ref } from 'vue';

const statData = ref(null);
const status = ref('等待 MVU 初始化…');
const expandedClues = ref({});
let timer = null;
let stopped = false;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const entriesOf = value => (isObject(value) ? Object.entries(value) : []);
const textOf = (value, fallback = '未记录') => (typeof value === 'string' && value.trim() ? value : fallback);
const percentOf = value => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : null;
};

const bureau = computed(() => (isObject(statData.value?.调查局) ? statData.value.调查局 : {}));
const caseFile = computed(() => (isObject(bureau.value.委托) ? bureau.value.委托 : {}));
const harbour = computed(() => (isObject(statData.value?.雾港) ? statData.value.雾港 : {}));
const investigator = computed(() => (isObject(statData.value?.调查员) ? statData.value.调查员 : {}));
const fog = computed(() => percentOf(harbour.value.雾况));
const fogLabel = computed(() => {
  if (fog.value === null) return '未记录';
  if (fog.value >= 80) return '浓雾，夜间作业受限';
  if (fog.value >= 55) return '浓雾';
  if (fog.value >= 30) return '中雾';
  return '薄雾';
});
const clues = computed(() => entriesOf(bureau.value.线索).map(([name, item]) => ({
  name,
  state: textOf(item?.状态, '待核实'),
  detail: textOf(item?.说明, '暂无说明'),
})));
const people = computed(() => entriesOf(bureau.value.人物).map(([name, item]) => ({
  name,
  stance: textOf(item?.立场, '未知'),
  trust: percentOf(item?.信任),
  note: textOf(item?.备注, ''),
})));
const evidence = computed(() => entriesOf(bureau.value.物证).map(([name, item]) => ({
  name,
  detail: textOf(item?.说明, '暂无说明'),
  count: Number.isFinite(Number(item?.数量)) ? String(item?.数量) : '—',
})));
const energy = computed(() => percentOf(investigator.value.精力));
const renown = computed(() => percentOf(investigator.value.声望));
const fogText = computed(() => (fog.value === null ? '未记录' : `${fog.value} · ${fogLabel.value}`));

function toggle(name) {
  expandedClues.value[name] = !expandedClues.value[name];
}
function refresh() {
  try {
    const messageId = getCurrentMessageId();
    const value = Mvu.getMvuData({ type: 'message', message_id: messageId })?.stat_data;
    if (!isObject(value)) {
      statData.value = null;
      status.value = '当前楼层还没有变量状态';
      return;
    }
    statData.value = value;
    status.value = '当前楼层';
  } catch (error) {
    statData.value = null;
    status.value = '状态读取失败：' + error.message;
  }
}
onMounted(async () => {
  if (typeof waitGlobalInitialized !== 'function' || typeof getCurrentMessageId !== 'function') {
    status.value = '请在酒馆助手的楼层界面中查看';
    return;
  }
  let timeout;
  try {
    await Promise.race([
      waitGlobalInitialized('Mvu'),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('MVU 初始化超时：请确认卡内 MVU 脚本已启用，且公开依赖可以加载')), 15000);
      }),
    ]);
  } catch (error) {
    status.value = error.message;
    return;
  } finally {
    clearTimeout(timeout);
  }
  if (stopped) return;
  refresh();
  timer = setInterval(refresh, 1000);
});
onUnmounted(() => {
  stopped = true;
  clearInterval(timer);
});
</script>

<template>
  <main class="panel">
    <header class="head">
      <div class="head-case">
        <span class="tag">委托</span>
        <b class="code">{{ textOf(caseFile.编号, '未登记') }}</b>
        <span class="title">{{ textOf(caseFile.名称, '暂无在办委托') }}</span>
      </div>
      <span class="badge">{{ status }}</span>
    </header>

    <section class="meta">
      <div><span>阶段</span><b>{{ textOf(caseFile.阶段, '待命') }}</b></div>
      <div><span>时段</span><b>{{ textOf(harbour.时段) }}</b></div>
      <div><span>天气</span><b>{{ textOf(harbour.天气) }}</b></div>
    </section>

    <section class="gauge">
      <div class="gauge-head"><span>雾况</span><b>{{ fogText }}</b></div>
      <div class="track"><i :style="{ width: (fog ?? 0) + '%' }"></i></div>
    </section>

    <section class="block">
      <h2>线索 <small>{{ textOf(bureau._进展, '尚未建档') }}</small></h2>
      <p v-if="clues.length === 0" class="empty">还没有登记线索。</p>
      <ul v-else class="list">
        <li v-for="clue in clues" :key="clue.name">
          <button type="button" class="item" @click="toggle(clue.name)">
            <span class="item-head">
              <b>{{ clue.name }}</b>
              <span class="pill" :data-state="clue.state">{{ clue.state }}</span>
            </span>
            <span v-if="expandedClues[clue.name]" class="item-body">{{ clue.detail }}</span>
          </button>
        </li>
      </ul>
    </section>

    <section class="block">
      <h2>人物</h2>
      <p v-if="people.length === 0" class="empty">还没有建立人物档案。</p>
      <ul v-else class="list">
        <li v-for="person in people" :key="person.name" class="person">
          <div class="item-head">
            <b>{{ person.name }}</b>
            <span class="pill" data-state="stance">{{ person.stance }}</span>
          </div>
          <div class="track slim"><i :style="{ width: (person.trust ?? 0) + '%' }"></i></div>
          <div class="person-foot">
            <span>信任 {{ person.trust === null ? '未记录' : person.trust }}</span>
            <span v-if="person.note" class="note">{{ person.note }}</span>
          </div>
        </li>
      </ul>
    </section>

    <section class="block">
      <h2>物证</h2>
      <p v-if="evidence.length === 0" class="empty">还没有封存物证。</p>
      <ul v-else class="list">
        <li v-for="item in evidence" :key="item.name" class="evidence">
          <div class="item-head"><b>{{ item.name }}</b><span class="pill" data-state="count">×{{ item.count }}</span></div>
          <span class="item-body always">{{ item.detail }}</span>
        </li>
      </ul>
    </section>

    <section class="block">
      <h2>调查员</h2>
      <div class="grid">
        <div class="cell"><span>权限</span><b>{{ textOf(investigator.权限, '见习') }}</b></div>
        <div class="cell"><span>精力</span><b>{{ energy === null ? '未记录' : energy }}</b></div>
        <div class="cell"><span>声望</span><b>{{ renown === null ? '未记录' : renown }}</b></div>
      </div>
      <div class="track slim"><i :style="{ width: (energy ?? 0) + '%' }"></i></div>
    </section>

    <p class="foot">界面只读取当前楼层的 MVU 变量；缺失的字段按未记录显示，不会写回默认值。</p>
  </main>
</template>
