import { initializeApp } from 'firebase/app';
import { getFirestore, doc, collection, setDoc, onSnapshot, getDoc, getDocFromServer, getDocsFromServer, deleteDoc, runTransaction, writeBatch } from 'firebase/firestore';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, sendPasswordResetEmail } from 'firebase/auth';

window._fbImports = { initializeApp, getFirestore, doc, collection, setDoc, onSnapshot, getDoc, getDocFromServer, getDocsFromServer, deleteDoc, runTransaction, writeBatch, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut, sendPasswordResetEmail };
window.dispatchEvent(new Event('fb-ready'));
