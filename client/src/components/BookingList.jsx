import React, { useState, useEffect, useCallback } from "react";
import apiClient from "../api/apiClient.js";
import { useUser } from "../hooks/useUser.js";

export function BookingList() {
  const { userName } = useUser();
  const [bookings, setBookings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMyBookings = useCallback(async () => {
    if (!userName) return;
    setIsLoading(true);
    try {
      const { data } = await apiClient.get(`/bookings/user/${userName}`);
      setBookings(data);
    } catch (err) {
      console.error("Failed to fetch bookings:", err);
    } finally {
      setIsLoading(false);
    }
  }, [userName]);

  const handleSessionAction = async (endpoint, bookingId) => {
    try {
      await apiClient.post(endpoint, { bookingId, userName });
      // Authoritative refresh after status change
      fetchMyBookings();
    } catch (err) {
      alert(err.message || "Coordination operation failed.");
    }
  };

  const handleCancel = async (bookingId) => {
    try {
      await apiClient.post("/cancel", { bookingId, userName });
      fetchMyBookings(); // Refresh list
    } catch (err) {
      alert(err.message || "Cancellation failed.");
    }
  };

  useEffect(() => {
    fetchMyBookings();
  }, [fetchMyBookings]);

  const getResourceIcon = (facilityName, category) => {
    const name = facilityName.toLowerCase();
    if (category === "Sports") {
      if (name.includes("cricket") || name.includes("ground")) return "🏟️";
      if (name.includes("tt") || name.includes("table")) return "🏓";
      return "🏀";
    }
    if (category === "Study Space" || name.includes("library")) return "📚";
    if (category === "Specialized Lab" || name.includes("vr")) return "🥽";
    if (category === "Meeting Space" || name.includes("collaborative"))
      return "👥";
    return "📍";
  };

  const formatTime = (isoStr) => {
    return new Date(isoStr).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  const formatDate = (isoStr) => {
    return new Date(isoStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        <p className="text-slate-400 font-medium text-sm">
          Refreshing your game plan…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {bookings.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-16 text-center animate-in fade-in duration-500">
          <div className="text-5xl mb-6">📭</div>
          <h3 className="text-slate-900 font-bold text-xl">
            Your game plan is empty.
          </h3>
          <p className="text-slate-500 mt-2">
            Time to head to Explore and make some moves.
          </p>
        </div>
      ) : (
        bookings.map((booking) => (
          <div
            key={booking.id}
            className="bg-white border border-slate-200 rounded-3xl p-6 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-sm hover:shadow-md transition-all animate-in slide-in-from-bottom-2"
          >
            <div className="flex items-center gap-6 w-full sm:w-auto">
              <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-3xl shadow-inner shrink-0">
                {getResourceIcon(booking.facility_name, booking.category)}
              </div>
              <div className="overflow-hidden">
                <h4 className="font-extrabold text-slate-900 text-lg truncate">
                  {booking.facility_name}
                </h4>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                    {booking.unit_name || "General Access Space"}
                  </span>
                  {booking.user_type === "club" && (
                    <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                      Club: {booking.club_name}
                    </span>
                  )}
                </div>
                <div className="mt-3 space-y-1">
                  <div className="text-xs font-bold text-slate-700">
                    {formatDate(booking.starts_at)}
                  </div>

                  <div className="flex items-center gap-2 text-slate-500">
                    <span className="text-xs font-bold text-slate-900">
                      {formatTime(booking.starts_at)}
                    </span>
                    <span className="text-xs text-slate-300">→</span>
                    <span className="text-xs font-bold text-slate-900">
                      {formatTime(booking.ends_at)}
                    </span>

                    <span className="text-[10px] ml-2 bg-slate-100 px-1.5 py-0.5 rounded font-bold uppercase tracking-tighter">
                      {booking.booking_type === "full_day"
                        ? "All Day"
                        : "Timed"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 w-full sm:w-auto justify-end border-t sm:border-t-0 pt-4 sm:pt-0">
              {booking.status === "scheduled" && (
                <div className="flex gap-3">
                  <button
                    onClick={() => handleSessionAction("/check-in", booking.id)}
                    className="px-6 py-3 bg-emerald-600 text-white rounded-2xl text-xs font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-100 transition-all active:scale-95"
                  >
                    Check In
                  </button>

                  <button
                    onClick={() => handleCancel(booking.id)}
                    className="px-6 py-3 bg-slate-200 text-slate-700 rounded-2xl text-xs font-bold hover:bg-rose-600 hover:text-white transition-all active:scale-95"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {booking.status === "checked_in" && (
                <button
                  onClick={() => handleSessionAction("/check-out", booking.id)}
                  className="px-8 py-3 bg-rose-600 text-white rounded-2xl text-xs font-bold hover:bg-rose-700 shadow-lg shadow-rose-100 transition-all active:scale-95"
                >
                  Check Out
                </button>
              )}
              <div
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${
                  booking.status === "checked_in"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                    : "bg-indigo-50 text-indigo-700 border-indigo-100"
                }`}
              >
                ● {booking.status.replace("_", " ")}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
