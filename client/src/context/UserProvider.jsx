import { useState, useEffect, useMemo } from "react";
import { UserContext } from "./UserContext.js";

export function UserProvider({ children }) {
  const [identity, setIdentity] = useState(() => {
    const saved = localStorage.getItem("campus_spot_identity");
    return saved
      ? JSON.parse(saved)
      : {
          userName: "",
          userType: "individual",
          clubName: null,
        };
  });

  useEffect(() => {
    if (identity.userName) {
      localStorage.setItem("campus_spot_identity", JSON.stringify(identity));
    }
  }, [identity]);

  const updateIdentity = (details) => {
    setIdentity((prev) => ({
      ...prev,
      ...details,
    }));
  };

  const clearIdentity = () => {
    localStorage.removeItem("campus_spot_identity");
    setIdentity({
      userName: "",
      userType: "individual",
      clubName: null,
    });
  };

  const contextValue = useMemo(
    () => ({
      ...identity,
      updateIdentity,
      clearIdentity,
    }),
    [identity],
  );

  return (
    <UserContext.Provider value={contextValue}>{children}</UserContext.Provider>
  );
}
