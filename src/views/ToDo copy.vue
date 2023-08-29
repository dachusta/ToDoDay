<script setup>
import { ref, watch, onMounted } from 'vue'
import ToDoDays from '../components/ToDo/ToDoDays.vue'
import axios from 'axios'

const days = ref([
  // day
  {
    order: 1,
    value: [
      // task
      {
        time: '06:00',
        value: 'Делать'
      }
    ]
  }
])

// Заносить данные в локалстор и получать от туда
watch(
  () => days.value,
  (newValue) => {
    console.log(newValue)
    axios
      .post('https:///tododay-api.ru/setDays', newValue)
      .then(function (response) {
        console.log(response)
      })
      .catch(function (error) {
        console.log(error)
      })
    localStorage.setItem('days', JSON.stringify(newValue))
  },
  { deep: true }
)
onMounted(() => {
  console.log('the component is now mounted.')
  if (localStorage.getItem('days')) {
    days.value = JSON.parse(localStorage.getItem('days'))
  }
})
// Заносить данные в локалстор и получать от туда

// Добавлять и удалять время
function setTask (day) {
  day.value.push({
    time: '',
    value: ''
  })
}
function deleteTask (findTask) {
  days.value[0].value = days.value[0].value.filter(
    (task) => task.time !== findTask.time
  )
}

// Bot tg
fetch(
  'https://api.telegram.org/bot5898941434:AAH9YwrSrbadYPMcm6JVdSECV_v3lVOBL8I/getMe'
)
  .then((response) => {
    return response.json()
  })
  .then((data) => {
    console.log(data)
  })

// let sendMessage = {
//   chat_id: '@ToDoDayNotification',
//   text: 'test)',
// }
// let response = null
// setInterval(async () => {
//   response = await fetch(
//     'https://api.telegram.org/bot5898941434:AAH9YwrSrbadYPMcm6JVdSECV_v3lVOBL8I/sendMessage',
//     {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json;charset=utf-8',
//       },
//       body: JSON.stringify(sendMessage),
//     }
//   )
// }, 10000)

// let result = await response.json()
// console.log(result.message)
</script>
<template>
  <!-- <br /> -->
  <!-- {{ days }} -->
  <!-- <br /> -->

  <ToDoDays
    :days="days"
    @setTask="setTask"
    @deleteTask="deleteTask"
  />
</template>

<style>
/* @media (min-width: 1024px) {
  .about {
    min-height: 100vh;
    display: flex;
    align-items: center;
  }
} */
</style>
