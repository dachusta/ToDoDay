<script setup>
import { onMounted } from 'vue'
// import ToDoDays from '../components/ToDo/ToDoDays.vue'
import VDay from '../components/ToDo/VDay.vue'
import VNextDay from '../components/ToDo/VNextDay.vue'
import VNewDay from '../components/ToDo/VNewDay.vue'
import VSidebarEditor from '../components/SidebarEditor/VSidebarEditor.vue'
import VButton from '../components/VButton.vue'
import { useDaysStore } from '../stores/days'

const days = useDaysStore()

onMounted(() => {
  days.getDays()
})

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
      <div
        class="buttons-editor"
      >
        <VButton
          v-if="days.isEditor"
          class="button-save"
          @click="days.saveDays"
        >
          Сохранить
        </VButton>
        <VButton
          v-else
          class="button-edit"
          @click="days.editDays"
        >
          Редактировать
        </VButton>
      </div>

      <VDay
        v-for="(day, idx) in days.days"
        :key="day.id"
        :day="day"
        :order="idx"
        :selected-day="days.selectedDay"
        :is-editor="days.isEditor"
        @remove-day="days.removeDay"
        @select-day="days.selectDay"
        @remove-task="days.removeTask"
        @set-task-time="days.setTaskTime"
        @set-task-checked="days.setTaskChecked"
        @to-prev-day="days.toPrevDay"
        @to-next-day="days.toNextDay"
      />

      <!-- Режим редактора -->
      <VNewDay
        v-if="days.isEditor"
        :order="days.days.length"
        @create-day="days.createDay"
      />

      <!-- Режим просмотра -->
      <VNextDay
        v-if="false"
        :day="null"
      />
      <!-- <VDay :day="day[0]" /> -->
    </main>
    <VSidebarEditor
      v-if="days.isEditor"
      class="sidebar"
      @to-day="days.addTaskToDay"
    />
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
  overflow: auto;
}

.buttons-editor {
  position: absolute;
  top: 10px;
  right: 10px;
}
.buttons-editor button {
  padding: 15px 30px;
  border-radius: 5px;
  color: inherit;
  border: none;
  background: rgba(27, 30, 36, 0.7);
}

.sidebar {
  grid-area: sidebar;
}
</style>
