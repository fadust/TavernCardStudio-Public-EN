<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
const state = ref(null);
const status = ref('等待 MVU 初始化…');
const expanded = ref(false);
let timer;
let stopped = false;
function refresh() {
  try {
    const id = getCurrentMessageId();
    const value = Mvu.getMvuData({ type: 'message', message_id: id })?.stat_data;
    if (!value || typeof value !== 'object') { state.value = null; status.value = '当前楼层尚无状态数据'; return; }
    state.value = value;
    status.value = '当前楼层';
  } catch (error) { state.value = null; status.value = '状态读取失败：' + error.message; }
}
onMounted(async () => {
  if (typeof waitGlobalInitialized !== 'function' || typeof getCurrentMessageId !== 'function') { status.value = '请在启用酒馆助手的消息楼层中查看'; return; }
  try {
    let timeout;
    try {
      await Promise.race([waitGlobalInitialized('Mvu'), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('MVU 初始化超时，请检查脚本和公开依赖网络')), 15000); })]);
    } finally { clearTimeout(timeout); }
    if (stopped) return;
    refresh(); timer = setInterval(refresh, 800);
  } catch (error) { status.value = error.message; }
});
onUnmounted(() => { stopped = true; clearInterval(timer); });
</script>
<template>
  <main class="panel"><header><span class="label">角色状态</span><span class="badge">{{ status }}</span></header><h1>{{ state?.场景?.地点 ?? '地点未知' }}</h1><div class="grid"><section><small>阶段</small><strong>{{ state?.场景?.阶段 ?? '未知' }}</strong></section><section><small>心情</small><strong>{{ state?.角色?.心情 ?? '未知' }}</strong></section><section><small>信任</small><strong>{{ state?.角色?.信任 ?? '未知' }}</strong></section></div><button type="button" @click="expanded = !expanded">{{ expanded ? '收起详情' : '查看详情' }}</button><pre v-if="expanded" class="details">{{ state ? JSON.stringify(state, null, 2) : '没有可显示的数据' }}</pre></main>
</template>
