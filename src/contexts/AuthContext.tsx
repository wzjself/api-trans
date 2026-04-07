import React, { createContext, useContext, useEffect, useState } from "react";
import { FirebaseUser } from "../firebase";
import { apiClient, getAuthToken, setAuthToken } from "../services/apiClient";

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
  user: FirebaseUser | null;
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
  const [user, setUser] = useState<FirebaseUser | null>(null);
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
    refreshProfile().finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    setAuthToken(null);
    setUser(null);
    setProfile(null);
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
