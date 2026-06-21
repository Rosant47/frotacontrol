importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyChncsYZ1jNTfhtDzLWdYAJJdGyxnUc8vg',
  authDomain:        'frota-empresa-a8202.firebaseapp.com',
  projectId:         'frota-empresa-a8202',
  storageBucket:     'frota-empresa-a8202.firebasestorage.app',
  messagingSenderId: '23548544092',
  appId:             '1:23548544092:web:dda8bb4b0ee045e1109299',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  self.registration.showNotification(
    payload.notification?.title || 'FrotaControl',
    {
      body:  payload.notification?.body || '',
      icon:  '/logo.jpg',
      badge: '/logo.jpg',
    }
  );
});
