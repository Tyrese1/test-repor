import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  verifyPasswordResetCode as firebaseVerifyPasswordResetCode,
  confirmPasswordReset as firebaseConfirmPasswordReset,
  applyActionCode as firebaseApplyActionCode,
  checkActionCode as firebaseCheckActionCode,
  updateProfile,
  signOut, 
  onAuthStateChanged as firebaseOnAuthStateChanged,
  User as FirebaseUser,
  deleteUser,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { 
  getFirestore, 
  collection as firestoreCollection, 
  doc as firestoreDoc, 
  query as firestoreQuery, 
  where as firestoreWhere, 
  orderBy as firestoreOrderBy, 
  onSnapshot as firestoreOnSnapshot, 
  setDoc as firestoreSetDoc, 
  addDoc as firestoreAddDoc, 
  updateDoc as firestoreUpdateDoc, 
  deleteDoc as firestoreDeleteDoc, 
  getDoc as firestoreGetDoc,
  getDocFromServer as firestoreGetDocFromServer,
  getDocs as firestoreGetDocs,
  writeBatch as firestoreWriteBatch,
  Timestamp,
  FirestoreError,
  serverTimestamp
} from 'firebase/firestore';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Export Timestamp and serverTimestamp for use in the app
export { Timestamp, serverTimestamp };

// Auth Functions
export const sendVerificationEmail = async (email: string, displayName: string): Promise<void> => {
  const response = await fetch('/api/send-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name: displayName }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    let errorMessage = 'Failed to send verification email';
    try {
      const errorData = JSON.parse(responseText);
      errorMessage = errorData.error || errorMessage;
    } catch {}
    throw new Error(errorMessage);
  }
};

export const signUpWithEmail = async (email: string, password: string, displayName: string) => {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(result.user, { displayName });

    // Pre-create the Firestore profile to ensure displayName is set correctly
    const userDocRef = firestoreDoc(db, 'users', result.user.uid);
    await firestoreSetDoc(userDocRef, {
      uid: result.user.uid,
      email: result.user.email || '',
      displayName: displayName,
      photoURL: '',
      autoSortEnabled: true,
      sensitiveDataDetectionEnabled: true,
      createdAt: serverTimestamp(),
    });

    // Sign out immediately — user must verify before logging in
    await signOut(auth);

    return result.user;
  } catch (error: any) {
    throw error;
  }
};

export const signInWithEmail = async (email: string, password: string) => {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);

    if (!result.user.emailVerified) {
      await signOut(auth);
      const error = new Error("Please verify your email before signing in.");
      (error as any).code = 'auth/email-not-verified';
      throw error;
    }

    return result.user;
  } catch (error: any) {
    throw error;
  }
};

export const sendPasswordResetEmail = async (email: string) => {
  try {
    const response = await fetch('/api/send-password-reset', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      let errorMessage = 'Failed to send reset email';
      let errorCode = 'api-error';
      
      const responseText = await response.text();
      try {
        const errorData = JSON.parse(responseText);
        errorMessage = errorData.error || errorMessage;
        errorCode = errorData.code || errorCode;
      } catch (e) {
        console.error('Non-JSON error response:', responseText);
        errorMessage = responseText || errorMessage;
      }
      
      const error = new Error(errorMessage);
      (error as any).code = errorCode;
      (error as any).status = response.status;
      throw error;
    }

    return true;
  } catch (error: any) {
    throw error;
  }
};

export const signInWithGoogle = async () => {
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    
    // Check if user profile exists, if not create it
    const userDocRef = firestoreDoc(db, 'users', result.user.uid);
    const userDoc = await firestoreGetDoc(userDocRef);
    
    if (!userDoc.exists()) {
      await firestoreSetDoc(userDocRef, {
        uid: result.user.uid,
        email: result.user.email || '',
        displayName: result.user.displayName || 'User',
        photoURL: result.user.photoURL || '',
        autoSortEnabled: true,
        sensitiveDataDetectionEnabled: true,
        createdAt: serverTimestamp(),
      });
    } else {
      // Update photoURL if it changed or was missing
      if (result.user.photoURL && userDoc.data().photoURL !== result.user.photoURL) {
        await firestoreUpdateDoc(userDocRef, {
          photoURL: result.user.photoURL
        });
      }
    }
    
    return result.user;
  } catch (error: any) {
    throw error;
  }
};

export const logOut = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out:", error);
    throw error;
  }
};



export const deleteUserAccount = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error("No user is currently signed in.");

  try {
    // 1. Delete all user notes
    const notesQuery = firestoreQuery(
      firestoreCollection(db, 'notes'),
      firestoreWhere('userId', '==', user.uid)
    );
    const notesSnapshot = await firestoreGetDocs(notesQuery);
    
    if (!notesSnapshot.empty) {
      const batch = firestoreWriteBatch(db);
      notesSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    }

    // 2. Delete user profile document from Firestore
    const userDocRef = firestoreDoc(db, 'users', user.uid);
    await firestoreDeleteDoc(userDocRef);

    // 3. Delete the user from Firebase Auth
    await deleteUser(user);
    return true;
  } catch (error: any) {
    if (error.code === 'auth/requires-recent-login') {
      // This error means the user needs to re-authenticate
      throw error;
    }
    console.error("Error deleting user account:", error);
    throw error;
  }
};

export const onAuthStateChanged = (authInstance: any, callback: (user: FirebaseUser | null) => void) => {
  return firebaseOnAuthStateChanged(authInstance, callback);
};

