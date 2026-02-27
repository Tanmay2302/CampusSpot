import { StatusPill } from "./StatusPill.jsx";

export function FacilityCard({ facility, onReserve, onViewSchedule }) {
  const usageCount = parseInt(facility.current_usage, 10) || 0;
  const totalSlots = parseInt(facility.total_capacity, 10) || 1;

  const myBooking = facility.my_active_booking;
  const occupants = facility.active_occupants || [];

  const usagePercentage = Math.min(100, (usageCount / totalSlots) * 100);

  const formatFacilityHours = (timeStr) => {
    if (!timeStr) return "--:--";
    const [h, m] = timeStr.split(":");
    const hours = parseInt(h, 10);
    const ampm = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${m} ${ampm}`;
  };

  const formatTimeOnly = (isoStr) => {
    return new Date(isoStr).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatBookingTime = (isoStr) => {
    return new Date(isoStr).toLocaleTimeString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDurationLimit = (mins) => {
    return mins >= 60 ? `${mins / 60}h` : `${mins}m`;
  };

  return (
    <div
      className={`group border rounded-2xl p-6 shadow-sm transition-all duration-300 ${
        myBooking
          ? "bg-indigo-50/50 border-indigo-200 ring-1 ring-indigo-100"
          : "bg-white border-slate-200 hover:shadow-md"
      }`}
    >
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded ${
                facility.category === "Event Space"
                  ? "text-amber-600 bg-amber-50"
                  : "text-indigo-600 bg-indigo-50"
              }`}
            >
              {facility.category}
            </span>
          </div>
          <h3 className="text-xl font-bold text-slate-900 mt-2">
            {facility.display_name}
          </h3>
        </div>
        <StatusPill
          status={myBooking ? "reserved" : facility.current_status}
          confidence="live"
        />
      </div>

      <div className="mb-6">
        <div className="flex justify-between items-end mb-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-tight">
            Current Capacity
          </span>
          <span className="text-sm font-bold text-slate-900">
            {usageCount} / {totalSlots}{" "}
            <span className="text-[10px] text-slate-400 font-medium">
              Occupied
            </span>
          </span>
        </div>
        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 rounded-full ${
              usagePercentage > 90
                ? "bg-rose-500"
                : usagePercentage > 70
                  ? "bg-amber-500"
                  : "bg-emerald-500"
            }`}
            style={{ width: `${usagePercentage}%` }}
          />
        </div>
      </div>

      {myBooking && (
        <div className="mb-4 p-3 rounded-xl bg-white border border-indigo-100 shadow-sm animate-in fade-in slide-in-from-top-2">
          <p className="text-[10px] font-bold text-indigo-600 uppercase mb-1">
            Your Active Slot
          </p>
          <div className="flex justify-between items-center text-xs font-semibold text-slate-700">
            <span>{formatBookingTime(myBooking.starts_at)}</span>
            <span className="text-slate-300">→</span>
            <span>{formatBookingTime(myBooking.ends_at)}</span>
          </div>
        </div>
      )}

      {!facility.is_pooled && occupants.length > 0 && (
        <div className="mb-6 space-y-2">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Currently Occupied By
          </p>
          <div className="space-y-1.5">
            {occupants.map((occ) => {
              if (myBooking && occ.id === myBooking.id) return null;

              const name =
                occ.user_type === "club" ? occ.club_name : occ.booked_by;

              return (
                <div
                  key={occ.id}
                  className="flex justify-between items-center px-3 py-2 rounded-xl bg-slate-50/50 border border-slate-100/50"
                >
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold text-slate-700 truncate max-w-30">
                      {name}
                    </span>
                    {occ.unit_name && (
                      <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-tighter">
                        {occ.unit_name}
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="block text-[8px] text-slate-400 font-bold uppercase tracking-tighter">
                      Until
                    </span>
                    <span className="text-[10px] font-extrabold text-slate-900">
                      {formatTimeOnly(occ.ends_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 py-4 border-y border-slate-50 mb-6">
        <div>
          <span className="block text-[10px] text-slate-400 font-bold uppercase mb-1">
            Operating Hours
          </span>
          <span className="text-xs font-semibold text-slate-700">
            {formatFacilityHours(facility.open_time)} –{" "}
            {formatFacilityHours(facility.close_time)}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-slate-400 font-bold uppercase mb-1">
            Booking Limit
          </span>
          <span className="text-xs font-semibold text-slate-700">
            {formatDurationLimit(facility.min_duration_minutes)} –{" "}
            {formatDurationLimit(facility.max_duration_minutes)}
          </span>
        </div>
      </div>

      {!facility.is_pooled && (
        <button
          onClick={() => onViewSchedule(facility)}
          className="w-full mb-3 py-3 px-4 rounded-xl text-sm font-bold text-indigo-600 bg-white border border-indigo-100 hover:bg-indigo-50 transition-all active:scale-95"
        >
          View Schedule
        </button>
      )}

      <button
        onClick={() => onReserve(facility)}
        className={`w-full py-3 px-4 rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95 ${
          myBooking
            ? "bg-white border-2 border-indigo-600 text-indigo-600 hover:bg-indigo-50"
            : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100 cursor-pointer"
        }`}
      >
        {myBooking ? "New Reservation" : "Request Slot"}
      </button>
    </div>
  );
}
