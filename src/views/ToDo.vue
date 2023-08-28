<script setup>
import { ref } from 'vue'
// import ToDoDays from '../components/ToDo/ToDoDays.vue'
// import axios from 'axios'
import VDay from '../components/ToDo/VDay.vue'
import VNextDay from '../components/ToDo/VNextDay.vue'
import VNewDay from '../components/ToDo/VNewDay.vue'
import VSidebarEditor from '../components/SidebarEditor/VSidebarEditor.vue'

const days = []
// const days = [
//   {
//     id: 1,
//     tasks: [
//       {
//         time: '06:00',
//         value: 'Дело 1',
//         priority: 1,
//       },
//       {
//         time: '07:00',
//         value: 'Дело 1',
//         priority: 2,
//       },
//     ],
//   },
//   {
//     id: 2,
//     tasks: [
//       {
//         time: '06:00',
//         value: 'Дело 3',
//         priority: 1,
//       },
//       {
//         time: '07:00',
//         value: 'Дело 4',
//         priority: 2,
//       },
//     ],
//   },
// ]
const editor = ref(false)
function toggleEditor() {
  editor.value = !editor.value
}
</script>
<template>
  <div class="page">
    <header class="header">
      <div class="container">
        <nav class="nav">
          <span>Задачи</span>
          <span>Статистика</span>
        </nav>
      </div>
    </header>
    <main class="days">
      <div class="button-editor" @click="toggleEditor"> {{ editor ? 'Сохранить' : 'Редактировать' }} </div>

      <VDay v-for="day in days" :key="day.id" :day="day" />
      <!-- Режим просмотра -->
      <VNextDay v-if="!editor" :day="null" />
      <!-- <VDay :day="day[0]" /> -->
      <!-- Режим редактора -->
      <VNewDay v-else />
    </main>
    <VSidebarEditor v-if="editor" class="sidebar" />
  </div>
</template>

<style scoped>
.page {
  display: grid;
  grid-template-areas:
    'header header'
    'days sidebar';
  grid-template-columns: 1fr max-content;
  grid-template-rows: 60px auto;
  height: 100vh;
  color: #fff;
  background: linear-gradient(#6b7587, #1b1e24);
  font-family: Arial, Helvetica, sans-serif;
  /* padding: 0 30px; */
}

.header {
  grid-area: header;
  /* height: 60px;
  position: fixed;
  top: 0;
  left: 0;
  right: 0; */
  display: flex;
  background: rgba(27, 30, 36, 0.5);
}

.container {
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
}

.nav {
  display: flex;
  /* gap: 30px; */
  height: 100%;
}

.nav span {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0px 30px;
}

.main {
  /* grid-area: 'main'; */
  /* display: grid; */
  /* grid-template-columns: 1fr 500px; */
  /* height: calc(100% - 60px); */
  /* padding-top: 60px; */
}

.days {
  grid-area: days;
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  align-content: flex-start;
  column-gap: 30px;
  row-gap: 50px;
  padding: 70px 50px 50px 50px;
}

.button-editor {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 15px 30px;
  border-radius: 5px;
  background: rgba(27, 30, 36, 0.7);
}

.sidebar {
  grid-area: sidebar;
}
</style>
