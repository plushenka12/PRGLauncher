import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, onSnapshot, getDoc, getDocFromServer, deleteDoc, runTransaction } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, sendPasswordResetEmail } from 'firebase/auth';

window._fbImports = { initializeApp, getFirestore, doc, setDoc, onSnapshot, getDoc, getDocFromServer, deleteDoc, runTransaction, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, sendPasswordResetEmail };
window.dispatchEvent(new Event('fb-ready'));
