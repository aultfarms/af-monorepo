import type { FirebaseWebConfig } from '@aultfarms/firebase';

export const firebaseConfig: FirebaseWebConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCZ9wK5Z81vp7ShTIiCfF5Vi7eRUMb7lG4',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'aultfarms-8ffd6.firebaseapp.com',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://aultfarms-8ffd6.firebaseio.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'aultfarms-8ffd6',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'aultfarms-8ffd6.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1090081130077',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:1090081130077:web:30f02d2b93091c06f8afb4',
};
