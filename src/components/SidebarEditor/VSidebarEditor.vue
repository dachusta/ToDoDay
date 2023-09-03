<template>
  <aside class="sidebar-editor">
    <div class="tabs">
      <span
        class="tab tab-tasks"
        @click="setTab('tasks')"
      >Дела</span>
      <span
        class="tab tab-days"
        @click="setTab('days')"
      >Дни</span>
    </div>

    <div
      v-if="curentTab === 'tasks'"
      class="tasks"
    >
      <header class="header">
        <VTaskCreator @create-task="createTask" />
      </header>

      <main class="main">
        <VTask
          v-for="task in tasks"
          :key="task.value"
          :task="task"
          @to-day="$emit('toDay', $event)"
          @remove-task="removeTask"
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
import { ref, watch, onMounted } from 'vue'
import VTask from './VTask.vue'
import VTaskCreator from './VTaskCreator.vue'

const curentTab = ref('tasks')

function setTab (tabName) {
  curentTab.value = tabName
}

const tasks = ref([])
watch(
  () => tasks.value,
  () => {
    localStorage.setItem('tasks', JSON.stringify(tasks.value))
  },
  { deep: true }
)
onMounted(() => {
  const tasksLS = localStorage.getItem('tasks')
  if (tasksLS) {
    tasks.value = JSON.parse(tasksLS)
  }
})

function createTask (newTask) {
  tasks.value.unshift({
    priority: newTask.priority,
    value: newTask.value,
    color: newTask.color
  })
}
function removeTask (taskName) {
  tasks.value = tasks.value.filter((task) => taskName !== task.value)
}
</script>

<style scoped>
.sidebar-editor {
  width: 500px;
  background: rgba(27, 30, 36, 0.7);

  .tabs {
    display: flex;

    .tab {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      height: 35px;
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
