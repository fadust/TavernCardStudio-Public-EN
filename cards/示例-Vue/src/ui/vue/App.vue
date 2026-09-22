<script setup>
import { ref } from 'vue';
const expanded = ref(false);
</script>
<template>
  <main class="panel"><header><span class="label">场景记录</span><span class="badge">Vue · 无需 MVU</span></header><h1>故事从这里开始</h1><p>这是独立的 Vue 界面模板。先决定要展示的信息，再选择是否连接变量。</p><button type="button" @click="expanded = !expanded">{{ expanded ? '收起详情' : '查看详情' }}</button><section v-if="expanded" class="details">这里可以放入物品、关系、任务或其他内容。</section></main>
</template>
