import axios from "axios";

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const customError = {
      message:
        error.response?.data?.error ||
        error.response?.data?.message ||
        "Something went wrong",
      status: error.response?.status,
      conflictDetails: error.response?.data?.conflictDetails || null,
    };
    return Promise.reject(customError);
  },
);

export default apiClient;
