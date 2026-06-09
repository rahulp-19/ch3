// firebase-config.js
// Replace these placeholders with your actual Firebase project settings.
// You can get these details from the Firebase Console (Settings > Project Settings).
export const firebaseConfig = {
  apiKey: "AIzaSyADXensK02bXZU197PtKOr_CNacw-nX1A0",
  authDomain: "vibeus-f1536.firebaseapp.com",
  databaseURL: "https://vibeus-f1536-default-rtdb.firebaseio.com",
  projectId: "vibeus-f1536",
  storageBucket: "vibeus-f1536.firebasestorage.app",
  messagingSenderId: "464924213539",
  appId: "1:464924213539:web:ef423a7215578d0b4ecc96",
  measurementId: "G-CML58T1FKL"
};

// Application Custom Configurations
export const APP_CONFIG = {
  // Secret passcode to gain entry to the chat (Only numeric passcode matches standard pin entry screens, but can be text too)
  PASSCODE: "1402",
  
  // Relationship Start Date (Format: YYYY-MM-DD)
  // Used to count "Together for X days ❤️"
  RELATIONSHIP_START_DATE: "2026-01-09"
};

export { firebaseConfig };
