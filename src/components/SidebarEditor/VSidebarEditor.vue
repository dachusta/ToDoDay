<template>
  <aside class="sidebar-editor">
    <div class="tabs">
      <span
        class="tab tab-tasks"
        :class="{ active: curentTab === 'tasks' }"
        @click="setTab('tasks')"
      >Дела</span>
      <span
        class="tab tab-days"
        :class="{ active: curentTab === 'days' }"
        @click="setTab('days')"
      >Дни</span>
    </div>

    <div
      v-if="curentTab === 'tasks'"
      class="tasks"
    >
      <header class="header">
        <VTaskCreator @create-task="tasks.createTask" />
      </header>

      <main class="main">
        <VTask
          v-for="task in tasks.list"
          :key="task._id"
          :task="task"
          @add-task-in-day="days.addTask"
          @update-task="tasks.updateTask"
          @remove-task="tasks.removeTask"
        />
      </main>
    </div>

    <div
      v-if="curentTab === 'days'"
      class="days"
    >
      <span>Слева выберите созданный вами день, чтобы сохранить его в этом
        списке</span>
    </div>
  </aside>
</template>

<script setup>
import VTask from './VTask.vue'
import VTaskCreator from './VTaskCreator.vue'
import { useTabs } from '../../composables/tabs'
import { useTasksStore } from '../../stores/tasks'
import { useDaysStore } from '../../stores/days'

const { curentTab, setTab } = useTabs()
curentTab.value = 'tasks'

const days = useDaysStore()
const tasks = useTasksStore()

</script>

<style scoped>
.sidebar-editor {
  overflow: auto;
  width: 500px;
  background: rgba(27, 30, 36, 0.7);

  .tabs {
    display: flex;

    .tab {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      padding: 16px 0;
      cursor: pointer;

      &.active {
        background: rgba(27, 30, 36, 0.5);
      }

      &:hover {
        background: rgba(27, 30, 36, 0.7);
      }
    }
  }

  .tasks {
    display: grid;
    gap: 30px;
    padding: 20px 50px 20px 50px;

    .main {
      display: grid;
      gap: 10px;
    }
  }
}
</style>
