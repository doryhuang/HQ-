/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  Camera, 
  Calendar, 
  CheckCircle2, 
  History, 
  X, 
  Save,
  ChevronRight,
  Calculator,
  AlertCircle,
  LogIn,
  LogOut,
  Settings,
  UserPlus,
  ArrowRightLeft,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth, signIn, logout } from './firebase';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  deleteDoc, 
  doc,
  getDocFromServer,
  setDoc,
  updateDoc
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';

// --- Types ---

interface Staff {
  id: string;
  name: string;
  region: 'TW' | 'CN';
  inOffice: boolean;
}

interface AllocationRecord {
  id: string;
  date: string;
  totalUnits: number;
  allocations: { [name: string]: number };
}

// --- Constants ---

const INITIAL_STAFF: Staff[] = [
  { id: 'tw-1', name: 'Dory', region: 'TW', inOffice: true },
  { id: 'tw-2', name: 'Cindy', region: 'TW', inOffice: true },
  { id: 'cn-1', name: 'Pizza', region: 'CN', inOffice: true },
  { id: 'cn-2', name: 'Mia', region: 'CN', inOffice: true },
  { id: 'cn-3', name: 'Cloriss', region: 'CN', inOffice: true },
];

const STORAGE_KEY = 'furbo_allocation_history';

