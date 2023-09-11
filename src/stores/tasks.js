import { ref } from 'vue'
import { defineStore } from 'pinia'
import axios from 'axios'

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref([])

  function setTasks (tasks) {
    axios
      .post(`${import.meta.env.VITE_URL}/setTasks`, tasks)
      .then(function (response) {
        console.log(response)
      })
      .catch(function (error) {
        console.log(error)
      })
  }
  function getTasks () {
    axios
      .get(`${import.meta.env.VITE_URL}/getTasks`)
      .then(function (response) {
        console.log(response)
        console.log(response.data.data)
        tasks.value = response.data.data
      })
      .catch(function (error) {
        console.log(error)
      })
  }

  function createTask (newTask) {
    tasks.value.unshift({
      priority: newTask.priority,
      value: newTask.value,
      color: newTask.color
    })
    setTasks(tasks.value)
  }
  function removeTask (taskName) {
    tasks.value = tasks.value.filter((task) => taskName !== task.value)
  }

  return {
    tasks,
    setTasks,
    getTasks,
    createTask,
    removeTask
  }
})
