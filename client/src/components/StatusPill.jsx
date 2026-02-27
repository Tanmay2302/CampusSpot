export function StatusPill({ status, confidence }) {
  const getStyleConfig = () => {
    switch (status?.toLowerCase()) {
      case "available":
      case "open":
        return "bg-emerald-50 text-emerald-700 border-emerald-100";
      case "in_use":
      case "occupied":
        return "bg-amber-50 text-amber-700 border-amber-100";
      case "reserved":
        return "bg-indigo-50 text-indigo-700 border-indigo-100";
      case "maintenance":
      case "closed":
        return "bg-slate-100 text-slate-600 border-slate-200";
      default:
        return "bg-gray-50 text-gray-600 border-gray-100";
    }
  };

  const getConfidenceLabel = () => {
    switch (confidence) {
      case "live":
        return "● Authoritative";
      case "scheduled":
        return "📅 Reserved";
      case "stale":
        return "⏳ Syncing...";
      default:
        return confidence || "Verified";
    }
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <span
        className={`px-3 py-1 rounded-full text-[10px] font-bold border tracking-wider uppercase transition-colors duration-300 ${getStyleConfig()}`}
      >
        {status?.replace("_", " ") || "Unknown"}
      </span>

      <div className="flex items-center gap-1.5 pr-1">
        {confidence === "live" && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
          </span>
        )}
        <span
          className={`text-[9px] font-extrabold uppercase tracking-widest ${
            confidence === "live" ? "text-emerald-600" : "text-slate-400"
          }`}
        >
          {getConfidenceLabel()}
        </span>
      </div>
    </div>
  );
}
