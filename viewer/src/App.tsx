import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProvider } from "./components/ThemeProvider";
import { Layout } from "./components/Layout";
import { ProjectListPage } from "./pages/ProjectListPage";
import { SessionPage } from "./pages/SessionPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider>
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/projects" element={<ProjectListPage />} />
              <Route path="/projects/:projectId" element={<SessionPage />} />
              <Route path="*" element={<Navigate to="/projects" replace />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </AppProvider>
    </QueryClientProvider>
  );
}
