// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE CONFIG — main app (accounts, parties, rounds, questions, endgame, timeline)
// ─────────────────────────────────────────────────────────────────────────────
// INSTRUCTIONS:
//   1. Create a new Firebase project at https://console.firebase.google.com/
//      (see FIREBASE_SETUP.md for step-by-step)
//   2. Add a Web App to the project and copy the firebaseConfig values below
//   3. Enable Authentication > Google sign-in
//   4. Create a Realtime Database and deploy database.rules.json
//
// Until you fill this in, the app stays locked on the Google sign-in screen.

window.JETLAG_FIREBASE_CONFIG = {
  apiKey:           "AIzaSyC-U0lsFxqD6FECuVkDs9JX86xUvuxVas4",
  authDomain:       "lampskene-77ff9.firebaseapp.com",
  databaseURL:      "https://lampskene-77ff9-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:        "lampskene-77ff9",
  storageBucket:    "lampskene-77ff9.firebasestorage.app",
  messagingSenderId:"201288601364",
  appId:            "1:201288601364:web:fa189273f0cef2aec5bc01"
};

// Set to true once you've filled in the config above. When false, the app shows
// a "Firebase not configured" notice on the mode screen instead of trying to
// connect (which would spam console errors).
window.JETLAG_FIREBASE_CONFIGURED = true;
