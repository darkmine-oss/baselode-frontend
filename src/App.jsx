/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Drillhole from './pages/Drillhole';
import Drillhole2D from './pages/Drillhole2D';
import DataInstructions from './pages/DataInstructions';
import AnalyticsPlots from './pages/AnalyticsPlots';
import './App.css';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/drillhole" element={<Drillhole />} />
        <Route path="/strip-log" element={<Drillhole2D />} />
        <Route path="/analytics" element={<AnalyticsPlots />} />
        <Route path="/data-instructions" element={<DataInstructions />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
