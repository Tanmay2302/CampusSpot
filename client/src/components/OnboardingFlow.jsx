import React, { useState } from "react";
import { useUser } from "../hooks/useUser";

const CAMPUS_CLUBS = ["Roobooru", "E-Cell", "Vision", "Tooryanad"];

export function OnboardingFlow() {
  const { updateIdentity } = useUser();
  const [step, setStep] = useState(1);
  const [localIdentity, setLocalIdentity] = useState({
    userName: "",
    userType: "individual",
    clubName: "",
  });

  const selectRole = (type) => {
    setLocalIdentity((prev) => ({ ...prev, userType: type }));
    setStep(2);
  };

  const handleFinalize = (e) => {
    e.preventDefault();
    if (localIdentity.userType === "club" && !localIdentity.clubName) {
      alert("Please select your club name.");
      return;
    }

    updateIdentity(localIdentity);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 border border-slate-100 transition-all">
        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mb-6">
              <span className="text-3xl">👋</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">
              Welcome to CampusSpot
            </h1>
            <p className="text-slate-500 mt-2">
              How will you be using the campus resources today?
            </p>

            <div className="mt-8 space-y-4">
              <button
                onClick={() => selectRole("individual")}
                className="w-full p-4 rounded-2xl border-2 border-slate-100 hover:border-indigo-500 hover:bg-indigo-50 transition-all text-left group"
              >
                <div className="font-bold text-slate-900 group-hover:text-indigo-700">
                  Individual Student
                </div>
                <div className="text-sm text-slate-500">
                  Book study tables and sports courts for yourself.
                </div>
              </button>

              <button
                onClick={() => selectRole("club")}
                className="w-full p-4 rounded-2xl border-2 border-slate-100 hover:border-indigo-500 hover:bg-indigo-50 transition-all text-left group"
              >
                <div className="font-bold text-slate-900 group-hover:text-indigo-700">
                  College Club
                </div>
                <div className="text-sm text-slate-500">
                  Access whole-day bookings and reserve resources up to 30 days
                  in advance.
                </div>
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <form
            onSubmit={handleFinalize}
            className="animate-in fade-in slide-in-from-right-4 duration-500"
          >
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-indigo-600 text-sm font-bold mb-4 flex items-center gap-1 hover:underline"
            >
              ← Change Role
            </button>

            <h2 className="text-xl font-bold text-slate-900">
              Finalize Identity
            </h2>
            <p className="text-slate-500 mt-1">
              {localIdentity.userType === "club"
                ? "Which club are you representing?"
                : "Tell us your name."}
            </p>

            <div className="mt-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Your Name
                </label>
                <input
                  autoFocus
                  required
                  className="w-full mt-1 px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  placeholder="e.g. Tanmay Gurjar"
                  value={localIdentity.userName}
                  onChange={(e) =>
                    setLocalIdentity({
                      ...localIdentity,
                      userName: e.target.value,
                    })
                  }
                />
              </div>

              {localIdentity.userType === "club" && (
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Registered Club
                  </label>
                  <select
                    required
                    className="w-full mt-1 px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none transition-all bg-white"
                    value={localIdentity.clubName}
                    onChange={(e) =>
                      setLocalIdentity({
                        ...localIdentity,
                        clubName: e.target.value,
                      })
                    }
                  >
                    <option value="" disabled>
                      Select a club...
                    </option>
                    {CAMPUS_CLUBS.map((club) => (
                      <option key={club} value={club}>
                        {club}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-[0.98]">
                Start Exploring
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
