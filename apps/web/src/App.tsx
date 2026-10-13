import { Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./auth/LoginPage.tsx";
import { RegisterPage } from "./auth/RegisterPage.tsx";
import { RequireAuth } from "./auth/RequireAuth.tsx";
import { ExplorerPage } from "./explorer/ExplorerPage.tsx";
import { AnomaliesPage } from "./anomalies/AnomaliesPage.tsx";
import { TemplatesPage } from "./templates/TemplatesPage.tsx";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <ExplorerPage />
          </RequireAuth>
        }
      />
      <Route
        path="/templates"
        element={
          <RequireAuth>
            <TemplatesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/anomalies"
        element={
          <RequireAuth>
            <AnomaliesPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
