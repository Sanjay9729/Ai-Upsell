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
import GoalGuardrails from './pages/GoalGuardrails'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<GoalGuardrails />} />
        <Route path="goal-guardrails" element={<GoalGuardrails />} />
        <Route path="guardrails" element={<GoalGuardrails />} />
        <Route path="goals" element={<Goals />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="recommendations" element={<Recommendations />} />
        <Route path="bundles" element={<Bundles />} />
        <Route path="settings" element={<Settings />} />
        <Route path="activity-logs" element={<ActivityLogs />} />
        <Route path="optimization" element={<Optimization />} />
      </Route>
    </Routes>
  )
}
