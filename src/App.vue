<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <header class="header">
    <nav class="nav">
      <RouterLink to="/">Задачи</RouterLink>
      <RouterLink to="/about">Статистика</RouterLink>
    </nav>
  </header>

  <RouterView />
</template>

<style scoped>
.header {
  padding: 0 50px;
  display: flex;
  background: rgba(27, 30, 36, 0.5);

  .nav {
    display: flex;
    height: 100%;
  }

  .nav a {
    display: flex;
    align-items: center;
    height: 100%;
    padding: 0px 30px;
    color: inherit;
    text-decoration: none;

    &.router-link-exact-active {
      background: rgba(27, 30, 36, 0.5);

    }

    &:hover {
      background: rgba(27, 30, 36, 0.7);
    }
  }
}

</style>
