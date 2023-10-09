<script setup>
// defineProps({
//   iconLeft
// })
</script>

<template>
  <button class="v-button">
    <slot />
  </button>
</template>

<style scoped>
.v-button {
  display: flex;
  align-items: center;
  height: 40px;
  background: rgba(27, 30, 36, 0.7);
  color: #FFFFFF;
  border: none;
  cursor: pointer;
  border-radius: 5px;
  padding: 0px 10px;
  stroke: #FFFFFF;

  &:hover {
    background: rgb(27, 30, 36);
  }
}
</style>
