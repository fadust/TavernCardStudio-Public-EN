<script setup>
import { ref } from 'vue';
const expanded = ref(false);
</script>
<template>
  <main class="panel"><header><span class="label">Scene record</span><span class="badge">Vue · No MVU required</span></header><h1>The story starts here</h1><p>This is a standalone Vue interface template. Choose what to display, then decide whether to connect variables.</p><button type="button" @click="expanded = !expanded">{{ expanded ? 'Hide details' : 'Show details' }}</button><section v-if="expanded" class="details">Add inventory, relationships, quests, or other information here.</section></main>
</template>
