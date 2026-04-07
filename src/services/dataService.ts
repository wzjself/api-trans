import { db, handleFirestoreError, OperationType } from "../firebase";
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, setDoc, deleteDoc, updateDoc, orderBy, limit, getDoc } from "firebase/firestore";
import { storageService } from "./storageService";
import { USE_FIREBASE } from "../contexts/AuthContext";

export const dataService = {
  // API Keys
  subscribeApiKeys: (uid: string, callback: (keys: any[]) => void) => {
    if (USE_FIREBASE) {
      const q = query(collection(db, "api_keys"), where("uid", "==", uid));
      return onSnapshot(q, (snapshot) => {
        callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (error) => handleFirestoreError(error, OperationType.LIST, "api_keys"));
    } else {
      callback(storageService.getApiKeys(uid));
      return () => {};
    }
  },
  addApiKey: async (uid: string, name: string) => {
    if (USE_FIREBASE) {
      const key = `sk-${Math.random().toString(36).substring(2, 32)}`;
      await addDoc(collection(db, "api_keys"), {
        uid,
        name,
        key,
        status: "active",
        createdAt: serverTimestamp(),
      });
    } else {
      storageService.addApiKey(uid, name);
    }
  },
  revokeApiKey: async (id: string) => {
    if (USE_FIREBASE) {
      await updateDoc(doc(db, "api_keys", id), { status: "revoked" });
    } else {
      storageService.revokeKey(id);
    }
  },

  // Usage Logs
  subscribeLogs: (uid: string, callback: (logs: any[]) => void, limitCount?: number) => {
    if (USE_FIREBASE) {
      let q = query(collection(db, "usage_logs"), where("uid", "==", uid), orderBy("timestamp", "desc"));
      if (limitCount) q = query(q, limit(limitCount));
      
      return onSnapshot(q, (snapshot) => {
        callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (error) => handleFirestoreError(error, OperationType.LIST, "usage_logs"));
    } else {
      let logs = storageService.getLogs(uid);
      logs.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      if (limitCount) logs = logs.slice(0, limitCount);
      
      const formattedLogs = logs.map((l: any) => ({
        ...l,
        timestamp: { toDate: () => new Date(l.timestamp) } // 模拟 Firestore Timestamp
      }));
      callback(formattedLogs);
      return () => {};
    }
  },
  addLog: async (uid: string, tokens: number, model: string) => {
    if (USE_FIREBASE) {
      await addDoc(collection(db, "usage_logs"), {
        uid,
        tokens,
        timestamp: serverTimestamp(),
        model,
      });
      
      // Deduct balance if using permanent quota
      const userRef = doc(db, "users", uid);
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (!userData.quotaType || userData.quotaType === "none" || userData.quotaType === "permanent") {
          await updateDoc(userRef, {
            balance: Math.max(0, (userData.balance || 0) - tokens)
          });
        }
      }
    } else {
      storageService.addLog(uid, tokens, model);
    }
  },

  // Redemption
  useCode: async (code: string, uid: string) => {
    if (USE_FIREBASE) {
      const codeDoc = await getDoc(doc(db, "redemption_codes", code));
      if (!codeDoc.exists() || codeDoc.data().isUsed) {
        throw new Error("无效或已使用的兑换码");
      }
      const data = codeDoc.data();
      const userRef = doc(db, "users", uid);
      const userDoc = await getDoc(userRef);
      if (!userDoc.exists()) throw new Error("用户不存在");

      const userData = userDoc.data();
      if (data.type === "permanent") {
        await updateDoc(userRef, { balance: (userData.balance || 0) + data.value });
      } else {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + (data.durationDays || 30) * 24 * 60 * 60 * 1000);
        await updateDoc(userRef, {
          quotaType: data.type,
          dailyQuota: data.value,
          quotaExpiresAt: expiresAt,
        });
      }
      await updateDoc(doc(db, "redemption_codes", code), { isUsed: true });
    } else {
      storageService.useCode(code, uid);
    }
  },

  // Admin
  subscribeAllUsers: (callback: (users: any[]) => void) => {
    if (USE_FIREBASE) {
      return onSnapshot(collection(db, "users"), (snapshot) => {
        callback(snapshot.docs.map(doc => doc.data()));
      }, (error) => handleFirestoreError(error, OperationType.LIST, "users"));
    } else {
      callback(storageService.getAllUsers());
      return () => {};
    }
  },
  subscribeAllCodes: (callback: (codes: any[]) => void) => {
    if (USE_FIREBASE) {
      const q = query(collection(db, "redemption_codes"), orderBy("createdAt", "desc"));
      return onSnapshot(q, (snapshot) => {
        callback(snapshot.docs.map(doc => doc.data()));
      }, (error) => handleFirestoreError(error, OperationType.LIST, "redemption_codes"));
    } else {
      let codes = storageService.getRedemptionCodes();
      codes.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(codes);
      return () => {};
    }
  },
  addCode: async (codeData: any) => {
    if (USE_FIREBASE) {
      await setDoc(doc(db, "redemption_codes", codeData.code), {
        ...codeData,
        isUsed: false,
        createdAt: serverTimestamp(),
      });
    } else {
      storageService.addCode(codeData);
    }
  },
  deleteCode: async (code: string) => {
    if (USE_FIREBASE) {
      await deleteDoc(doc(db, "redemption_codes", code));
    } else {
      storageService.deleteCode(code);
    }
  },
  updateUserBalance: async (uid: string, balance: number) => {
    if (USE_FIREBASE) {
      await updateDoc(doc(db, "users", uid), { balance });
    } else {
      storageService.updateUserBalance(uid, balance);
    }
  },

  // Settings
  subscribeSettings: (callback: (settings: any) => void) => {
    if (USE_FIREBASE) {
      return onSnapshot(doc(db, "settings", "general"), (docSnap) => {
        if (docSnap.exists()) {
          callback(docSnap.data());
        } else {
          callback({ guideLink: "" });
        }
      }, (error) => handleFirestoreError(error, OperationType.GET, "settings/general"));
    } else {
      callback(storageService.getSettings());
      return () => {};
    }
  },
  updateSettings: async (settings: any) => {
    if (USE_FIREBASE) {
      await setDoc(doc(db, "settings", "general"), settings, { merge: true });
    } else {
      storageService.updateSettings(settings);
    }
  }
};
