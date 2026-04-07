import React, { createContext, useContext, useEffect, useState } from "react";
import { auth, db, FirebaseUser, handleFirestoreError, OperationType } from "../firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { storageService, LocalUser } from "../services/storageService";
import { apiClient, getAuthToken, setAuthToken } from "../services/apiClient";

// ==========================================
// 开关：是否启用 Firebase (默认关闭)
// ==========================================
export const USE_FIREBASE = false; 

interface UserProfile {
  uid: string;
  email: string;
  role: "admin" | "user";
  balance: number;
  quotaType: "none" | "daily" | "monthly";
  dailyQuota: number;
  quotaExpiresAt: any;
  createdAt: any;
}

interface AuthContextType {
  user: FirebaseUser | LocalUser | null;
  profile: UserProfile | null;
  loading: boolean;
  isAdmin: boolean;
  logout: () => Promise<void>;
  refreshProfile: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAdmin: false,
  logout: async () => {},
  refreshProfile: () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | LocalUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async () => {
    if (!USE_FIREBASE) {
      const token = getAuthToken();
      if (!token) {
        setUser(null);
        setProfile(null);
        return;
      }
      try {
        const data = await apiClient.get('/api/auth/me');
        setUser(data.user);
        setProfile(data.user);
      } catch {
        setAuthToken(null);
        setUser(null);
        setProfile(null);
      }
    }
  };

  useEffect(() => {
    if (USE_FIREBASE) {
      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        setUser(firebaseUser);
        if (firebaseUser) {
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const unsubProfile = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
              setProfile(docSnap.data() as UserProfile);
            } else {
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || "",
                role: firebaseUser.email === "wzjself@gmail.com" ? "admin" : "user",
                balance: 0,
                quotaType: "none",
                dailyQuota: 0,
                quotaExpiresAt: null,
                createdAt: serverTimestamp(),
              };
              setDoc(userDocRef, newProfile).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${firebaseUser.uid}`));
            }
            setLoading(false);
          }, (error) => {
            handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
            setLoading(false);
          });
          return () => unsubProfile();
        } else {
          setProfile(null);
          setLoading(false);
        }
      });
      return () => unsubscribe();
    } else {
      refreshProfile().finally(() => setLoading(false));
    }
  }, []);

  const logout = async () => {
    if (USE_FIREBASE) {
      await signOut(auth);
    } else {
      setAuthToken(null);
      setUser(null);
      setProfile(null);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      profile, 
      loading, 
      isAdmin: profile?.role === "admin",
      logout,
      refreshProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