export default function App() {
  // --- State ---
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [staff, setStaff] = useState<Staff[]>(INITIAL_STAFF);
  const [totalUnitsInput, setTotalUnitsInput] = useState<string>('');
  const [history, setHistory] = useState<AllocationRecord[]>([]);
  const [currentResult, setCurrentResult] = useState<{ [name: string]: number } | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRegion, setNewStaffRegion] = useState<'TW' | 'CN'>('TW');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // --- Firebase Auth ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // --- Firebase Firestore Connection Test ---
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // --- Firebase Firestore Data Sync ---
  useEffect(() => {
    if (!user) {
      setHistory([]);
      setStaff(INITIAL_STAFF);
      return;
    }

    // Sync History
    const qHistory = query(collection(db, 'allocations'), orderBy('date', 'desc'));
    const unsubHistory = onSnapshot(qHistory, (snapshot) => {
      const records: AllocationRecord[] = [];
      snapshot.forEach((doc) => {
        records.push({ ...doc.data(), id: doc.id } as AllocationRecord);
      });
      setHistory(records);
    });

    // Sync Staff
    const qStaff = query(collection(db, 'staff'));
    const unsubStaff = onSnapshot(qStaff, (snapshot) => {
      if (snapshot.empty) {
        // Seed initial staff if collection is empty
        INITIAL_STAFF.forEach(async (s) => {
          await setDoc(doc(db, 'staff', s.id), {
            name: s.name,
            region: s.region,
            inOffice: s.inOffice,
            active: true
          });
        });
      } else {
        const staffList: Staff[] = [];
        snapshot.forEach((doc) => {
          staffList.push({ ...doc.data(), id: doc.id } as Staff);
        });
        setStaff(staffList);
      }
    });

    return () => {
      unsubHistory();
      unsubStaff();
    };
  }, [user]);

  // --- Helpers ---
  const toggleInOffice = async (id: string) => {
    if (!user) return;
    const member = staff.find(s => s.id === id);
    if (!member) return;
    
    try {
      await updateDoc(doc(db, 'staff', id), {
        inOffice: !member.inOffice
      });
    } catch (e) {
      console.error("Failed to update inOffice status", e);
    }
  };

  const updateStaffRegion = async (id: string, newRegion: 'TW' | 'CN') => {
    if (!user) return;
    try {
      const member = staff.find(s => s.id === id);
      if (!member) return;
      await updateDoc(doc(db, 'staff', id), {
        region: newRegion
      });
    } catch (e) {
      console.error("Failed to update region", e);
      alert("更新區域失敗，請檢查權限或網路。");
    }
  };

  const addStaffMember = async () => {
    if (!user || !newStaffName.trim()) return;
    try {
      const id = `staff-${Date.now()}`;
      await setDoc(doc(db, 'staff', id), {
        name: newStaffName.trim(),
        region: newStaffRegion,
        inOffice: true,
        active: true
      });
      setNewStaffName('');
    } catch (e) {
      console.error("Failed to add staff", e);
    }
  };

  const deleteStaffMember = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'staff', id));
      setConfirmDeleteId(null);
    } catch (e) {
      console.error("Failed to delete staff", e);
    }
  };

  const calculateAllocation = () => {
    const totalUnits = parseInt(totalUnitsInput) || 0;
    if (totalUnits <= 0) {
      setCurrentResult(null);
      return;
    }

    const inOfficeTW = staff.filter(s => s.region === 'TW' && s.inOffice);
    const inOfficeCN = staff.filter(s => s.region === 'CN' && s.inOffice);
    
    const nTW = inOfficeTW.length;
    const nCN = inOfficeCN.length;
    const nTotal = nTW + nCN;

    const result: { [name: string]: number } = {};
    staff.forEach(s => result[s.name] = 0);

    if (nTotal === 0) {
      setCurrentResult(null);
      return;
    }

    // Sort staff by monthly stats to ensure fairness (lowest first)
    const sortedTW = [...inOfficeTW].sort((a, b) => (monthlyStats[a.name] || 0) - (monthlyStats[b.name] || 0));
    const sortedCN = [...inOfficeCN].sort((a, b) => (monthlyStats[a.name] || 0) - (monthlyStats[b.name] || 0));

    const base = Math.floor(totalUnits / nTotal);
    let remainder = totalUnits % nTotal;

    // Everyone gets base
    inOfficeTW.forEach(s => result[s.name] = base);
    inOfficeCN.forEach(s => result[s.name] = base);

    // Distribute remainder: TW priority, then CN, both sorted by monthly total
    // 1. Give to TW first
    for (let i = 0; i < sortedTW.length && remainder > 0; i++) {
      result[sortedTW[i].name] += 1;
      remainder--;
    }
    // 2. Give to CN if remainder still exists
    for (let i = 0; i < sortedCN.length && remainder > 0; i++) {
      result[sortedCN[i].name] += 1;
      remainder--;
    }

    setCurrentResult(result);
  };

  const saveAllocation = async () => {
    if (!currentResult || !user || isSaving) return;
    
    setIsSaving(true);
    setSaveError(null);

    const newRecord = {
      date: new Date().toISOString(),
      totalUnits: parseInt(totalUnitsInput) || 0,
      allocations: currentResult
    };

    try {
      await addDoc(collection(db, 'allocations'), newRecord);
      setTotalUnitsInput('');
      setCurrentResult(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveError(message);
      const errInfo = {
        error: message,
        operationType: 'create',
        path: 'allocations',
        authInfo: {
          userId: auth.currentUser?.uid,
          email: auth.currentUser?.email
        }
      };
      console.error('Firestore Error: ', JSON.stringify(errInfo));
    } finally {
      setIsSaving(false);
    }
  };

  const deleteRecord = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'allocations', id));
    } catch (error) {
      const errInfo = {
        error: error instanceof Error ? error.message : String(error),
        operationType: 'delete',
        path: `allocations/${id}`,
        authInfo: {
          userId: auth.currentUser?.uid,
          email: auth.currentUser?.email
        }
      };
      console.error('Firestore Error: ', JSON.stringify(errInfo));
    }
  };

  // --- Statistics ---
  const sortedStaff = useMemo(() => {
    return [...staff].sort((a, b) => {
      if (a.region !== b.region) {
        return a.region === 'TW' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [staff]);

  const monthlyStats = useMemo(() => {
    const stats: { [name: string]: number } = {};
    staff.forEach(s => stats[s.name] = 0);

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    history.forEach(record => {
      const recordDate = new Date(record.date);
      if (recordDate.getMonth() === currentMonth && recordDate.getFullYear() === currentYear) {
        Object.entries(record.allocations).forEach(([name, count]) => {
          stats[name] = (stats[name] || 0) + (count as number);
        });
      }
    });

    return stats;
  }, [history, staff]);

  const totalMonthlyUnits = useMemo(() => {
    return Object.values(monthlyStats).reduce((acc: number, curr: number) => acc + curr, 0);
  }, [monthlyStats]);

  const yearlyStats = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const months = Array.from({ length: 12 }, (_, i) => i);
    const stats = months.map(m => {
      const monthTotal = history
        .filter(r => {
          const d = new Date(r.date);
          return d.getFullYear() === currentYear && d.getMonth() === m;
        })
        .reduce((acc: number, r: AllocationRecord) => acc + r.totalUnits, 0);
      return monthTotal;
    });
    return stats;
  }, [history]);

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#1C1917] font-sans selection:bg-[#E7E5E4]">
      {/* Staff Management Modal */}
      <AnimatePresence>
        {showStaffModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-[#E7E5E4] flex justify-between items-center bg-[#FAFAF9]">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Settings size={20} />
                  人員名單管理
                </h3>
                <button 
                  onClick={() => setShowStaffModal(false)}
                  className="p-2 hover:bg-[#E7E5E4] rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Add New Staff */}
                <div className="space-y-3">
                  <p className="text-[10px] font-mono text-[#A8A29E] uppercase tracking-widest">新增人員</p>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={newStaffName}
                      onChange={(e) => setNewStaffName(e.target.value)}
                      placeholder="姓名"
                      className="flex-1 bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl px-3 py-2 text-sm focus:outline-none"
                    />
                    <select 
                      value={newStaffRegion}
                      onChange={(e) => setNewStaffRegion(e.target.value as 'TW' | 'CN')}
                      className="bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl px-2 py-2 text-sm"
                    >
                      <option value="TW">TW</option>
                      <option value="CN">CN</option>
                    </select>
                    <button 
                      onClick={addStaffMember}
                      className="bg-[#1C1917] text-white p-2 rounded-xl hover:bg-[#44403C]"
                    >
                      <UserPlus size={18} />
                    </button>
                  </div>
                </div>

                {/* Staff List */}
                <div className="space-y-3">
                  <p className="text-[10px] font-mono text-[#A8A29E] uppercase tracking-widest">現有人員</p>
                  <div className="divide-y divide-[#F5F5F4]">
                    {sortedStaff.map(member => (
                      <div key={member.id} className="py-3 flex items-center justify-between group">
                        <div>
                          <p className="font-bold text-sm">{member.name}</p>
                          <p className="text-[10px] text-[#A8A29E] font-mono">{member.region} 團隊</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {confirmDeleteId === member.id ? (
                            <div className="flex items-center gap-1">
                              <button 
                                onClick={() => deleteStaffMember(member.id)}
                                className="px-2 py-1 bg-red-500 text-white text-[10px] rounded hover:bg-red-600"
                              >
                                刪除
                              </button>
                              <button 
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1 bg-[#E7E5E4] text-[#78716C] text-[10px] rounded hover:bg-[#D6D3D1]"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <>
                              <button 
                                onClick={() => updateStaffRegion(member.id, member.region === 'TW' ? 'CN' : 'TW')}
                                className="p-2 text-[#78716C] hover:bg-[#F5F5F4] rounded-lg transition-colors"
                                title="切換區域"
                              >
                                <ArrowRightLeft size={16} />
                              </button>
                              <button 
                                onClick={() => setConfirmDeleteId(member.id)}
                                className="p-2 text-[#A8A29E] hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {showHistoryModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-[#E7E5E4] flex justify-between items-center bg-[#FAFAF9]">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Calendar size={20} />
                  每日分配明細
                </h3>
                <button 
                  onClick={() => setShowHistoryModal(false)}
                  className="p-2 hover:bg-[#E7E5E4] rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <div className="grid grid-cols-7 gap-1 mb-4">
                  {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                    <div key={d} className="text-center text-[10px] font-bold text-[#A8A29E] py-2">{d}</div>
                  ))}
                  {(() => {
                    const now = new Date();
                    const year = now.getFullYear();
                    const month = now.getMonth();
                    const firstDay = new Date(year, month, 1).getDay();
                    const daysInMonth = new Date(year, month + 1, 0).getDate();
                    
                    const days = [];
                    // Empty slots for previous month
                    for (let i = 0; i < firstDay; i++) {
                      days.push(<div key={`empty-${i}`} className="h-16 border border-transparent" />);
                    }
                    
                    // Days of current month
                    for (let d = 1; d <= daysInMonth; d++) {
                      const dateStr = new Date(year, month, d).toLocaleDateString();
                      const dayTotal = history
                        .filter(r => new Date(r.date).toLocaleDateString() === dateStr)
                        .reduce((acc, r) => acc + r.totalUnits, 0);
                      
                      days.push(
                        <div key={d} className={`h-16 border border-[#F5F5F4] p-1 flex flex-col justify-between ${d === now.getDate() ? 'bg-[#F5F5F4]' : ''}`}>
                          <span className="text-[10px] font-mono text-[#A8A29E]">{d}</span>
                          {dayTotal > 0 && (
                            <div className="bg-[#1C1917] text-white text-[10px] font-bold px-1 py-0.5 rounded text-center truncate">
                              {dayTotal}台
                            </div>
                          )}
                        </div>
                      );
                    }
                    return days;
                  })()}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white border-b border-[#E7E5E4] px-6 py-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-[#A8A29E] text-xs font-mono uppercase tracking-widest mb-2">
              <Camera size={14} />
              <span>Furbo Support Operations</span>
            </div>
            <h1 className="text-4xl font-sans font-bold tracking-tight text-[#1C1917]">
              HQ 檢測機器輪值統計
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            {isAuthReady && (
              user ? (
                <div className="flex items-center gap-3 bg-white border border-[#E7E5E4] px-3 py-2 rounded-xl">
                  {user.photoURL && (
                    <img src={user.photoURL} alt={user.displayName || ''} className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                  )}
                  <div className="hidden sm:block">
                    <p className="text-[10px] font-mono text-[#A8A29E] uppercase leading-none">Logged in as</p>
                    <p className="text-sm font-bold">{user.displayName}</p>
                  </div>
                  <button 
                    onClick={logout}
                    className="p-2 text-[#A8A29E] hover:text-[#1C1917] transition-colors"
                    title="登出"
                  >
                    <LogOut size={18} />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={signIn}
                  className="flex items-center gap-2 bg-[#1C1917] text-white px-4 py-2 rounded-xl font-medium hover:bg-[#44403C] transition-colors"
                >
                  <LogIn size={18} />
                  Google 登入
                </button>
              )
            )}

            <div 
              onClick={() => setShowHistoryModal(true)}
              className="flex items-center gap-4 bg-[#F5F5F4] px-4 py-2 rounded-lg border border-[#E7E5E4] cursor-pointer hover:bg-[#E7E5E4] transition-colors group"
            >
              <div className="text-right">
                <p className="text-[10px] uppercase font-mono text-[#78716C] leading-none">當月分配結果</p>
                <p className="text-2xl font-mono font-medium">{totalMonthlyUnits}</p>
              </div>
              <Calendar className="text-[#A8A29E] group-hover:text-[#1C1917] transition-colors" size={20} />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12 space-y-16">
        {!user && isAuthReady ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-[#E7E5E4] shadow-sm">
            <AlertCircle size={48} className="text-[#A8A29E] mb-4 opacity-20" />
            <h2 className="text-xl font-bold mb-2">請先登入以同步資料</h2>
            <p className="text-[#78716C] mb-8">登入後即可與其他團隊成員同步歷史紀錄與統計數據。</p>
            <button 
              onClick={signIn}
              className="flex items-center gap-2 bg-[#1C1917] text-white px-8 py-4 rounded-2xl font-bold hover:bg-[#44403C] transition-all transform hover:scale-105"
            >
              <LogIn size={20} />
              使用 Google 帳號登入
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          
          {/* Left Column: Input & Staff */}
          <div className="lg:col-span-7 space-y-12">
            
            {/* Input Section */}
            <section>
              <h2 className="text-xs font-mono uppercase tracking-widest text-[#78716C] mb-6 flex items-center gap-2">
                <Calculator size={14} />
                01. 當日數量
              </h2>
              <div className="bg-white p-8 rounded-2xl border border-[#E7E5E4] shadow-sm">
                <label className="block text-sm font-medium text-[#44403C] mb-2">
                  今日收到機器總數
                </label>
                <div className="flex gap-3">
                  <input
                    type="number"
                    value={totalUnitsInput}
                    onChange={(e) => setTotalUnitsInput(e.target.value)}
                    placeholder="輸入數量..."
                    className="flex-1 bg-[#F5F5F4] border border-[#E7E5E4] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#1C1917]/10 transition-all font-mono text-lg"
                  />
                  <button
                    onClick={calculateAllocation}
                    className="bg-[#1C1917] text-white px-6 py-3 rounded-xl font-medium hover:bg-[#44403C] transition-colors flex items-center gap-2"
                  >
                    計算分配
                  </button>
                </div>
              </div>
            </section>

            {/* Staff Section */}
            <section>
              <h2 className="text-xs font-mono uppercase tracking-widest text-[#78716C] mb-6 flex items-center gap-2">
                <Users size={14} />
                02. 到班人員
                <button 
                  onClick={() => setShowStaffModal(true)}
                  className="ml-auto p-1 hover:bg-[#E7E5E4] rounded transition-colors text-[#A8A29E] hover:text-[#1C1917]"
                  title="管理人員名單"
                >
                  <Settings size={14} />
                </button>
              </h2>
              <div className="space-y-4">
                {['TW', 'CN'].map(region => (
                  <div key={region} className="bg-white rounded-2xl border border-[#E7E5E4] overflow-hidden">
                    <div className="bg-[#FAFAF9] px-6 py-3 border-b border-[#E7E5E4] flex justify-between items-center">
                      <span className="text-xs font-bold tracking-tighter text-[#A8A29E]">{region} 團隊</span>
                      <span className="text-[10px] font-mono text-[#A8A29E]">
                        {staff.filter(s => s.region === region && s.inOffice).length} / {staff.filter(s => s.region === region).length} 在公司
                      </span>
                    </div>
                    <div className="divide-y divide-[#F5F5F4]">
                      {sortedStaff.filter(s => s.region === region).map(member => (
                        <div 
                          key={member.id}
                          onClick={() => toggleInOffice(member.id)}
                          className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-[#FAFAF9] transition-colors group"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${member.inOffice ? 'bg-green-500' : 'bg-[#E7E5E4]'}`} />
                            <span className={`font-medium ${!member.inOffice && 'text-[#A8A29E] line-through'}`}>
                              {member.name}
                            </span>
                          </div>
                          <div className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
                            member.inOffice 
                              ? 'bg-[#1C1917] border-[#1C1917]' 
                              : 'border-[#E7E5E4] bg-white'
                          }`}>
                            {member.inOffice && <CheckCircle2 size={14} className="text-white" />}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Right Column: Results & History */}
          <div className="lg:col-span-5 space-y-12">
            
            {/* Results Section */}
            <AnimatePresence mode="wait">
              {currentResult ? (
                <motion.section
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                >
                  <h2 className="text-xs font-mono uppercase tracking-widest text-[#78716C] mb-6 flex items-center gap-2">
                    <CheckCircle2 size={14} />
                    03. 分配結果
                  </h2>
                  <div className="bg-[#1C1917] text-white p-8 rounded-2xl shadow-xl">
                    <div className="space-y-4 mb-8">
                      {Object.entries(currentResult).map(([name, count]) => (
                        <div key={name} className="flex justify-between items-center border-b border-white/10 pb-3">
                          <span className="text-white font-bold">{name}</span>
                          <span className="text-2xl font-mono">{count}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={saveAllocation}
                      disabled={isSaving}
                      className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors ${
                        isSaving ? 'bg-[#44403C] text-[#A8A29E] cursor-not-allowed' : 'bg-white text-[#1C1917] hover:bg-[#F5F5F4]'
                      }`}
                    >
                      {isSaving ? (
                        <div className="w-5 h-5 border-2 border-[#A8A29E] border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Save size={18} />
                      )}
                      {isSaving ? '儲存中...' : '確認並儲存紀錄'}
                    </button>
                    {saveError && (
                      <p className="mt-4 text-red-400 text-xs text-center flex items-center justify-center gap-1">
                        <AlertCircle size={12} />
                        儲存失敗: {saveError}
                      </p>
                    )}
                  </div>
                </motion.section>
              ) : (
                <section className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-[#E7E5E4] rounded-2xl text-[#A8A29E] min-h-[300px]">
                  <AlertCircle size={32} className="mb-4 opacity-20" />
                  <p className="text-sm font-medium text-center">請輸入數量並點擊計算</p>
                </section>
              )}
            </AnimatePresence>

            {/* Monthly Summary */}
            <section>
              <h2 className="text-xs font-mono uppercase tracking-widest text-[#78716C] mb-6 flex items-center gap-2">
                <History size={14} />
                04. 當月分配結果
              </h2>
              <div className="bg-white rounded-2xl border border-[#E7E5E4] p-6">
                <div className="space-y-4">
                  {sortedStaff.map(member => (
                    <div key={member.id} className="flex items-center gap-4">
                      <div className="w-24 text-sm font-medium text-[#78716C]">{member.name}</div>
                      <div className="flex-1 h-2 bg-[#F5F5F4] rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${(monthlyStats[member.name] / (totalMonthlyUnits || 1)) * 100}%` }}
                          className={`h-full ${member.region === 'TW' ? 'bg-[#1C1917]' : 'bg-[#A8A29E]'}`}
                        />
                      </div>
                      <div className="w-12 text-right font-mono text-sm font-bold">
                        {monthlyStats[member.name]}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* Bottom Grid for History and Yearly Summary */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-12">
          {/* Recent History */}
          <section className="bg-white p-8 rounded-3xl border border-[#E7E5E4] shadow-sm">
            <h2 className="text-xs font-mono uppercase tracking-widest text-[#78716C] mb-8 flex items-center gap-2">
              <History size={14} />
              05. 上次分配紀錄
            </h2>
            <div className="space-y-4">
              {history.slice(0, 5).map(record => (
                <div key={record.id} className="bg-[#FAFAF9] p-5 rounded-2xl border border-[#E7E5E4] flex justify-between items-center group hover:border-[#1C1917] transition-all">
                  <div>
                    <p className="text-[10px] font-mono text-[#A8A29E] uppercase mb-1">
                      {new Date(record.date).toLocaleDateString()} {new Date(record.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-lg font-bold text-[#1C1917]">{record.totalUnits} 台已分配</p>
                  </div>
                  <button 
                    onClick={() => deleteRecord(record.id)}
                    className="p-3 text-[#A8A29E] hover:text-red-500 hover:bg-red-50 rounded-full opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <X size={20} />
                  </button>
                </div>
              ))}
              {history.length === 0 && (
                <div className="text-center py-12 border-2 border-dashed border-[#F5F5F4] rounded-2xl">
                  <p className="text-sm text-[#A8A29E] italic">尚無紀錄</p>
                </div>
              )}
            </div>
          </section>

          {/* Yearly Summary */}
          <section className="bg-white p-8 rounded-3xl border border-[#E7E5E4] shadow-sm">
            <h2 className="text-xs font-mono uppercase tracking-widest text-[#78716C] mb-8 flex items-center gap-2">
              <History size={14} />
              06. 每月數量 ({new Date().getFullYear()})
            </h2>
            <div className="overflow-hidden rounded-2xl border border-[#F5F5F4]">
              <table className="w-full text-sm">
                <thead className="bg-[#FAFAF9] border-b border-[#F5F5F4]">
                  <tr>
                    <th className="px-6 py-4 text-left font-mono text-[10px] text-[#A8A29E] uppercase">月份</th>
                    <th className="px-6 py-4 text-right font-mono text-[10px] text-[#A8A29E] uppercase">總台數</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F5F5F4]">
                  {yearlyStats.map((total, index) => (
                    <tr key={index} className={`hover:bg-[#FAFAF9] transition-colors ${index === new Date().getMonth() ? 'bg-[#F5F5F4]/50' : ''}`}>
                      <td className="px-6 py-4 font-medium">{index + 1}月</td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-lg">{total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-[#E7E5E4] text-center">
        <p className="text-[10px] font-mono text-[#A8A29E] uppercase tracking-widest">
          Furbo Internal Tool • Built for TW/CN Support Teams
        </p>
      </footer>
    </div>
  );
}
