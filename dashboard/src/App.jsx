import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Goals from './pages/Goals'
import Analytics from './pages/Analytics'
import Recommendations from './pages/Recommendations'
import Bundles from './pages/Bundles'
import Settings from './pages/Settings'
import ActivityLogs from './pages/ActivityLogs'
import Guardrails from './pages/Guardrails'
import Optimization from './pages/Optimization'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/goals" replace />} />
        <Route path="goals" element={<Goals />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="recommendations" element={<Recommendations />} />
        <Route path="bundles" element={<Bundles />} />
        <Route path="settings" element={<Settings />} />
        <Route path="activity-logs" element={<ActivityLogs />} />
        <Route path="guardrails" element={<Guardrails />} />
        <Route path="optimization" element={<Optimization />} />
      </Route>
    </Routes>
  )
}
