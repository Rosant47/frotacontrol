// ============================================================
// CONFIGURAÇÃO DO FIREBASE
// Cole aqui os dados do seu projeto em:
// console.firebase.google.com → Configurações do projeto → Seus apps
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyChncsYZ1jNTfhtDzLWdYAJJdGyxnUc8vg",
  authDomain: "frota-empresa-a8202.firebaseapp.com",
  projectId: "frota-empresa-a8202",
  storageBucket: "frota-empresa-a8202.firebasestorage.app",
  messagingSenderId: "23548544092",
  appId: "1:23548544092:web:dda8bb4b0ee045e1109299"
};

// ============================================================
// CONFIGURAÇÃO DA MARCA (altere por cliente)
// palette: blue | green | purple | red | teal
// ============================================================

export const brandConfig = {
  superadminEmail: 'rbeto45@gmail.com',
  name:            'FrotaControl',
  tagline:         'Controle de Veículos Empresarial',
  palette:         'blue',
  supportEmail:    '',
  supportWhatsApp: '5511974678968',
  trialDays:       14,
  callmebotApiKey: '', // Chave do CallMeBot para notificações automáticas de pagamento
  ntfyTopic:       'frotacontrol-rbeto', // Tópico do ntfy.sh para notificações push

  // MercadoPago — crie os planos de assinatura em:
  // mercadopago.com.br → Cobranças → Assinaturas → Criar plano
  // Cole os IDs dos planos abaixo (ex: 2c93808490709c2001907b4d36790e85)
  mpPublicKey: 'APP_USR-03fbdd56-c7c4-4d90-80f6-2285870cc816',
  // Chave VAPID para push notifications (FCM)
  // Obtenha em: Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Gerar par de chaves
  fcmVapidKey: '',
  mercadopago: {
    basico:       'b720b0b44eed4379bfd5c407526148c5',
    profissional: 'e58d9305777d498f9d1c733a9e9d873c',
    empresarial:  'd222915231014abfb4702d61c1fad1d6',
  },
};

