/*
 * Copyright (C) 2026 Darkmine Pty Ltd
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import Sidebar from './Sidebar.jsx';
import { ZoomProvider } from '../context/ZoomContext.jsx';
import { ProjectDataProvider } from '../context/ProjectDataContext.jsx';
import { ThemeProvider } from '../context/ThemeContext.jsx';
import { AnalyticsSelectionsProvider } from '../context/AnalyticsSelectionsContext.jsx';

function Layout({ children }) {
  return (
    <ThemeProvider>
      <ZoomProvider>
        <ProjectDataProvider>
          <AnalyticsSelectionsProvider>
            <div className="app-container">
              <Sidebar />
              <main className="main-content">{children}</main>
            </div>
          </AnalyticsSelectionsProvider>
        </ProjectDataProvider>
      </ZoomProvider>
    </ThemeProvider>
  );
}

export default Layout;
