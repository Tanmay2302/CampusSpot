import React, { useState, useEffect, useCallback } from "react";
import apiClient from "./api/apiClient.js";
import { useUser } from "./hooks/useUser.js";
import { useLiveUpdates } from "./hooks/useLiveUpdates.js";
import { FacilityCard } from "./components/FacilityCard.jsx";
import { PolicyModal } from "./components/PolicyModal.jsx";
import { OnboardingFlow } from "./components/OnboardingFlow.jsx";
import { BookingList } from "./components/BookingList.jsx";
import { ScheduleModal } from "./components/ScheduleModal.jsx";

export default function App() {
  const { userName, userType, clearIdentity } = useUser();
  const [activeTab, setActiveTab] = useState("explore");
  const [facilities, setFacilities] = useState([]);
  const [selectedFacility, setSelectedFacility] = useState(null);
  const [scheduleFacility, setScheduleFacility] = useState(null);
  const [isSyncing, setIsSyncing] = useState(true);

  const refreshCampusState = useCallback(async () => {
    try {
      const { data } = await apiClient.get(
        `/assets?userName=${userName}&userType=${userType}`,
      );
      setFacilities(data);
    } catch (err) {
      console.error("Failed to refresh facilities:", err);
    } finally {
      setIsSyncing(false);
    }
  }, [userName, userType]);

  useEffect(() => {
    if (userName) refreshCampusState();
  }, [refreshCampusState, userName]);

  useLiveUpdates(refreshCampusState);

  if (!userName) return <OnboardingFlow />;

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">
                C
              </div>
              <span className="font-bold text-slate-900 tracking-tight text-lg">
                CampusSpot
              </span>
            </div>

            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setActiveTab("explore")}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === "explore" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                Explore
              </button>
              <button
                onClick={() => setActiveTab("my-bookings")}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === "my-bookings" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                My Bookings
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end leading-tight">
              <span className="text-sm font-bold text-slate-800">
                {userName}
              </span>
              <span className="text-[10px] text-indigo-500 font-medium uppercase tracking-wider">
                {userType}
              </span>
            </div>
            <button
              onClick={clearIdentity}
              className="p-2 text-slate-400 hover:text-rose-500 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {isSyncing ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 space-y-4">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
            <p className="font-medium animate-pulse">
              Hold up… syncing the vibe.
            </p>
          </div>
        ) : activeTab === "explore" ? (
          <>
            <header className="mb-10">
              <h2 className="text-3xl font-bold text-slate-900">
                What’s Happening on Campus
              </h2>
              <p className="text-slate-500 mt-1">
                Real-time vibes. No outdated info.
              </p>
            </header>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {facilities.map((f) => (
                <FacilityCard
                  key={f.id}
                  facility={f}
                  onReserve={setSelectedFacility}
                  onViewSchedule={setScheduleFacility}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <header className="mb-10">
              <h2 className="text-3xl font-bold text-slate-900">
                Your Game Plan
              </h2>
              <p className="text-slate-500 mt-1">
                Everything you’ve locked in.
              </p>
            </header>
            <BookingList />
          </>
        )}
      </main>

      {selectedFacility && (
        <PolicyModal
          facility={selectedFacility}
          onClose={() => setSelectedFacility(null)}
          onSuccess={() => {
            setSelectedFacility(null);
            refreshCampusState();
          }}
        />
      )}
      {scheduleFacility && (
        <ScheduleModal
          facility={scheduleFacility}
          onClose={() => setScheduleFacility(null)}
        />
      )}
    </div>
  );
}