// Error Handling
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  
  if (error instanceof FirestoreError && error.code === 'permission-denied') {
    console.error('Firestore Permission Denied: ', JSON.stringify(errInfo));
  } else {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  }
  
  throw new Error(JSON.stringify(errInfo));
}

// Firestore Wrappers with Error Handling
export const collection = firestoreCollection;
export const doc = firestoreDoc;
export const query = firestoreQuery;
export const where = firestoreWhere;
export const orderBy = firestoreOrderBy;

export const onSnapshot = (ref: any, onNext: (snapshot: any) => void, onError?: (error: any) => void) => {
  return firestoreOnSnapshot(ref, onNext, (error) => {
    const path = ref.path || (ref.ref && ref.ref.path) || 'unknown';
    handleFirestoreError(error, OperationType.GET, path);
    if (onError) onError(error);
  });
};

export const setDoc = async (ref: any, data: any) => {
  try {
    return await firestoreSetDoc(ref, data);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, ref.path);
  }
};

export const addDoc = async (ref: any, data: any) => {
  try {
    return await firestoreAddDoc(ref, data);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, ref.path);
  }
};

export const updateDoc = async (ref: any, data: any) => {
  try {
    return await firestoreUpdateDoc(ref, data);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, ref.path);
  }
};

export const deleteDoc = async (ref: any) => {
  try {
    return await firestoreDeleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, ref.path);
  }
};

export const getDoc = async (ref: any) => {
  try {
    return await firestoreGetDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, ref.path);
  }
};

export const getDocFromServer = async (ref: any) => {
  try {
    return await firestoreGetDocFromServer(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, ref.path);
  }
};

// Connection Test
export async function testConnection() {
  try {
    // Try to get a non-existent doc to test connection
    await firestoreGetDocFromServer(firestoreDoc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is offline.");
      return false;
    }
    // Other errors (like permission denied) still mean we are connected
    return true;
  }
}

/**
 * Dangerously clears all notes for the current user.
 */
export const clearUserData = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error("No user is currently signed in.");

  try {
    const notesQuery = firestoreQuery(
      firestoreCollection(db, 'notes'),
      firestoreWhere('userId', '==', user.uid)
    );
    const notesSnapshot = await firestoreGetDocs(notesQuery);
    
    if (!notesSnapshot.empty) {
      const batch = firestoreWriteBatch(db);
      notesSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    }
    return true;
  } catch (error) {
    console.error("Error clearing user data:", error);
    throw error;
  }
};

/**
 * Dangerously clears ALL notes and users in the database.
 * ONLY works if the security rules allow it (usually admin only).
 */
export const clearAllData = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error("No user is currently signed in.");

  try {
    // Clear all notes
    const notesSnapshot = await firestoreGetDocs(firestoreCollection(db, 'notes'));
    if (!notesSnapshot.empty) {
      const batch = firestoreWriteBatch(db);
      notesSnapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
    }

    // Clear all users (except maybe the current one to avoid issues, but user said "erase all")
    const usersSnapshot = await firestoreGetDocs(firestoreCollection(db, 'users'));
    if (!usersSnapshot.empty) {
      const batch = firestoreWriteBatch(db);
      usersSnapshot.docs.forEach((doc) => {
        // We can delete all, including self, but then we'll need to re-create the profile
        batch.delete(doc.ref);
      });
      await batch.commit();
    }
    return true;
  } catch (error) {
    console.error("Error clearing all data:", error);
    throw error;
  }
};

testConnection();

export type { FirebaseUser };

/**
 * Verify a Firebase password-reset oobCode and return the associated email.
 * Used by the /reset-password page to validate the link before showing the form.
 */
export const verifyPasswordResetCode = (oobCode: string): Promise<string> =>
  firebaseVerifyPasswordResetCode(auth, oobCode);

/**
 * Complete a password reset with the verified oobCode and the user's new password.
 */
export const confirmPasswordReset = (
  oobCode: string,
  newPassword: string
): Promise<void> => firebaseConfirmPasswordReset(auth, oobCode, newPassword);

/**
 * Check whether the candidate password matches the user's CURRENT password.
 * Used during password reset to prevent users from reusing the same password.
 *
 * Returns true if the password matches (i.e. same as current).
 * Returns false if it doesn't match (safe to reset to this new password).
 *
 * Implementation: attempts a sign-in with the candidate. If it succeeds, that's
 * proof the password matches — we sign out immediately. The oobCode is NOT
 * consumed by this check, only by confirmPasswordReset.
 */
export const isCurrentPassword = async (
  email: string,
  candidatePassword: string
): Promise<boolean> => {
  let matched = false;
  try {
    const cred = await signInWithEmailAndPassword(
      auth,
      email,
      candidatePassword
    );
    if (cred && cred.user) {
      matched = true;
    }
  } catch {
    matched = false;
  }
  if (matched) {
    try {
      await signOut(auth);
    } catch {
      // Ignore sign-out errors; still report "matched" to caller.
    }
  }
  return matched;
};

/**
 * Inspect a Firebase action code without consuming it. Used by /verify-email
 * to confirm the oobCode is valid (and pull the email address it's bound to)
 * before showing the success state.
 */
export const checkActionCode = (oobCode: string) =>
  firebaseCheckActionCode(auth, oobCode);

/**
 * Apply (consume) a Firebase action code — for email verification this marks
 * the user's email as verified server-side. The user must then sign in to
 * pick up the new state on this device.
 */
export const applyActionCode = (oobCode: string): Promise<void> =>
  firebaseApplyActionCode(auth, oobCode);
