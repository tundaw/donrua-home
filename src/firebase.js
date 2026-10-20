// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCsrW8k30zkZq3kG7KDYQkGQywEUT5WfPk",
  authDomain: "don-rua-home.firebaseapp.com",
  projectId: "don-rua-home",
  storageBucket: "don-rua-home.firebasestorage.app",
  messagingSenderId: "195684125380",
  appId: "1:195684125380:web:a4aef8ca8b9d1ade489791",
  measurementId: "G-KLHFNRFCJ3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);