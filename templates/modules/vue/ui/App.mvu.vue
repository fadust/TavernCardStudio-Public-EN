<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
const state = ref(null);
const status = ref('Waiting for MVU…');
const expanded = ref(false);
let timer;
let stopped = false;
function refresh() {
  try {
    const id = getCurrentMessageId();
    const value = Mvu.getMvuData({ type: 'message', message_id: id })?.stat_data;
    if (!value || typeof value !== 'object') { state.value = null; status.value = 'This message has no state data yet'; return; }
    state.value = value;
    status.value = 'Current message';
  } catch (error) { state.value = null; status.value = 'Could not read state: ' + error.message; }
}
onMounted(async () => {
  if (typeof waitGlobalInitialized !== 'function' || typeof getCurrentMessageId !== 'function') { status.value = 'View this inside a message with Tavern Helper enabled'; return; }
  try {
    let timeout;
    try {
      await Promise.race([waitGlobalInitialized('Mvu'), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('MVU initialization timed out. Check the scripts and network access to public dependencies')), 15000); })]);
    } finally { clearTimeout(timeout); }
    if (stopped) return;
    refresh(); timer = setInterval(refresh, 800);
  } catch (error) { status.value = error.message; }
});
onUnmounted(() => { stopped = true; clearInterval(timer); });
</script>
<template>
  <main class="panel"><header><span class="label">Character status</span><span class="badge">{{ status }}</span></header><h1>{{ state?.scene?.location ?? 'Unknown location' }}</h1><div class="grid"><section><small>Phase</small><strong>{{ state?.scene?.phase ?? 'Unknown' }}</strong></section><section><small>Mood</small><strong>{{ state?.character?.mood ?? 'Unknown' }}</strong></section><section><small>Trust</small><strong>{{ state?.character?.trust ?? 'Unknown' }}</strong></section></div><button type="button" @click="expanded = !expanded">{{ expanded ? 'Hide details' : 'Show details' }}</button><pre v-if="expanded" class="details">{{ state ? JSON.stringify(state, null, 2) : 'No data to display' }}</pre></main>
</template>
