<script setup>
// Fogharbor Bureau panel reads and displays the current message’s MVU state without writing variables.
import { computed, onMounted, onUnmounted, ref } from 'vue';

const statData = ref(null);
const status = ref('Waiting for MVU…');
const expandedClues = ref({});
let timer = null;
let stopped = false;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const entriesOf = value => (isObject(value) ? Object.entries(value) : []);
const textOf = (value, fallback = 'Not recorded') => (typeof value === 'string' && value.trim() ? value : fallback);
const percentOf = value => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : null;
};

const bureau = computed(() => (isObject(statData.value?.bureau) ? statData.value.bureau : {}));
const caseFile = computed(() => (isObject(bureau.value.caseFile) ? bureau.value.caseFile : {}));
const harbour = computed(() => (isObject(statData.value?.fogharbor) ? statData.value.fogharbor : {}));
const investigator = computed(() => (isObject(statData.value?.investigator) ? statData.value.investigator : {}));
const fog = computed(() => percentOf(harbour.value.fogDensity));
const fogLabel = computed(() => {
  if (fog.value === null) return 'Not recorded';
  if (fog.value >= 80) return 'Dense fog; night operations restricted';
  if (fog.value >= 55) return 'Dense fog';
  if (fog.value >= 30) return 'Moderate fog';
  return 'Light fog';
});
const clues = computed(() => entriesOf(bureau.value.clues).map(([name, item]) => ({
  name,
  state: textOf(item?.status, 'Pending'),
  detail: textOf(item?.description, 'No description'),
})));
const people = computed(() => entriesOf(bureau.value.people).map(([name, item]) => ({
  name,
  stance: textOf(item?.stance, 'Unknown'),
  trust: percentOf(item?.trust),
  note: textOf(item?.notes, ''),
})));
const evidence = computed(() => entriesOf(bureau.value.evidence).map(([name, item]) => ({
  name,
  detail: textOf(item?.description, 'No description'),
  count: Number.isFinite(Number(item?.quantity)) ? String(item?.quantity) : '—',
})));
const energy = computed(() => percentOf(investigator.value.energy));
const renown = computed(() => percentOf(investigator.value.renown));
const fogText = computed(() => (fog.value === null ? 'Not recorded' : `${fog.value} · ${fogLabel.value}`));

function toggle(name) {
  expandedClues.value[name] = !expandedClues.value[name];
}
function refresh() {
  try {
    const messageId = getCurrentMessageId();
    const value = Mvu.getMvuData({ type: 'message', message_id: messageId })?.stat_data;
    if (!isObject(value)) {
      statData.value = null;
      status.value = 'This message has no variable state yet';
      return;
    }
    statData.value = value;
    status.value = 'Current message';
  } catch (error) {
    statData.value = null;
    status.value = 'Could not read state: ' + error.message;
  }
}
onMounted(async () => {
  if (typeof waitGlobalInitialized !== 'function' || typeof getCurrentMessageId !== 'function') {
    status.value = 'View this in a Tavern Helper message interface';
    return;
  }
  let timeout;
  try {
    await Promise.race([
      waitGlobalInitialized('Mvu'),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('MVU initialization timed out: enable the card’s MVU scripts and check that public dependencies can load')), 15000);
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
        <span class="tag">Case</span>
        <b class="code">{{ textOf(caseFile.id, 'Not registered') }}</b>
        <span class="title">{{ textOf(caseFile.name, 'No active case') }}</span>
      </div>
      <span class="badge">{{ status }}</span>
    </header>

    <section class="meta">
      <div><span>Phase</span><b>{{ textOf(caseFile.phase, 'Standby') }}</b></div>
      <div><span>Time</span><b>{{ textOf(harbour.timeOfDay) }}</b></div>
      <div><span>Weather</span><b>{{ textOf(harbour.weather) }}</b></div>
    </section>

    <section class="gauge">
      <div class="gauge-head"><span>Fog density</span><b>{{ fogText }}</b></div>
      <div class="track"><i :style="{ width: (fog ?? 0) + '%' }"></i></div>
    </section>

    <section class="block">
      <h2>Clues <small>{{ textOf(bureau._progress, 'No records yet') }}</small></h2>
      <p v-if="clues.length === 0" class="empty">No clues have been registered.</p>
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
      <h2>People</h2>
      <p v-if="people.length === 0" class="empty">No people have been registered.</p>
      <ul v-else class="list">
        <li v-for="person in people" :key="person.name" class="person">
          <div class="item-head">
            <b>{{ person.name }}</b>
            <span class="pill" data-state="stance">{{ person.stance }}</span>
          </div>
          <div class="track slim"><i :style="{ width: (person.trust ?? 0) + '%' }"></i></div>
          <div class="person-foot">
            <span>Trust {{ person.trust === null ? 'Not recorded' : person.trust }}</span>
            <span v-if="person.note" class="note">{{ person.note }}</span>
          </div>
        </li>
      </ul>
    </section>

    <section class="block">
      <h2>Evidence</h2>
      <p v-if="evidence.length === 0" class="empty">No evidence has been secured.</p>
      <ul v-else class="list">
        <li v-for="item in evidence" :key="item.name" class="evidence">
          <div class="item-head"><b>{{ item.name }}</b><span class="pill" data-state="count">×{{ item.count }}</span></div>
          <span class="item-body always">{{ item.detail }}</span>
        </li>
      </ul>
    </section>

    <section class="block">
      <h2>Investigator</h2>
      <div class="grid">
        <div class="cell"><span>Clearance</span><b>{{ textOf(investigator.clearance, 'Trainee') }}</b></div>
        <div class="cell"><span>Energy</span><b>{{ energy === null ? 'Not recorded' : energy }}</b></div>
        <div class="cell"><span>Renown</span><b>{{ renown === null ? 'Not recorded' : renown }}</b></div>
      </div>
      <div class="track slim"><i :style="{ width: (energy ?? 0) + '%' }"></i></div>
    </section>

    <p class="foot">This panel reads only the current message's MVU variables. Missing fields display as not recorded; defaults are never written back.</p>
  </main>
</template>
