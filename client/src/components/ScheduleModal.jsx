import { useState, useEffect, useMemo } from "react";
import apiClient from "../api/apiClient.js";
import { useUser } from "../hooks/useUser.js";

export function ScheduleModal({ facility, onClose }) {
  const { userName } = useUser();

  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);

  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [schedule, setSchedule] = useState(null);
  const [activeUnitId, setActiveUnitId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const maxDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 6);
    return date.toISOString().split("T")[0];
  }, []);

  // Generate 30-min slots within facility hours
  const timeSlots = useMemo(() => {
    if (!facility.open_time || !facility.close_time) return [];

    const slots = [];

    const baseDate = new Date(selectedDate);

    const [openH, openM] = facility.open_time.split(":").map(Number);
    const [closeH, closeM] = facility.close_time.split(":").map(Number);

    const start = new Date(baseDate);
    start.setHours(openH, openM, 0, 0);

    const end = new Date(baseDate);
    end.setHours(closeH, closeM, 0, 0);

    // If close time is midnight (00:00), treat it as next day
    if (end <= start) {
      end.setDate(end.getDate() + 1);
    }

    const cursor = new Date(start);

    while (cursor < end) {
      const hours = String(cursor.getHours()).padStart(2, "0");
      const minutes = String(cursor.getMinutes()).padStart(2, "0");

      slots.push(`${hours}:${minutes}`);

      cursor.setMinutes(cursor.getMinutes() + 30);
    }

    return slots;
  }, [facility.open_time, facility.close_time, selectedDate]);

  useEffect(() => {
    const fetchSchedule = async () => {
      setIsLoading(true);
      try {
        const { data } = await apiClient.get(
          `/facilities/${facility.id}/schedule?date=${selectedDate}`,
        );

        setSchedule(data);

        if (data.units?.length > 0) {
          setActiveUnitId((prev) =>
            prev && data.units.some((u) => u.unitId === prev)
              ? prev
              : data.units[0].unitId,
          );
        } else {
          setActiveUnitId(null);
        }
      } catch (err) {
        console.error("Schedule Load Error:", err);
        setSchedule(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSchedule();
  }, [facility.id, selectedDate]);

  const activeUnit = schedule?.units?.find((u) => u.unitId === activeUnitId);

  // Detect if this unit has a full-day booking
  const fullDayBooking = useMemo(() => {
    if (!activeUnit) return null;

    return (
      activeUnit.bookings.find((b) => b.booking_type === "full_day") || null
    );
  }, [activeUnit]);

  const slotStatusMap = useMemo(() => {
    if (!activeUnit) return {};

    const map = {};

    for (const booking of activeUnit.bookings) {
      const start = new Date(booking.starts_at);
      const end = new Date(booking.ends_at);

      for (const time of timeSlots) {
        const [h, m] = time.split(":").map(Number);
        const slotTime = new Date(selectedDate);
        slotTime.setHours(h, m, 0, 0);

        if (slotTime >= start && slotTime < end) {
          if (booking.booked_by === userName) {
            map[time] = { type: "mine", label: "Your Slot" };
          } else if (booking.user_type === "club") {
            map[time] = { type: "club", label: booking.club_name };
          } else {
            map[time] = { type: "occupied", label: "Occupied" };
          }
        }
      }
    }

    return map;
  }, [activeUnit, selectedDate, timeSlots, userName]);

  const getResourceLabel = () => {
    const name = facility.display_name?.toLowerCase() || "";

    if (name.includes("court")) return "court";
    if (name.includes("ground")) return "ground";
    if (name.includes("auditorium")) return "auditorium";

    return "resource";
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden border border-slate-100">
        <div className="p-8 border-b border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">
                {facility.display_name} Schedule
              </h2>
              <p className="text-slate-500 mt-1 text-sm font-medium">
                Real-time vibes. Who’s got the spot?
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-rose-500 text-sm font-bold"
            >
              Close
            </button>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-6">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                Select Date
              </label>
              <input
                type="date"
                min={todayStr}
                max={maxDate}
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-semibold"
              />
            </div>

            {schedule?.units?.length > 1 && (
              <div className="space-y-1.5 flex-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                  Resource Units
                </label>
                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl w-fit">
                  {schedule.units.map((unit) => (
                    <button
                      key={unit.unitId}
                      onClick={() => setActiveUnitId(unit.unitId)}
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        activeUnitId === unit.unitId
                          ? "bg-white text-indigo-600 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {unit.unitName}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 pt-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
              <p className="text-slate-400 font-medium text-sm">
                Fetching who’s outside rn
              </p>
            </div>
          ) : !activeUnit ? (
            <div className="text-center text-slate-400 font-medium py-20">
              No schedule data available.
            </div>
          ) : fullDayBooking ? (
            <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
              <div className="text-5xl">🏟️</div>

              {fullDayBooking.booked_by === userName ? (
                <>
                  <h3 className="text-xl font-bold text-slate-900">
                    You own the day.
                  </h3>
                  <p className="text-slate-500 text-sm font-medium max-w-md">
                    This space is fully yours today. Make it count.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-xl font-bold text-slate-900">
                    Whole day locked.
                  </h3>
                  <p className="text-slate-500 text-sm font-medium max-w-md">
                    {fullDayBooking.user_type === "club"
                      ? `${fullDayBooking.club_name} took over this ${getResourceLabel()} for the day.`
                      : "This facility is reserved for the full day."}
                  </p>
                </>
              )}

              <p className="text-xs text-slate-400 uppercase tracking-widest">
                No slots available
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-1">
              {timeSlots.map((time) => {
                const status = slotStatusMap[time] || null;

                return (
                  <div key={time} className="flex items-center group h-12">
                    <span className="w-16 text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                      {time}
                    </span>
                    <div
                      className={`flex-1 h-full rounded-lg border flex items-center px-4 transition-all duration-300 ${
                        status?.type === "mine"
                          ? "bg-indigo-600 border-indigo-700 text-white shadow-lg shadow-indigo-100"
                          : status?.type === "club"
                            ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                            : status?.type === "occupied"
                              ? "bg-amber-50 border-amber-100 text-amber-700"
                              : "bg-white border-slate-100 text-slate-300 hover:border-indigo-200"
                      }`}
                    >
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        {status ? status.label : "Available Slot"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-indigo-600"></div>
            <span className="text-[9px] font-bold text-slate-500 uppercase">
              You
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-emerald-400"></div>
            <span className="text-[9px] font-bold text-slate-500 uppercase">
              Club Events
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-amber-400"></div>
            <span className="text-[9px] font-bold text-slate-500 uppercase">
              Occupied
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
