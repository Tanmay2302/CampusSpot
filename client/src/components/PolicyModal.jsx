import { useState, useEffect } from "react";
import apiClient from "../api/apiClient.js";
import { useUser } from "../hooks/useUser.js";

export function PolicyModal({ facility, onClose, onSuccess }) {
  const { userName, userType, clubName } = useUser();

  const [availableUnits, setAvailableUnits] = useState([]);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [isWholeDay, setIsWholeDay] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestError, setRequestError] = useState(null);

  const getCurrentTimeForInput = () => {
    const date = new Date();
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
  };

  const getMaxAllowedDate = () => {
    const date = new Date();
    const horizonDays = userType === "club" ? 30 : 7;
    date.setDate(date.getDate() + horizonDays);
    date.setHours(23, 59, 0, 0);
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
  };

  const getInitialTime = (additionalMinutes = 0) => {
    const date = new Date();
    const minutes = date.getMinutes();
    const roundedMinutes = Math.ceil(minutes / 30) * 30;

    date.setMinutes(roundedMinutes + additionalMinutes);
    date.setSeconds(0);
    date.setMilliseconds(0);

    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
  };

  const [bookingTimes, setBookingTimes] = useState({
    start: getInitialTime(0),
    end: getInitialTime(60),
  });

  const getUnitTerminology = () => {
    const name = facility.display_name?.toLowerCase() || "";
    if (name.includes("court")) return "Court";
    if (name.includes("ground")) return "Ground";
    if (name.includes("table")) return "Table";
    return "Resource";
  };

  const formatTo12Hour = (timeStr) => {
    if (!timeStr) return "";
    const [h, m] = timeStr.split(":");
    const hours = parseInt(h, 10);
    const suffix = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${m} ${suffix}`;
  };

  useEffect(() => {
    if (!facility.is_pooled) {
      apiClient
        .get(`/facilities/${facility.id}/units`)
        .then(({ data }) => setAvailableUnits(data))
        .catch((err) => console.error("Failed to load units:", err));
    }
  }, [facility.id, facility.is_pooled]);

  const handleRequest = async (e) => {
    if (e) e.preventDefault();

    const start = new Date(bookingTimes.start);
    const end = new Date(bookingTimes.end);
    const now = new Date();

    if (!(userType === "club" && isWholeDay)) {
      if (end <= start) {
        setRequestError({
          message: "End time must be after the start time.",
        });
        return;
      }
    }

    if (!(userType === "club" && isWholeDay)) {
      const durationMinutes = (end - start) / (1000 * 60);

      if (durationMinutes < facility.min_duration_minutes) {
        setRequestError({
          message: `Minimum duration for this resource is ${facility.min_duration_minutes} minutes.`,
        });
        return;
      }

      if (durationMinutes > facility.max_duration_minutes) {
        setRequestError({
          message: `Maximum duration for this resource is ${
            facility.max_duration_minutes / 60
          } hours.`,
        });
        return;
      }
    }
    if (!isWholeDay) {
      const [openH, openM] = facility.open_time.split(":").map(Number);
      const [closeH, closeM] = facility.close_time.split(":").map(Number);

      const openDate = new Date(start);
      openDate.setHours(openH, openM, 0, 0);

      const closeDate = new Date(start);
      closeDate.setHours(closeH, closeM, 0, 0);

      if (start < openDate || end > closeDate) {
        setRequestError({
          message: `This facility is only available between ${formatTo12Hour(
            facility.open_time,
          )} and ${formatTo12Hour(facility.close_time)}.`,
        });
        return;
      }
    }

    if (!facility.is_pooled && !selectedUnitId) {
      setRequestError({
        message: `Please select a specific ${getUnitTerminology().toLowerCase()} to proceed.`,
      });
      return;
    }

    let finalStart = start;
    let finalEnd = end;
    if (isWholeDay && userType === "club") {
      const eventDayMidnight = new Date(start);
      eventDayMidnight.setHours(0, 0, 0, 0);

      if (now >= eventDayMidnight) {
        setRequestError({
          message:
            "Whole-day events must be booked before 12:00 AM on the day of the event.",
        });
        return;
      }

      const [openH, openM] = facility.open_time.split(":").map(Number);

      const [closeH, closeM] = facility.close_time.split(":").map(Number);

      finalStart = new Date(start);
      finalStart.setHours(openH, openM, 0, 0);

      finalEnd = new Date(start);
      finalEnd.setHours(closeH, closeM, 0, 0);
    } else {
      if (start < now) {
        setRequestError({ message: "You cannot book a slot in the past." });
        return;
      }
    }

    setIsSubmitting(true);
    setRequestError(null);

    try {
      await apiClient.post("/reserve", {
        facilityId: facility.id,
        unitId: facility.is_pooled ? null : selectedUnitId,
        userName,
        userType,
        clubName,
        startsAt: finalStart.toISOString(),
        endsAt: finalEnd.toISOString(),
      });
      onSuccess();
    } catch (err) {
      const conflict = err?.conflictDetails;

      if (conflict?.startsAt && conflict?.endsAt) {
        const startTime = new Date(conflict.startsAt).toLocaleTimeString(
          "en-IN",
          {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          },
        );

        const endTime = new Date(conflict.endsAt).toLocaleTimeString("en-IN", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

        const nameToShow =
          conflict.userType === "club" ? conflict.clubName : conflict.bookedBy;

        setRequestError({
          message: `${startTime} – ${endTime} is already booked by ${nameToShow}.`,
        });
      } else {
        setRequestError({
          message: err?.message || "An error occurred during booking.",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100">
        <div className="p-8">
          <header className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900">
              Request {facility.display_name}
            </h2>
            <p className="text-slate-500 mt-1 text-sm font-medium">
              Review policies and select your resource.
            </p>
          </header>

          <form onSubmit={handleRequest} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Starts At
                </label>
                <input
                  type={
                    userType === "club" && isWholeDay
                      ? "date"
                      : "datetime-local"
                  }
                  required
                  min={
                    userType === "club" && isWholeDay
                      ? new Date().toISOString().split("T")[0]
                      : getCurrentTimeForInput()
                  }
                  max={
                    userType === "club" && isWholeDay
                      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                          .toISOString()
                          .split("T")[0]
                      : getMaxAllowedDate()
                  }
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-semibold"
                  value={bookingTimes.start}
                  onChange={(e) =>
                    setBookingTimes({ ...bookingTimes, start: e.target.value })
                  }
                />
              </div>
              {!(userType === "club" && isWholeDay) && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Ends At
                  </label>
                  <input
                    type="datetime-local"
                    required
                    min={bookingTimes.start}
                    max={getMaxAllowedDate()}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-semibold"
                    value={bookingTimes.end}
                    onChange={(e) =>
                      setBookingTimes({ ...bookingTimes, end: e.target.value })
                    }
                  />
                </div>
              )}
            </div>

            {userType === "club" && !facility.is_pooled && (
              <div className="p-4 rounded-2xl border border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-slate-900">
                    Whole-Day Event
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5 font-medium">
                    Reserve the entire day ({formatTo12Hour(facility.open_time)}{" "}
                    – {formatTo12Hour(facility.close_time)})
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="w-5 h-5 rounded-lg border-slate-300 text-indigo-600"
                  checked={isWholeDay}
                  onChange={(e) => setIsWholeDay(e.target.checked)}
                />
              </div>
            )}

            {!facility.is_pooled && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Select Available {getUnitTerminology()}
                </label>
                <select
                  required
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-semibold bg-white"
                  value={selectedUnitId}
                  onChange={(e) => setSelectedUnitId(e.target.value)}
                >
                  <option value="">
                    Choose a {getUnitTerminology().toLowerCase()}...
                  </option>
                  {availableUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.unit_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {requestError && (
              <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200">
                <div className="flex gap-3">
                  <span className="text-xl">⚠️</span>
                  <div>
                    <h4 className="text-sm font-bold text-rose-900">
                      Policy Rejection
                    </h4>
                    <p className="text-xs mt-1 text-rose-800">
                      {requestError.message ||
                        "An error occurred during booking."}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-4 px-4 rounded-2xl text-sm font-bold text-slate-500 bg-slate-100 hover:bg-slate-200"
              >
                Dismiss
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-2 py-4 px-4 rounded-2xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                {isSubmitting ? "Processing..." : "Confirm Booking"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
