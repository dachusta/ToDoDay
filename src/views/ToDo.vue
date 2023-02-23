<script setup>
import { ref, watch, onMounted } from "vue";
import ToDoDays from "../components/ToDo/ToDoDays.vue";

const days = ref([
  // day
  {
    order: 1,
    value: [
      // task
      {
        time: "06:00",
        value: "Делать",
      },
    ],
  },
]);

// Заносить данные в локалстор и получать от туда
watch(
  () => days.value,
  (newValue) => {
    console.log(newValue);
    localStorage.setItem("days", JSON.stringify(newValue));
  },
  { deep: true }
);
onMounted(() => {
  console.log(`the component is now mounted.`);
  if (localStorage.getItem("days")) {
    days.value = JSON.parse(localStorage.getItem("days"));
  }
});
// Заносить данные в локалстор и получать от туда

// Добавлять и удалять время
function setTask(day) {
  day.value.push({
    time: "",
    value: "",
  });
}
function deleteTask(findTask) {
  days.value[0].value = days.value[0].value.filter(
    (task) => task.time !== findTask.time
  );
}

// Настроить манифест
// Сделать PWA
// Настроить уведомления (пуш и системмные)

// const day = [];
const isServiceWorker = ref(false);
if (!("serviceWorker" in navigator)) {
  // Браузер не поддерживает сервис-воркеры.
  isServiceWorker.value = true;
}

const isPushManager = ref(false);
if (!("PushManager" in window)) {
  // Браузер не поддерживает push-уведомления.
  isPushManager.value = true;
}

function requestPermission() {
  return new Promise(function (resolve, reject) {
    const permissionResult = Notification.requestPermission(function (result) {
      // Поддержка устаревшей версии с функцией обратного вызова.
      resolve(result);
    });

    if (permissionResult) {
      permissionResult.then(resolve, reject);
    }
  }).then(function (permissionResult) {
    if (permissionResult !== "granted") {
      throw new Error("Permission not granted.");
    }
  });
}

function subscribeUserToPush() {
  navigator.serviceWorker.ready
    .then(function (registration) {
      var subscribeOptions = {
        userVisibleOnly: true,
        applicationServerKey: btoa(
          "BMahIJH-CVUnzzZJQNS9cep6xvulTWkaooUU9I1opx2zhnQA2aYnpn0NRZUJkvifMvX4vyjDRRH10Cp92PfwAAE"
        ),
      };
      console.log(registration);
      return registration.pushManager.subscribe(subscribeOptions);
    })
    .then(function (pushSubscription) {
      console.log("PushSubscription: ", JSON.stringify(pushSubscription));
      return pushSubscription;
    });
}
// Notification.requestPermission()
</script>
<template>
  {{
    isServiceWorker
      ? "Браузер не поддерживает сервис-воркеры."
      : "Браузер поддерживает сервис-воркеры."
  }}
  <br />
  {{
    isPushManager
      ? "Браузер не поддерживает push-уведомления."
      : "Браузер поддерживает push-уведомления."
  }}
  <br />
  <button @click="requestPermission">requestPermission</button>
  <button @click="subscribeUserToPush">subscribeUserToPush</button>
  <br />
  {{ days }}
  <br />

  <ToDoDays :days="days" @setTask="setTask" @deleteTask="deleteTask" />
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
